import "server-only";
import type { Snapshot, Interaction, CleanupJob } from "../domain";
import { query } from "./db";
import type { Account } from "./x";
import { billingSnapshot } from "./billing-access";

export async function snapshot(account: Account): Promise<Snapshot> {
  const [interactions, jobs, stats, preview, billing] = await Promise.all([
    query<Interaction>(
      "SELECT id,author_id,username,name,text,created_at,direct_reply,decision,status,reply_id,error FROM interactions WHERE account_id=$1 ORDER BY created_at DESC LIMIT 100",
      [account.id],
    ),
    query<CleanupJob>(
      "SELECT * FROM cleanup_jobs WHERE account_id=$1 ORDER BY created_at DESC LIMIT 15",
      [account.id],
    ),
    query<Snapshot["stats"]>(
      `SELECT
      (SELECT count(*)::int FROM interactions WHERE account_id=$1 AND decision IS NOT NULL) AS analyzed,
      (SELECT count(*)::int FROM interactions WHERE account_id=$1 AND (decision->>'abuse')::numeric >= $2) AS flagged,
      (SELECT count(*)::int FROM interactions WHERE account_id=$1 AND status='blocked') AS blocked,
      (SELECT coalesce(sum(done),0)::int FROM cleanup_jobs WHERE account_id=$1) AS deleted`,
      [account.id, account.settings.threshold],
    ),
    query<Snapshot["preview"][number]>(
      `SELECT id,text,kind,created_at FROM cleanup_items WHERE job_id=(SELECT id FROM cleanup_jobs WHERE account_id=$1 ORDER BY created_at DESC LIMIT 1) ORDER BY created_at LIMIT 8`,
      [account.id],
    ),
    billingSnapshot(account.id),
  ]);
  return {
    mode: "live",
    billing,
    account: { id: account.id, username: account.username, name: account.name },
    settings: account.settings,
    interactions,
    jobs,
    stats: stats[0],
    preview,
    lastSync: account.last_sync,
    lastError: account.last_error,
  };
}
