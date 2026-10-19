import "server-only";
import type Stripe from "stripe";
import { appUrl, required } from "./config";
import { query, withAccountLock } from "./db";
import { HttpError } from "./auth";
import { billingConfigured, planLimits } from "./billing-access";
import { stripe } from "./stripe";

type CustomerRow = {
  customer_id: string | null;
  checkout_session_id: string | null;
  checkout_attempt: string | null;
  checkout_expires_at: string | number | null;
};
const idOf = (value: string | { id: string } | null | undefined) =>
  typeof value === "string" ? value : value?.id;

function requireConfiguration() {
  if (!billingConfigured())
    throw new HttpError(503, "Las suscripciones todavía no están disponibles.");
}

// Called under the billing account lease. Always fetch current state from Stripe:
// delayed/duplicated webhooks must not restore a canceled or unpaid subscription.
async function syncSubscription(
  accountId: string,
  customerId: string,
  subscriptionId: string,
) {
  const subscription = await stripe().subscriptions.retrieve(subscriptionId, {
    expand: ["latest_invoice"],
  });
  if (idOf(subscription.customer) !== customerId)
    throw new Error("La suscripción no pertenece a este cliente.");
  const item = subscription.items.data[0];
  if (!item) throw new Error("Suscripción sin período de facturación.");
  const invoice = subscription.latest_invoice;
  const validPlan =
    subscription.items.data.length === 1 &&
    !subscription.items.has_more &&
    item.price.id === required("STRIPE_PRICE_ID") &&
    item.quantity === 1 &&
    item.price.recurring?.interval === "month" &&
    item.price.recurring.interval_count === 1;
  const paid =
    validPlan &&
    !!invoice &&
    typeof invoice !== "string" &&
    invoice.status === "paid";
  const start = new Date(item.current_period_start * 1000);
  const end = new Date(item.current_period_end * 1000);
  await query(
    `INSERT INTO billing_subscriptions
    (id,account_id,status,price_id,paid,period_start,period_end,cancel_at_period_end)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,price_id=EXCLUDED.price_id,
      paid=EXCLUDED.paid,period_start=EXCLUDED.period_start,period_end=EXCLUDED.period_end,
      cancel_at_period_end=EXCLUDED.cancel_at_period_end,updated_at=now()
    WHERE billing_subscriptions.account_id=EXCLUDED.account_id`,
    [
      subscription.id,
      accountId,
      subscription.status,
      item.price.id,
      paid,
      start,
      end,
      subscription.cancel_at_period_end || !!subscription.cancel_at,
    ],
  );
  if (paid && subscription.status === "active") {
    const limits = planLimits();
    await query(
      `INSERT INTO billing_usage(subscription_id,period_start,x_limit,analysis_limit,cleanup_limit,x_credit_limit)
      VALUES($1,$2,$3,$4,1,$5) ON CONFLICT DO NOTHING`,
      [
        subscription.id,
        start,
        limits.xRequests,
        limits.analyses,
        limits.xCredits,
      ],
    );
    // Payment recovery or a new subscription can restore access before a prior
    // billing pause expires. Preserve provider rate-limit backoffs.
    await query(
      `UPDATE accounts SET retry_at=NULL,last_error=NULL WHERE id=$1
      AND (last_error LIKE 'Has agotado el cupo%' OR last_error LIKE 'Necesitas una suscripción%')`,
      [accountId],
    );
  }
  return subscription;
}

async function syncCustomer(accountId: string, customerId: string) {
  const subscriptions = await stripe()
    .subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 100,
    })
    .autoPagingToArray({ limit: 1000 });
  for (const subscription of subscriptions) {
    // Ignore other products on an existing Stripe customer, but keep tracking a
    // subscription moved away from our price so its former access is revoked.
    const known = await query(
      "SELECT id FROM billing_subscriptions WHERE id=$1 AND account_id=$2",
      [subscription.id, accountId],
    );
    if (
      known.length ||
      subscription.metadata.xpeace_account_id === accountId ||
      subscription.items.data.some(
        (item) => item.price.id === required("STRIPE_PRICE_ID"),
      )
    )
      await syncSubscription(accountId, customerId, subscription.id);
  }
  return subscriptions;
}

