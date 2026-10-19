import { sameSecret } from "@/lib/server/crypto";
import { query, BusyError } from "@/lib/server/db";
import { runAccount } from "@/lib/server/worker";
import {
  billingConfigured,
  paidSubscriptionSql,
} from "@/lib/server/billing-access";

export const maxDuration = 60;
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (
    !secret ||
    !sameSecret(request.headers.get("authorization") ?? "", `Bearer ${secret}`)
  )
    return Response.json({ error: "No autorizado" }, { status: 401 });
  if (!billingConfigured()) return Response.json({ processed: 0 });
  const [account] = await query<{
    id: string;
  }>(
    `SELECT id FROM accounts a WHERE tokens <> ''
    AND EXISTS(SELECT 1 FROM billing_subscriptions s WHERE s.account_id=a.id AND ${paidSubscriptionSql.replaceAll("$2", "$1")})
    AND (retry_at IS NULL OR retry_at <= now()) AND (
      (settings->>'enabled')::boolean = true OR
      EXISTS(SELECT 1 FROM interactions WHERE account_id=a.id AND (status='sending' OR status='replied' AND mute_requested=true))
    ) ORDER BY last_work_at ASC NULLS FIRST LIMIT 1`,
    [process.env.STRIPE_PRICE_ID],
  );
  if (!account) return Response.json({ processed: 0 });
  try {
    await runAccount(account.id);
    return Response.json({ processed: 1 });
  } catch (error) {
    return Response.json(
      { processed: 0, deferred: error instanceof BusyError },
      { status: error instanceof BusyError ? 200 : 503 },
    );
  }
}
