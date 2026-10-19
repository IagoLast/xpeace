import "server-only";
import { matchesCleanup, type CleanupJob, type Kind } from "../domain";
import { query } from "./db";
import { HttpError } from "./auth";
import { type Account, type Timeline, accountXRequest, XError } from "./x";
import { BillingError } from "./billing-access";

export async function createPreview(
  accountId: string,
  kinds: Kind[],
  before: string,
) {
  const active = await query(
    "SELECT id FROM cleanup_jobs WHERE account_id=$1 AND status IN ('scanning','ready','running')",
    [accountId],
  );
  if (active.length)
    throw new HttpError(
      409,
      "Termina o cancela la limpieza actual antes de crear otra.",
    );
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO cleanup_jobs(id,account_id,kinds,before_date,phase) VALUES($1,$2,$3,$4,$5)",
    [
      id,
      accountId,
      kinds,
      before,
      kinds.some((k) => k !== "likes") ? "tweets" : "likes",
    ],
  );
  return id;
}

export async function confirmCleanup(accountId: string, id: string) {
  const rows = await query(
    "UPDATE cleanup_jobs SET status='running' WHERE account_id=$1 AND id=$2 AND status='ready' RETURNING id",
    [accountId, id],
  );
  if (!rows.length)
    throw new HttpError(
      409,
      "La vista previa todavía no está lista o ya ha cambiado.",
    );
}

export async function processCleanup(
  account: Account,
  token: string,
  deadline: number,
) {
  const [job] = await query<CleanupJob>(
    "SELECT * FROM cleanup_jobs WHERE account_id=$1 AND status IN ('scanning','running') ORDER BY created_at LIMIT 1",
    [account.id],
  );
  if (!job) return;
  if (job.status === "scanning") {
    const params = new URLSearchParams({
      max_results: "100",
      "tweet.fields": "created_at,referenced_tweets",
    });
    if (job.phase === "tweets") params.set("exclude", "retweets");
    if (job.cursor) params.set("pagination_token", job.cursor);
    const page = await accountXRequest<Timeline>(
      account.id,
      token,
      `/users/${account.id}/${job.phase === "likes" ? "liked_tweets" : "tweets"}?${params}`,
    );
    const items = (page.data ?? []).flatMap((post) => {
      if (!post.created_at)
        throw new Error(
          "X devolvió un post sin fecha; no se puede filtrar con seguridad.",
        );
      const kind: Kind =
        job.phase === "likes"
          ? "likes"
          : post.referenced_tweets?.some((r) => r.type === "replied_to")
            ? "replies"
            : "tweets";
      return matchesCleanup(kind, post.created_at, job.kinds, job.before_date)
        ? [{ id: post.id, text: post.text, kind, created_at: post.created_at }]
        : [];
    });
    if (items.length)
      await query(
        `INSERT INTO cleanup_items(job_id,id,kind,text,created_at)
      SELECT $1, x.id,x.kind,x.text,x.created_at::timestamptz FROM jsonb_to_recordset($2::jsonb) AS x(id text,kind text,text text,created_at text)
      ON CONFLICT DO NOTHING`,
        [job.id, JSON.stringify(items)],
      );
    const moreLikes =
      !page.meta?.next_token &&
      job.phase === "tweets" &&
      job.kinds.includes("likes");
    await query(
      `UPDATE cleanup_jobs SET cursor=$2,phase=$3,status=$4,scanned=scanned+$5,
      total=(SELECT count(*) FROM cleanup_items WHERE job_id=$1),error=NULL WHERE id=$1 AND status='scanning'`,
      [
        job.id,
        page.meta?.next_token ?? null,
        moreLikes ? "likes" : job.phase,
        page.meta?.next_token || moreLikes ? "scanning" : "ready",
        page.data?.length ?? 0,
      ],
    );
    return;
  }
  const items = await query<{ id: string; kind: Kind }>(
    "SELECT id,kind FROM cleanup_items WHERE job_id=$1 AND status='pending' ORDER BY created_at,id LIMIT 10",
    [job.id],
  );
  try {
    for (const item of items) {
      if (Date.now() > deadline) break;
      const [current] = await query<{ status: string }>(
        "SELECT status FROM cleanup_jobs WHERE id=$1",
        [job.id],
      );
      if (current?.status !== "running") break;
      try {
        const path =
          item.kind === "likes"
            ? `/users/${account.id}/likes/${item.id}`
            : `/tweets/${item.id}`;
        const result = await accountXRequest<{
          data?: { deleted?: boolean; liked?: boolean };
        }>(account.id, token, path, { method: "DELETE" }, true);
        const confirmed =
          item.kind === "likes"
            ? result.data?.liked === false
            : result.data?.deleted === true;
        if (!confirmed) throw new Error("X no ha confirmado la eliminación.");
        await query(
          "UPDATE cleanup_items SET status='done',error=NULL WHERE job_id=$1 AND id=$2 AND kind=$3",
          [job.id, item.id, item.kind],
        );
      } catch (error) {
        if (error instanceof BillingError) throw error;
        if (
          error instanceof XError &&
          [429, 401, 402, 403].includes(error.status)
        )
          throw error;
        if (error instanceof XError && error.status === 404) {
          await query(
            "UPDATE cleanup_items SET status='done',error=NULL WHERE job_id=$1 AND id=$2 AND kind=$3",
            [job.id, item.id, item.kind],
          );
        } else {
          // Do not hide partial failures. The user can create another preview to retry them.
          await query(
            "UPDATE cleanup_items SET status='error',error=$4 WHERE job_id=$1 AND id=$2 AND kind=$3",
            [
              job.id,
              item.id,
              item.kind,
              "No se pudo eliminar. Crea otra vista previa para reintentar.",
            ],
          );
        }
      }
    }
  } finally {
    // Persist progress even when a quota or provider limit pauses the batch.
    await query(
      `UPDATE cleanup_jobs SET
    done=(SELECT count(*) FROM cleanup_items WHERE job_id=$1 AND status='done'),
    failed=(SELECT count(*) FROM cleanup_items WHERE job_id=$1 AND status='error'),
    status=CASE WHEN EXISTS(SELECT 1 FROM cleanup_items WHERE job_id=$1 AND status='pending') THEN 'running' ELSE 'completed' END
    WHERE id=$1 AND status='running'`,
      [job.id],
    );
  }
}