async function portal(customer: string, subscription?: string) {
  const session = await stripe().billingPortal.sessions.create({
    customer,
    ...(subscription
      ? {
          flow_data: {
            type: "subscription_cancel" as const,
            subscription_cancel: { subscription },
            after_completion: {
              type: "redirect" as const,
              redirect: { return_url: `${appUrl()}/?billing=return` },
            },
          },
        }
      : {}),
    return_url: `${appUrl()}/?billing=return`,
    ...(process.env.STRIPE_PORTAL_CONFIGURATION_ID
      ? { configuration: process.env.STRIPE_PORTAL_CONFIGURATION_ID }
      : {}),
  });
  return session.url;
}

export async function createPortal(accountId: string) {
  requireConfiguration();
  const [row] = await query<CustomerRow>(
    "SELECT * FROM billing_accounts WHERE account_id=$1",
    [accountId],
  );
  if (!row?.customer_id)
    throw new HttpError(409, "Esta cuenta todavía no tiene una suscripción.");
  return portal(row.customer_id);
}

export async function createCancellationPortal(accountId: string) {
  requireConfiguration();
  return withAccountLock(`billing:${accountId}`, async () => {
    const [row] = await query<CustomerRow>(
      "SELECT * FROM billing_accounts WHERE account_id=$1",
      [accountId],
    );
    if (!row?.customer_id)
      throw new HttpError(409, "No tienes una suscripción que cancelar.");
    const subscriptions = await syncCustomer(accountId, row.customer_id);
    const subscription = subscriptions.find(
      (s) =>
        !["canceled", "incomplete_expired"].includes(s.status) &&
        (s.metadata.xpeace_account_id === accountId ||
          s.items.data.some(
            (item) => item.price.id === required("STRIPE_PRICE_ID"),
          )),
    );
    if (!subscription)
      throw new HttpError(409, "No tienes una suscripción que cancelar.");
    return portal(row.customer_id, subscription.id);
  });
}

export async function refreshBilling(accountId: string) {
  requireConfiguration();
  await withAccountLock(`billing:${accountId}`, async () => {
    const [row] = await query<CustomerRow>(
      "SELECT * FROM billing_accounts WHERE account_id=$1",
      [accountId],
    );
    if (row?.customer_id) await syncCustomer(accountId, row.customer_id);
  });
}

