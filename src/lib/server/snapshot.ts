import "server-only";
import type { Snapshot, Interaction } from "../domain";
import { query } from "./db";
import type { Account } from "./x";
import { billingSnapshot } from "./billing-access";

export async function snapshot(account: Account): Promise<Snapshot> {
  const [interactions, stats, billing] = await Promise.all([
    query<Interaction>(
      "SELECT id,author_id,username,name,text,created_at,direct_reply,decision,status,reply_id,error FROM interactions WHERE account_id=$1 ORDER BY created_at DESC LIMIT 100",
      [account.id],
    ),
    query<Snapshot["stats"]>(
      `SELECT
      (SELECT count(*)::int FROM interactions WHERE account_id=$1 AND decision IS NOT NULL) AS analyzed,
      (SELECT count(*)::int FROM interactions WHERE account_id=$1 AND (decision->>'abuse')::numeric >= $2) AS flagged,
      (SELECT count(*)::int FROM interactions WHERE account_id=$1 AND status='blocked') AS blocked`,
      [account.id, account.settings.threshold],
    ),
    billingSnapshot(account.id),
  ]);
  return {
    mode: "live",
    billing,
    account: { id: account.id, username: account.username, name: account.name },
    settings: account.settings,
    interactions,
    stats: stats[0],
    lastSync: account.last_sync,
    lastError: account.last_error,
  };
}
