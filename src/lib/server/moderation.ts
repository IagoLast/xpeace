import "server-only";
import {
  BPN_REPLY,
  isOptOut,
  routeDecision,
  type Decision,
  type Interaction,
} from "../domain";
import { query } from "./db";
import { evaluate } from "./jev";
import { HttpError } from "./auth";
import { type Account, type Timeline, accountXRequest, xRequest } from "./x";
import { reserveUsage } from "./billing-access";

export async function ingestMentions(account: Account, token: string) {
  const params = new URLSearchParams({
    max_results: "100",
    "tweet.fields":
      "author_id,created_at,in_reply_to_user_id,referenced_tweets",
    expansions: "author_id",
    "user.fields": "username,name",
  });
  if (account.since_id) params.set("since_id", account.since_id);
  else params.set("start_time", new Date(account.connected_at).toISOString());
  if (account.mention_cursor)
    params.set("pagination_token", account.mention_cursor);
  const page = await accountXRequest<Timeline>(
    account.id,
    token,
    `/users/${account.id}/mentions?${params}`,
  );
  const records = (page.data ?? [])
    .filter((p) => p.author_id && p.author_id !== account.id)
    .map((p) => {
      const author = page.includes?.users?.find((u) => u.id === p.author_id);
      if (!p.created_at || !author)
        throw new Error("X devolvió una interacción incompleta.");
      return {
        id: p.id,
        author_id: p.author_id,
        username: author.username,
        name: author.name,
        text: p.text,
        created_at: p.created_at,
        direct_reply: p.in_reply_to_user_id === account.id,
      };
    });
  if (records.length)
    await query(
      `INSERT INTO interactions(account_id,id,author_id,username,name,text,created_at,direct_reply)
    SELECT $1,x.id,x.author_id,x.username,x.name,x.text,x.created_at::timestamptz,x.direct_reply
    FROM jsonb_to_recordset($2::jsonb) AS x(id text,author_id text,username text,name text,text text,created_at text,direct_reply boolean)
    ON CONFLICT DO NOTHING`,
      [account.id, JSON.stringify(records)],
    );
  // Honor explicit opt-outs across the full batch before processing any older insults.
  const optingOut = records
    .filter((record) => isOptOut(record.text))
    .map((record) => record.author_id);
  if (optingOut.length)
    await query(
      "INSERT INTO opt_outs(account_id,author_id) SELECT $1,unnest($2::text[]) ON CONFLICT DO NOTHING",
      [account.id, optingOut],
    );
  const ids = [
    account.mention_high_water,
    account.since_id,
    ...(page.data ?? []).map((p) => p.id),
  ].filter((x): x is string => !!x);
  const highWater = ids.reduce<string | null>(
    (max, id) => (max === null || BigInt(id) > BigInt(max) ? id : max),
    null,
  );
  // Advance since_id only AFTER the entire page chain has been durably ingested.
  await query(
    `UPDATE accounts SET mention_cursor=$2,mention_high_water=$3,
    since_id=CASE WHEN $2::text IS NULL THEN $3 ELSE since_id END,last_sync=now() WHERE id=$1`,
    [account.id, page.meta?.next_token ?? null, highWater],
  );
}

async function excluded(account: Account, item: Interaction) {
  if (
    item.author_id === account.id ||
    account.settings.allowlist.some(
      (u) => u.toLowerCase() === item.username.toLowerCase(),
    )
  )
    return true;
  const optedOut = await query(
    "SELECT 1 FROM opt_outs WHERE account_id=$1 AND author_id=$2",
    [account.id, item.author_id],
  );
  return !!optedOut.length;
}