export async function createCheckout(accountId: string) {
  requireConfiguration();
  return withAccountLock(`billing:${accountId}`, async () => {
    const client = stripe();
    const price = await client.prices.retrieve(required("STRIPE_PRICE_ID"));
    if (
      !price.active ||
      price.type !== "recurring" ||
      price.recurring?.interval !== "month" ||
      price.recurring.interval_count !== 1 ||
      price.recurring.usage_type !== "licensed" ||
      price.billing_scheme !== "per_unit" ||
      !price.unit_amount ||
      price.unit_amount <= 0
    )
      throw new HttpError(
        503,
        "El plan mensual todavía no está configurado correctamente.",
      );
    await query(
      "INSERT INTO billing_accounts(account_id) VALUES($1) ON CONFLICT DO NOTHING",
      [accountId],
    );
    const [row] = await query<CustomerRow>(
      "SELECT * FROM billing_accounts WHERE account_id=$1",
      [accountId],
    );
    let customerId = row.customer_id;
    if (!customerId) {
      const customer = await client.customers.create(
        { metadata: { xpeace_account_id: accountId } },
        { idempotencyKey: `xpeace-customer:${accountId}` },
      );
      customerId = customer.id;
      await query(
        "UPDATE billing_accounts SET customer_id=$2 WHERE account_id=$1",
        [accountId, customerId],
      );
    }
    const subscriptions = await syncCustomer(accountId, customerId);
    if (
      subscriptions.some(
        (s) =>
          !["canceled", "incomplete_expired"].includes(s.status) &&
          (s.metadata.xpeace_account_id === accountId ||
            s.items.data.some((i) => i.price.id === price.id)),
      )
    )
      return portal(customerId);

    if (row.checkout_session_id) {
      const session = await client.checkout.sessions.retrieve(
        row.checkout_session_id,
      );
      if (session.status === "open" && session.url) {
        if (
          session.allow_promotion_codes &&
          session.payment_method_collection === "if_required"
        )
          return session.url;
        await client.checkout.sessions.expire(session.id);
      }
      // A completed checkout may precede the subscription webhook. Reconcile it
      // directly rather than letting a second click buy another subscription.
      if (session.status === "complete" && idOf(session.subscription)) {
        const subscription = await syncSubscription(
          accountId,
          customerId,
          idOf(session.subscription)!,
        );
        if (!["canceled", "incomplete_expired"].includes(subscription.status))
          return portal(customerId);
      }
    }
    const now = Math.floor(Date.now() / 1000);
    let attempt = row.checkout_attempt;
    let expires = Number(row.checkout_expires_at ?? 0);
    if (!attempt || expires <= now || row.checkout_session_id) {
      attempt = crypto.randomUUID();
      expires = now + 3600;
      await query(
        `UPDATE billing_accounts SET checkout_attempt=$2,checkout_expires_at=$3,
        checkout_session_id=NULL WHERE account_id=$1`,
        [accountId, attempt, expires],
      );
    }
    const session = await client.checkout.sessions.create(
      {
        mode: "subscription",
        allow_promotion_codes: true,
        payment_method_collection: "if_required",
        customer: customerId,
        client_reference_id: accountId,
        line_items: [{ price: price.id, quantity: 1 }],
        subscription_data: { metadata: { xpeace_account_id: accountId } },
        success_url: `${appUrl()}/?billing=success`,
        cancel_url: `${appUrl()}/?billing=cancelled`,
        expires_at: expires,
      },
      { idempotencyKey: `xpeace-checkout:${accountId}:${attempt}` },
    );
    if (!session.url) throw new Error("Stripe no devolvió una página de pago.");
    await query(
      "UPDATE billing_accounts SET checkout_session_id=$2 WHERE account_id=$1",
      [accountId, session.id],
    );
    return session.url;
  });
}

export async function processStripeEvent(event: Stripe.Event) {
  let customerId: string | undefined;
  let subscriptionId: string | undefined;
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
    case "checkout.session.async_payment_failed":
      customerId = idOf(event.data.object.customer);
      subscriptionId = idOf(event.data.object.subscription);
      break;
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.paused":
    case "customer.subscription.resumed":
      customerId = idOf(event.data.object.customer);
      subscriptionId = event.data.object.id;
      break;
    case "invoice.paid":
    case "invoice.payment_failed":
    case "invoice.payment_action_required":
      customerId = idOf(event.data.object.customer);
      subscriptionId = idOf(
        event.data.object.parent?.subscription_details?.subscription,
      );
      break;
    default:
      return;
  }
  if (!customerId || !subscriptionId) return;
  const [owner] = await query<{ account_id: string }>(
    "SELECT account_id FROM billing_accounts WHERE customer_id=$1",
    [customerId],
  );
  if (!owner) return; // The customer mapping is created before checkout, never from untrusted metadata.
  await withAccountLock(`billing:${owner.account_id}`, async () => {
    if (
      (await query("SELECT id FROM stripe_events WHERE id=$1", [event.id]))
        .length
    )
      return;
    await syncSubscription(owner.account_id, customerId, subscriptionId);
    // Mark only after the durable state is saved; retries never reset usage.
    await query(
      "INSERT INTO stripe_events(id) VALUES($1) ON CONFLICT DO NOTHING",
      [event.id],
    );
  });
}
