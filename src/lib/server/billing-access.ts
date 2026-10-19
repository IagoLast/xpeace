import "server-only";
import type { Billing, Usage } from "../domain";
import { query } from "./db";

export class BillingError extends Error {
  constructor(
    message: string,
    public retryAt?: Date,
  ) {
    super(message);
  }
  readonly status = 402;
}

export function billingConfigured() {
  return [
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_PRICE_ID",
  ].every((key) => !!process.env[key]);
}

export function planLimits(): Usage {
  function limit(name: string, fallback: number) {
    const value = Number(process.env[name] ?? fallback);
    if (!Number.isSafeInteger(value) || value < 1 || value > 1_000_000)
      throw new Error(`Configura un cupo válido en ${name}.`);
    return value;
  }
  return {
    xRequests: limit("BILLING_X_REQUESTS_LIMIT", 2000),
    xCredits: limit("BILLING_X_CREDITS_LIMIT", 200),
    analyses: limit("BILLING_ANALYSES_LIMIT", 100),
  };
}

// Keep the same entitlement predicate for UI, workers and atomic reservations.
export const paidSubscriptionSql = `s.status='active' AND s.paid=true
  AND s.price_id=$2 AND s.period_start <= now() AND s.period_end > now()`;

type SubscriptionRow = {
  id: string;
  status: string;
  paid: boolean;
  price_id: string;
  period_start: string;
  period_end: string;
  cancel_at_period_end: boolean;
};

export async function billingSnapshot(accountId: string): Promise<Billing> {
  const configured = billingConfigured();
  const [subscriptions, customers] = await Promise.all([
    query<SubscriptionRow>(
      `SELECT * FROM billing_subscriptions s WHERE account_id=$1
      ORDER BY (${paidSubscriptionSql}) DESC, period_end DESC, updated_at DESC LIMIT 1`,
      [accountId, process.env.STRIPE_PRICE_ID ?? ""],
    ),
    query<{ customer_id: string | null }>(
      "SELECT customer_id FROM billing_accounts WHERE account_id=$1",
      [accountId],
    ),
  ]);
  const subscription = subscriptions[0];
  const usage = subscription
    ? (
        await query<{
          x_requests: number;
          x_credits: number;
          x_credit_limit: number;
          analyses: number;
          x_limit: number;
          analysis_limit: number;
        }>(
          "SELECT * FROM billing_usage WHERE subscription_id=$1 AND period_start=$2",
          [subscription.id, subscription.period_start],
        )
      )[0]
    : undefined;
  return {
    configured,
    active: !!(
      configured &&
      subscription?.status === "active" &&
      subscription.paid &&
      subscription.price_id === process.env.STRIPE_PRICE_ID &&
      new Date(subscription.period_start).getTime() <= Date.now() &&
      new Date(subscription.period_end).getTime() > Date.now()
    ),
    status: subscription?.status ?? "none",
    hasCustomer: !!customers[0]?.customer_id,
    periodEnd: subscription
      ? new Date(subscription.period_end).toISOString()
      : null,
    cancelAtPeriodEnd: subscription?.cancel_at_period_end ?? false,
    used: {
      xRequests: usage?.x_requests ?? 0,
      xCredits: usage?.x_credits ?? 0,
      analyses: usage?.analyses ?? 0,
    },
    limits: usage
      ? {
          xRequests: usage.x_limit,
          xCredits: usage.x_credit_limit,
          analyses: usage.analysis_limit,
        }
      : planLimits(),
  };
}

export async function requireSubscription(accountId: string) {
  if (!billingConfigured())
    throw new BillingError("Las suscripciones todavía no están disponibles.");
  const rows = await query(
    `SELECT id FROM billing_subscriptions s
    WHERE account_id=$1 AND ${paidSubscriptionSql} LIMIT 1`,
    [accountId, process.env.STRIPE_PRICE_ID],
  );
  if (!rows.length)
    throw new BillingError(
      "Necesitas una suscripción activa y pagada para usar este servicio.",
    );
}

// Reserve before contacting a provider. Failed/ambiguous attempts count too:
// refunding them could allow unlimited provider spend through repeated failures.
// One SQL statement enforces all counters together, even across concurrent workers.
export async function reserveUsage(accountId: string, amount: Partial<Usage>) {
  if (!billingConfigured())
    throw new BillingError("Las suscripciones todavía no están disponibles.");
  const limits = planLimits();
  const delta = {
    xRequests: 0,
    xCredits: 0,
    analyses: 0,
    ...amount,
  };
  if (Object.values(delta).some((n) => !Number.isSafeInteger(n) || n < 0))
    throw new Error("Reserva de consumo inválida.");
  // The retired cleanup_limit column is still required by existing databases.
  const rows = await query<{ subscription_id: string; period_start: string }>(
    `INSERT INTO billing_usage AS u
      (subscription_id,period_start,x_requests,analyses,x_limit,analysis_limit,x_credits,x_credit_limit,cleanup_limit)
    SELECT s.id,s.period_start,$3,$4,$5,$6,$7,$8,1 FROM billing_subscriptions s
    WHERE s.account_id=$1 AND ${paidSubscriptionSql}
      AND $3::int <= $5::int AND $4::int <= $6::int AND $7::int <= $8::int
    ORDER BY s.period_end DESC LIMIT 1
    ON CONFLICT(subscription_id,period_start) DO UPDATE SET
      x_requests=u.x_requests+EXCLUDED.x_requests,
      x_credits=u.x_credits+EXCLUDED.x_credits,
      analyses=u.analyses+EXCLUDED.analyses
    WHERE u.x_requests+EXCLUDED.x_requests <= u.x_limit
      AND u.analyses+EXCLUDED.analyses <= u.analysis_limit
      AND u.x_credits+EXCLUDED.x_credits <= u.x_credit_limit
    RETURNING subscription_id,period_start`,
    [
      accountId,
      process.env.STRIPE_PRICE_ID,
      delta.xRequests,
      delta.analyses,
      limits.xRequests,
      limits.analyses,
      delta.xCredits,
      limits.xCredits,
    ],
  );
  if (!rows.length) {
    await requireSubscription(accountId);
    const billing = await billingSnapshot(accountId);
    throw new BillingError(
      "Has agotado el cupo de este período. El trabajo queda pausado hasta la renovación.",
      billing.periodEnd ? new Date(billing.periodEnd) : undefined,
    );
  }
  // A receipt pins refunds to this period even if a renewal arrives in flight.
  let settled = false;
  return {
    async settleXCredits(actual: number) {
      if (
        settled ||
        !Number.isSafeInteger(actual) ||
        actual < 0 ||
        actual > delta.xCredits
      )
        throw new Error("Liquidación de créditos inválida.");
      settled = true;
      if (actual === delta.xCredits) return;
      await query(
        `UPDATE billing_usage SET x_credits=x_credits-$3
        WHERE subscription_id=$1 AND period_start=$2 AND x_credits >= $3`,
        [
          rows[0].subscription_id,
          rows[0].period_start,
          delta.xCredits - actual,
        ],
      );
    },
  };
}