export async function replyAndBlock(
  account: Account,
  token: string,
  id: string,
) {
  const [item] = await query<Interaction>(
    "SELECT * FROM interactions WHERE account_id=$1 AND id=$2",
    [account.id, id],
  );
  if (!item || item.status !== "review")
    throw new HttpError(409, "Esta interacción ya se ha procesado.");
  if (await excluded(account, item))
    throw new HttpError(409, "Esta cuenta está excluida de BPN.");
  const [{ count }] = await query<{ count: number }>(
    "SELECT count(*)::int AS count FROM interactions WHERE account_id=$1 AND attempted_at > now()-interval '1 day'",
    [account.id],
  );
  if (count >= 25)
    throw new HttpError(
      429,
      "Has alcanzado el máximo de 25 respuestas BPN en 24 horas.",
    );
  const recent = await query(
    "SELECT 1 FROM interactions WHERE account_id=$1 AND author_id=$2 AND (status='blocked' OR attempted_at > now()-interval '1 day') LIMIT 1",
    [account.id, item.author_id],
  );
  if (recent.length) {
    await query(
      "UPDATE interactions SET status='ignored' WHERE account_id=$1 AND id=$2 AND status='review'",
      [account.id, id],
    );
    return;
  }
  // Verify the target still exists before publishing a reply.
  await accountXRequest(account.id, token, `/tweets/${id}`);
  // A denied reservation must leave the interaction reviewable, never ambiguous.
  await reserveUsage(account.id, { xRequests: 1, xCredits: 3 });
  // Durable claim precedes the external side effect. An interrupted/ambiguous send is NEVER retried.
  const claimed = await query(
    "UPDATE interactions SET status='sending',attempted_at=now(),block_requested=$3 WHERE account_id=$1 AND id=$2 AND status='review' RETURNING id",
    [account.id, id, account.settings.block],
  );
  if (!claimed.length) return;
  try {
    const result = await xRequest<{ data: { id: string } }>(token, "/tweets", {
      method: "POST",
      body: JSON.stringify({
        text: BPN_REPLY,
        reply: { in_reply_to_tweet_id: id },
      }),
    });
    if (!result.data?.id)
      throw new Error("Respuesta de publicación incompleta");
    await query(
      "UPDATE interactions SET status='replied',reply_id=$3,error=NULL WHERE account_id=$1 AND id=$2",
      [account.id, id, result.data.id],
    );
  } catch {
    await query(
      "UPDATE interactions SET status='error',error=$3 WHERE account_id=$1 AND id=$2",
      [
        account.id,
        id,
        "No se ha podido confirmar el envío. Comprueba X; no se reenviará automáticamente para evitar duplicados.",
      ],
    );
    throw new HttpError(
      502,
      "No se ha podido confirmar el envío. Comprueba X; no se reenviará automáticamente.",
    );
  }
  if (account.settings.block) await blockAuthor(account.id, token, item);
}

async function blockAuthor(
  accountId: string,
  token: string,
  item: Interaction,
) {
  try {
    const result = await accountXRequest<{ data?: { blocking?: boolean } }>(
      accountId,
      token,
      `/users/${accountId}/blocking`,
      {
        method: "POST",
        body: JSON.stringify({ target_user_id: item.author_id }),
      },
    );
    if (result.data?.blocking !== true)
      throw new Error("X no ha confirmado el bloqueo.");
    await query(
      "UPDATE interactions SET status='blocked',error=NULL WHERE account_id=$1 AND id=$2 AND status='replied'",
      [accountId, item.id],
    );
  } catch (error) {
    await query(
      "UPDATE interactions SET error=$3 WHERE account_id=$1 AND id=$2",
      [
        accountId,
        item.id,
        "Respuesta enviada; bloqueo pendiente. Se reintentará sin repetir la respuesta.",
      ],
    );
    throw error;
  }
}

export async function recoverSideEffects(
  account: Account,
  token: string,
  deadline: number,
) {
  await query(
    "UPDATE interactions SET status='error',error='Envío interrumpido. Comprueba X; no se reenviará automáticamente.' WHERE account_id=$1 AND status='sending' AND attempted_at < now()-interval '2 minutes'",
    [account.id],
  );
  const pendingBlocks = await query<Interaction>(
    "SELECT * FROM interactions WHERE account_id=$1 AND status='replied' AND block_requested=true LIMIT 3",
    [account.id],
  );
  for (const item of pendingBlocks) {
    if (Date.now() > deadline) return;
    await blockAuthor(account.id, token, item);
  }
}

export async function processModeration(
  account: Account,
  token: string,
  deadline: number,
) {
  const items = await query<Interaction>(
    "SELECT * FROM interactions WHERE account_id=$1 AND status='pending' ORDER BY created_at,id LIMIT 5",
    [account.id],
  );
  for (const item of items) {
    if (Date.now() > deadline) return;
    if (isOptOut(item.text))
      await query(
        "INSERT INTO opt_outs(account_id,author_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [account.id, item.author_id],
      );
    if (await excluded(account, item)) {
      await query(
        "UPDATE interactions SET status='ignored' WHERE account_id=$1 AND id=$2",
        [account.id, item.id],
      );
      continue;
    }
    let decision: Decision;
    await reserveUsage(account.id, { analyses: 1 });
    try {
      decision = await evaluate(item.text);
    } catch {
      // Provider failure leaves the item pending: no guessed classification and no action.
      throw new HttpError(
        503,
        "JEV no ha podido evaluar la interacción. Se mantiene pendiente, sin responder ni bloquear.",
      );
    }
    const route = routeDecision(decision, account.settings, item.direct_reply);
    if (decision.optOut >= 0.5)
      await query(
        "INSERT INTO opt_outs(account_id,author_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [account.id, item.author_id],
      );
    if (route === "send" && Date.now() >= deadline) return;
    await query(
      "UPDATE interactions SET decision=$3::jsonb,status=$4 WHERE account_id=$1 AND id=$2",
      [
        account.id,
        item.id,
        JSON.stringify(decision),
        route === "send" ? "review" : route,
      ],
    );
    if (route === "send") await replyAndBlock(account, token, item.id);
  }
}
