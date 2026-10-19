import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { defaultSettings } from "@/lib/domain";

const mocks = vi.hoisted(() => ({ sql: vi.fn(), cookie: "" }));
vi.mock("@neondatabase/serverless", () => ({
  neon: () => ({ query: mocks.sql }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (mocks.cookie ? { value: mocks.cookie } : undefined),
    delete: vi.fn(),
  }),
}));
import { query } from "@/lib/server/db";
import { seal } from "@/lib/server/crypto";
import { billingSnapshot, reserveUsage } from "@/lib/server/billing-access";
import { createCheckout, refreshBilling } from "@/lib/server/billing";
import { stripe } from "@/lib/server/stripe";
import { accountXRequest, getAccount } from "@/lib/server/x";
import { runAccount } from "@/lib/server/worker";
import { replyAndMute } from "@/lib/server/moderation";
import { POST as webhook } from "@/app/api/billing/webhook/route";
import { POST as checkout } from "@/app/api/billing/checkout/route";
import { POST as cancelSubscription } from "@/app/api/billing/cancel/route";
import { POST as portal } from "@/app/api/billing/portal/route";
import { POST as actions } from "@/app/api/actions/route";
import { GET as cron } from "@/app/api/cron/route";

let db: PGlite;
const fetchMock = vi.fn();
const now = Math.floor(Date.now() / 1000);
const price = {
  id: "price_monthly",
  active: true,
  type: "recurring",
  unit_amount: 1200,
  currency: "eur",
  billing_scheme: "per_unit",
  recurring: { interval: "month", interval_count: 1, usage_type: "licensed" },
};
function subscription(overrides = {}) {
  return {
    id: "sub_1",
    object: "subscription",
    customer: "cus_1",
    status: "active",
    metadata: { xpeace_account_id: "1" },
    latest_invoice: { id: "in_1", status: "paid" },
    cancel_at_period_end: false,
    cancel_at: null,
    items: {
      data: [
        {
          id: "si_1",
          price,
          quantity: 1,
          current_period_start: now - 100,
          current_period_end: now + 86400,
        },
      ],
      has_more: false,
    },
    ...overrides,
  };
}
let remote: ReturnType<typeof subscription> | null;
let checkoutStatus: string;
let checkoutAllowsDiscounts: boolean;
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
const request = (
  path: string,
  data?: unknown,
  origin = "http://localhost:3000",
) =>
  new Request(`http://localhost:3000${path}`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
const paths = () => fetchMock.mock.calls.map(([url]) => String(url));

beforeAll(async () => {
  db = new PGlite();
  await db.exec(await readFile("db/001-initial.sql", "utf8"));
  await db.exec(await readFile("db/002-billing.sql", "utf8"));
  await db.exec(await readFile("db/002-billing.sql", "utf8"));
  await db.exec(await readFile("db/003-x-credits.sql", "utf8"));
  await db.exec(await readFile("db/003-x-credits.sql", "utf8"));
  await db.exec(await readFile("db/005-mutes.sql", "utf8"));
  await db.exec(await readFile("db/005-mutes.sql", "utf8"));
  mocks.sql.mockImplementation(
    async (sql, params) => (await db.query(sql, params)).rows,
  );
});
beforeEach(async () => {
  await db.exec(
    "TRUNCATE accounts CASCADE; TRUNCATE locks; TRUNCATE stripe_events;",
  );
  process.env.STRIPE_SECRET_KEY = "sk_test_fixture";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_fixture";
  process.env.STRIPE_PRICE_ID = price.id;
  process.env.BILLING_X_REQUESTS_LIMIT = "4";
  process.env.BILLING_ANALYSES_LIMIT = "2";
  process.env.BILLING_X_CREDITS_LIMIT = "200";
  process.env.CRON_SECRET = "cron_test";
  for (const id of ["1", "2"])
    await query(
      `INSERT INTO accounts(id,username,name,tokens,token_expires_at,settings)
    VALUES($1,$2,$2,$3,now()+interval '1 hour',$4::jsonb)`,
      [
        id,
        `user${id}`,
        seal(
          {
            access_token: "token",
            expires_in: 3600,
            scope: "users.read mute.read mute.write",
          },
          `tokens:${id}`,
        ),
        JSON.stringify({ ...defaultSettings, enabled: true }),
      ],
    );
  mocks.cookie = seal(
    { accountId: "1", version: 1, expires: Date.now() + 600_000 },
    "session",
  );
  remote = null;
  checkoutStatus = "open";
  checkoutAllowsDiscounts = true;
  fetchMock
    .mockReset()
    .mockImplementation(async (url: string, init: RequestInit) => {
      const path = new URL(url).pathname;
      if (path === "/v1/prices/price_monthly") return json(price);
      if (path === "/v1/customers" && init.method === "POST")
        return json({ id: "cus_1" });
      if (path === "/v1/subscriptions")
        return json({
          object: "list",
          data: remote ? [remote] : [],
          has_more: false,
        });
      if (path === "/v1/subscriptions/sub_1" && remote) return json(remote);
      if (path.startsWith("/v1/checkout/sessions"))
        return json({
          id: "cs_1",
          url: "https://checkout.stripe.com/c/pay/test",
          status: checkoutStatus,
          allow_promotion_codes: checkoutAllowsDiscounts,
          payment_method_collection: checkoutAllowsDiscounts
            ? "if_required"
            : "always",
          subscription: checkoutStatus === "complete" ? "sub_1" : null,
        });
      if (path === "/v1/billing_portal/sessions")
        return json({ url: "https://billing.stripe.com/p/session/test" });
      throw new Error(`Unexpected external request: ${init.method} ${path}`);
    });
  vi.stubGlobal("fetch", fetchMock);
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await db.close();
});

async function customer() {
  await query(
    "INSERT INTO billing_accounts(account_id,customer_id) VALUES('1','cus_1') ON CONFLICT DO NOTHING",
  );
}
async function activate() {
  await customer();
  remote = subscription();
  await refreshBilling("1");
  fetchMock.mockClear();
}
async function deliver(
  id = "evt_1",
  type = "customer.subscription.updated",
  object: unknown = { id: "sub_1", customer: "cus_1" },
) {
  const payload = JSON.stringify({
    id,
    object: "event",
    type,
    data: { object },
  });
  const signature = stripe().webhooks.generateTestHeaderString({
    payload,
    secret: "whsec_fixture",
  });
  return webhook(
    new Request("http://localhost:3000/api/billing/webhook", {
      method: "POST",
      body: payload,
      headers: { "stripe-signature": signature },
    }),
  );
}

describe("subscription checkout and ownership", () => {
  it("retries the same checkout with the same idempotency key after a persistence failure", async () => {
    const original = mocks.sql.getMockImplementation()!;
    let failed = false;
    mocks.sql.mockImplementation(async (sql, params) => {
      if (
        !failed &&
        sql.startsWith("UPDATE billing_accounts SET checkout_session_id=")
      ) {
        failed = true;
        throw new Error("temporary database failure after checkout creation");
      }
      return original(sql, params);
    });
    try {
      await expect(createCheckout("1")).rejects.toThrow("database failure");
      expect(await createCheckout("1")).toContain("checkout.stripe.com");
      const calls = fetchMock.mock.calls.filter(
        ([url, init]) =>
          String(url).endsWith("/checkout/sessions") && init.method === "POST",
      );
      expect(calls).toHaveLength(2);
      const keys = calls.map(([, init]) =>
        new Headers(init.headers).get("idempotency-key"),
      );
      expect(keys[0]).toBeTruthy();
      expect(keys[0]).toBe(keys[1]);
      expect(calls[0][1].body).toBe(calls[1][1].body);
    } finally {
      mocks.sql.mockImplementation(original);
    }
  });
  it("creates a hosted monthly checkout for the session account and reuses an open session", async () => {
    const response = await checkout(
      request("/api/billing/checkout", {
        accountId: "2",
        price: "price_attacker",
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url: "https://checkout.stripe.com/c/pay/test",
    });
    const call = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith("/checkout/sessions") && init.method === "POST",
    )!;
    const body = new URLSearchParams(call[1].body);
    expect(body.get("client_reference_id")).toBe("1");
    expect(body.get("line_items[0][price]")).toBe(price.id);
    expect(body.get("mode")).toBe("subscription");
    expect(body.get("allow_promotion_codes")).toBe("true");
    expect(body.get("payment_method_collection")).toBe("if_required");
    expect(await createCheckout("1")).toContain("checkout.stripe.com");
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) =>
          String(url).endsWith("/checkout/sessions") && init.method === "POST",
      ),
    ).toHaveLength(1);
    expect((await billingSnapshot("1")).active).toBe(false);
    expect((await billingSnapshot("2")).hasCustomer).toBe(false);
  });
  it("replaces an older open checkout so the customer can redeem a discount", async () => {
    await createCheckout("1");
    checkoutAllowsDiscounts = false;
    expect(await createCheckout("1")).toContain("checkout.stripe.com");
    expect(paths()).toContain(
      "https://api.stripe.com/v1/checkout/sessions/cs_1/expire",
    );
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) =>
          String(url).endsWith("/checkout/sessions") && init.method === "POST",
      ),
    ).toHaveLength(2);
  });
  it("uses the portal for an existing subscription instead of double charging", async () => {
    await activate();
    expect(await createCheckout("1")).toContain("billing.stripe.com");
    expect(paths().some((path) => path.includes("checkout/sessions"))).toBe(
      false,
    );
    expect(
      (await portal(request("/api/billing/portal", { customer: "cus_other" })))
        .status,
    ).toBe(200);
    const call = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("billing_portal"),
    )!;
    expect(new URLSearchParams(call[1].body).get("customer")).toBe("cus_1");
  });
  it("opens cancellation only for the authenticated account's subscription", async () => {
    await activate();
    const response = await cancelSubscription(
      request("/api/billing/cancel", {
        customer: "cus_other",
        subscription: "sub_other",
      }),
    );
    expect(response.status).toBe(200);
    const call = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("billing_portal"),
    )!;
    const body = new URLSearchParams(call[1].body);
    expect(body.get("customer")).toBe("cus_1");
    expect(body.get("flow_data[type]")).toBe("subscription_cancel");
    expect(body.get("flow_data[subscription_cancel][subscription]")).toBe(
      "sub_1",
    );
    expect(body.get("flow_data[after_completion][redirect][return_url]")).toBe(
      "http://localhost:3000/?billing=return",
    );
  });
  it("rejects cancellation without a session or from another origin", async () => {
    expect(
      (
        await cancelSubscription(
          request("/api/billing/cancel", undefined, "https://attacker.example"),
        )
      ).status,
    ).toBe(403);
    mocks.cookie = "";
    expect(
      (await cancelSubscription(request("/api/billing/cancel"))).status,
    ).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("ends the session while keeping BPN, tokens and subscription active", async () => {
    await activate();
    const before = await getAccount("1");
    expect(
      (await actions(request("/api/actions", { action: "logout" }))).status,
    ).toBe(200);
    const after = await getAccount("1");
    expect(after.tokens).toBe(before.tokens);
    expect(after.settings.enabled).toBe(true);
    expect(after.session_version).toBe(before.session_version + 1);
    expect((await billingSnapshot("1")).active).toBe(true);
    expect(
      (
        await actions(
          request("/api/actions", {
            action: "settings",
            settings: defaultSettings,
          }),
        )
      ).status,
    ).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rejects unauthenticated and cross-origin billing requests before contacting Stripe", async () => {
    mocks.cookie = "";
    expect((await checkout(request("/api/billing/checkout"))).status).toBe(401);
    mocks.cookie = seal(
      { accountId: "1", version: 1, expires: Date.now() + 10000 },
      "session",
    );
    expect(
      (
        await portal(
          request("/api/billing/portal", undefined, "https://attacker.example"),
        )
      ).status,
    ).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("signed Stripe events and paid periods", () => {
  it("grants access and normal usage limits for a fully discounted paid invoice", async () => {
    await customer();
    remote = subscription({
      latest_invoice: {
        id: "in_free",
        status: "paid",
        amount_due: 0,
        amount_paid: 0,
        total: 0,
        payment_intent: null,
      },
    });
    expect(
      (
        await deliver("evt_free", "checkout.session.completed", {
          customer: "cus_1",
          subscription: "sub_1",
          payment_status: "no_payment_required",
        })
      ).status,
    ).toBe(200);
    expect(await billingSnapshot("1")).toMatchObject({
      active: true,
      limits: { analyses: 2, xCredits: 200 },
    });
    await reserveUsage("1", { analyses: 1 });
    await deliver("evt_free_invoice", "invoice.paid", {
      customer: "cus_1",
      parent: { subscription_details: { subscription: "sub_1" } },
    });
    expect((await billingSnapshot("1")).used.analyses).toBe(1);
  });
  it("retries a failed webhook without losing the event", async () => {
    await customer();
    remote = subscription();
    fetchMock.mockResolvedValueOnce(
      json(
        {
          error: {
            type: "invalid_request_error",
            message: "temporary fixture error",
          },
        },
        404,
      ),
    );
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect((await deliver()).status).toBe(500);
      expect(await query("SELECT id FROM stripe_events")).toHaveLength(0);
      expect((await deliver()).status).toBe(200);
      expect((await billingSnapshot("1")).active).toBe(true);
    } finally {
      log.mockRestore();
    }
  });
  it("rejects a forged webhook without changing access", async () => {
    const response = await webhook(
      new Request("http://localhost/api/billing/webhook", {
        method: "POST",
        body: "{}",
        headers: { "stripe-signature": "t=1,v1=bad" },
      }),
    );
    expect(response.status).toBe(400);
    expect((await billingSnapshot("1")).active).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("activates only a paid current period and handles duplicates without resetting usage", async () => {
    await customer();
    remote = subscription({ latest_invoice: { id: "in_1", status: "open" } });
    expect((await deliver()).status).toBe(200);
    expect((await billingSnapshot("1")).active).toBe(false);
    remote = subscription();
    expect(
      (
        await deliver("evt_paid", "invoice.paid", {
          customer: "cus_1",
          parent: { subscription_details: { subscription: "sub_1" } },
        })
      ).status,
    ).toBe(200);
    await reserveUsage("1", { analyses: 1 });
    await deliver("evt_paid");
    await deliver("evt_another");
    expect(await billingSnapshot("1")).toMatchObject({
      active: true,
      used: { analyses: 1 },
    });
    expect((await billingSnapshot("2")).active).toBe(false);
  });
  it("fetches current state for delayed events, retaining cancellation until the paid period ends", async () => {
    await activate();
    remote = subscription({ cancel_at_period_end: true });
    await deliver("evt_cancel_scheduled");
    expect(await billingSnapshot("1")).toMatchObject({
      active: true,
      cancelAtPeriodEnd: true,
    });
    remote = subscription({ status: "canceled" });
    await deliver("evt_deleted", "customer.subscription.deleted");
    await deliver(
      "evt_late_old",
      "customer.subscription.created",
      subscription(),
    );
    expect((await billingSnapshot("1")).active).toBe(false);
    await expect(reserveUsage("1", { analyses: 1 })).rejects.toThrow(
      "activa y pagada",
    );
  });
  it("pauses on failed renewal and grants a fresh quota after successful payment", async () => {
    await activate();
    await reserveUsage("1", { analyses: 2 });
    remote = subscription({
      status: "past_due",
      latest_invoice: { id: "in_2", status: "open" },
    });
    await deliver("evt_failed", "invoice.payment_failed", {
      customer: "cus_1",
      parent: { subscription_details: { subscription: "sub_1" } },
    });
    await expect(reserveUsage("1", { analyses: 1 })).rejects.toThrow(
      "activa y pagada",
    );
    remote = subscription({
      items: {
        data: [
          {
            id: "si_1",
            price,
            quantity: 1,
            current_period_start: now - 1,
            current_period_end: now + 2592000,
          },
        ],
        has_more: false,
      },
    });
    await deliver("evt_renewed");
    expect(await billingSnapshot("1")).toMatchObject({
      active: true,
      used: { analyses: 0 },
    });
    await reserveUsage("1", { analyses: 1 });
    expect(await query("SELECT * FROM billing_usage")).toHaveLength(2);
  });
  it("rejects a foreign price and an expired period even if Stripe reports active", async () => {
    await activate();
    remote = subscription({
      items: {
        data: [
          {
            price: { ...price, id: "price_other" },
            quantity: 1,
            current_period_start: now - 100,
            current_period_end: now + 86400,
          },
        ],
        has_more: false,
      },
    });
    await deliver();
    expect((await billingSnapshot("1")).active).toBe(false);
    await query(
      "UPDATE billing_subscriptions SET price_id=$1,paid=true,period_end=now()-interval '1 second'",
      [price.id],
    );
    await expect(reserveUsage("1", { analyses: 1 })).rejects.toThrow(
      "activa y pagada",
    );
  });
});

describe("cost controls on real worker and API paths", () => {
  it.each(["preview", "confirm", "cancel", "work"])(
    "rejects the retired %s action even for a paid account",
    async (action) => {
      await activate();
      const response = await actions(
        request("/api/actions", {
          action,
          id: "00000000-0000-4000-8000-000000000001",
          kinds: ["tweets"],
          before: "2025-01-01",
          confirmation: "BORRAR",
        }),
      );
      expect(response.status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
  it("does not schedule legacy cleanup jobs or allow deletion through the X adapter", async () => {
    await activate();
    await query(
      "UPDATE accounts SET settings=jsonb_set(settings,'{enabled}','false')",
    );
    await query(`INSERT INTO cleanup_jobs(id,account_id,kinds,before_date,phase,status)
      VALUES('00000000-0000-4000-8000-000000000001','1',ARRAY['tweets'],'2025-01-01','tweets','running')`);
    const response = await cron(
      new Request("http://localhost/api/cron", {
        headers: { authorization: "Bearer cron_test" },
      }),
    );
    expect(await response.json()).toEqual({ processed: 0 });
    await runAccount("1");
    for (const path of ["/tweets/10", "/users/1/likes/10"])
      await expect(
        accountXRequest("1", "token", path, { method: "DELETE" }),
      ).rejects.toThrow("Operación de X sin presupuesto definido");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("persists sensitivity changes and rejects values outside the supported range", async () => {
    await activate();
    for (const threshold of [0.59, 1]) {
      const response = await actions(
        request("/api/actions", {
          action: "settings",
          settings: { ...defaultSettings, enabled: true, threshold },
        }),
      );
      expect(response.status).toBe(400);
    }
    expect((await getAccount("1")).settings.threshold).toBe(0.9);
    const settings = {
      ...defaultSettings,
      enabled: true,
      threshold: 0.85,
      allowlist: ["amigo"],
    };
    expect(
      (await actions(request("/api/actions", { action: "settings", settings })))
        .status,
    ).toBe(200);
    expect((await getAccount("1")).settings).toEqual(settings);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("fails closed without billing configuration or subscription, including cron and activation", async () => {
    const response = await actions(
      request("/api/actions", {
        action: "settings",
        settings: { ...defaultSettings, enabled: true },
      }),
    );
    expect(response.status).toBe(402);
    await expect(runAccount("1", true)).rejects.toMatchObject({ status: 402 });
    const responseCron = await cron(
      new Request("http://localhost/api/cron", {
        headers: { authorization: "Bearer cron_test" },
      }),
    );
    expect(await responseCron.json()).toEqual({ processed: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    await activate();
    delete process.env.STRIPE_SECRET_KEY;
    await expect(
      accountXRequest("1", "token", "/users/1/mentions"),
    ).rejects.toThrow("no están disponibles");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("reserves quotas atomically under concurrent requests and keeps failed attempts counted", async () => {
    await activate();
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => reserveUsage("1", { analyses: 1 })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect((await billingSnapshot("1")).used.analyses).toBe(2);
    fetchMock.mockRejectedValue(new Error("provider offline"));
    await expect(accountXRequest("1", "token", "/tweets/1")).rejects.toThrow(
      "offline",
    );
    expect((await billingSnapshot("1")).used.xRequests).toBe(1);
    await expect(reserveUsage("2", { analyses: 1 })).rejects.toThrow(
      "activa y pagada",
    );
  });
  it("charges posts and expanded authors, releasing only unused page credits", async () => {
    await activate();
    fetchMock.mockImplementation(async (url: string) => {
      expect(new URL(url).searchParams.get("max_results")).toBe("20");
      expect((await billingSnapshot("1")).used.xCredits).toBe(60);
      return json({
        data: [{ id: "10" }, { id: "11" }],
        includes: { users: [{ id: "2" }] },
      });
    });
    await accountXRequest(
      "1",
      "token",
      "/users/1/mentions?max_results=100&expansions=author_id",
    );
    expect((await billingSnapshot("1")).used).toMatchObject({
      xCredits: 4,
      xRequests: 1,
    });
    fetchMock.mockResolvedValue(json({ meta: { result_count: 0 } }));
    await accountXRequest(
      "1",
      "token",
      "/users/1/mentions?expansions=author_id",
    );
    expect((await billingSnapshot("1")).used).toMatchObject({
      xCredits: 4,
      xRequests: 2,
    });
  });
  it("shrinks pages to the balance and stops before spending below X's minimum page size", async () => {
    await activate();
    await reserveUsage("1", { xCredits: 185 });
    fetchMock.mockImplementation(async (url: string) => {
      expect(new URL(url).searchParams.get("max_results")).toBe("5");
      return json({
        data: Array.from({ length: 5 }, (_, id) => ({ id: String(id) })),
        includes: { users: [{ id: "2" }] },
      });
    });
    await accountXRequest(
      "1",
      "token",
      "/users/1/mentions?max_results=100&expansions=author_id",
    );
    expect((await billingSnapshot("1")).used.xCredits).toBe(192);
    await expect(
      accountXRequest("1", "token", "/users/1/mentions?expansions=author_id"),
    ).rejects.toMatchObject({ status: 402 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValue(json({ data: { muting: true } }));
    await accountXRequest("1", "token", "/users/1/muting", {
      method: "POST",
    });
    expect((await billingSnapshot("1")).used.xCredits).toBe(195);
  });
  it("does not overspend credits under concurrency or refund an ambiguous page", async () => {
    await activate();
    await reserveUsage("1", { xCredits: 180 });
    fetchMock.mockRejectedValue(new Error("network interrupted"));
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        accountXRequest(
          "1",
          "token",
          "/users/1/mentions?max_results=100&expansions=author_id",
        ),
      ),
    );
    expect(results.every((r) => r.status === "rejected")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await billingSnapshot("1")).used.xCredits).toBe(198);
  });
  it("settles only once and against the original period across renewal", async () => {
    await activate();
    const receipt = await reserveUsage("1", { xCredits: 20 });
    remote!.items.data[0].current_period_start = now - 10;
    await refreshBilling("1");
    await reserveUsage("1", { xCredits: 10 });
    await receipt.settleXCredits(3);
    await expect(receipt.settleXCredits(3)).rejects.toThrow("inválida");
    expect((await billingSnapshot("1")).used.xCredits).toBe(10);
    expect(
      await query("SELECT x_credits FROM billing_usage ORDER BY period_start"),
    ).toEqual([{ x_credits: 3 }, { x_credits: 10 }]);
  });
  it("does not claim an ambiguous reply when its quota is exhausted before sending", async () => {
    await activate();
    await reserveUsage("1", { xRequests: 3 });
    await query(`INSERT INTO interactions(account_id,id,author_id,username,name,text,created_at,direct_reply,status)
      VALUES('1','100','2','other','Other','hello',now(),true,'review')`);
    fetchMock.mockResolvedValue(json({ data: { id: "100" } }));
    await expect(
      replyAndMute(await getAccount("1"), "token", "100"),
    ).rejects.toThrow("agotado");
    expect(await query("SELECT status,attempted_at FROM interactions")).toEqual(
      [{ status: "review", attempted_at: null }],
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("keeps a reply queued without spending credits when the URL reply and mute do not fit", async () => {
    await activate();
    await reserveUsage("1", { xCredits: 160 });
    await query(`INSERT INTO interactions(account_id,id,author_id,username,name,text,created_at,status)
      VALUES('1','100','2','other','Other','hello',now(),'pending')`);
    await expect(
      replyAndMute(await getAccount("1"), "token", "100"),
    ).rejects.toThrow("agotado");
    expect((await billingSnapshot("1")).used.xCredits).toBe(160);
    expect(await query("SELECT status,attempted_at FROM interactions")).toEqual(
      [{ status: "pending", attempted_at: null }],
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("lists the current account's muted users with pagination and settles the read cost", async () => {
    await activate();
    fetchMock
      .mockReset()
      .mockResolvedValueOnce(
        json({
          data: [{ id: "5", name: "Muted", username: "muted" }],
          meta: { next_token: "page/2+" },
        }),
      );
    const first = await actions(
      request("/api/actions", { action: "mutes", accountId: "2" }),
    );
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({
      users: [{ id: "5", name: "Muted", username: "muted" }],
      nextCursor: "page/2+",
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.x.com/2/users/1/muting?max_results=20",
    );
    expect((await billingSnapshot("1")).used).toMatchObject({
      xCredits: 1,
      xRequests: 1,
    });
    fetchMock.mockResolvedValueOnce(json({ meta: { result_count: 0 } }));
    const second = await actions(
      request("/api/actions", { action: "mutes", cursor: "page/2+" }),
    );
    expect(await second.json()).toEqual({ users: [], nextCursor: null });
    expect(
      new URL(fetchMock.mock.calls[1][0]).searchParams.get("pagination_token"),
    ).toBe("page/2+");
    expect((await billingSnapshot("1")).used.xCredits).toBe(1);
    expect((await billingSnapshot("2")).used.xRequests).toBe(0);
  });
  it("rejects mute listing without authorization, scopes or paid access before any X read", async () => {
    fetchMock.mockReset();
    expect(
      (
        await actions(
          request(
            "/api/actions",
            { action: "mutes" },
            "https://attacker.example",
          ),
        )
      ).status,
    ).toBe(403);
    expect(
      (await actions(request("/api/actions", { action: "mutes" }))).status,
    ).toBe(402);
    await query("UPDATE accounts SET tokens=$1 WHERE id='1'", [
      seal({ access_token: "token", scope: "users.read" }, "tokens:1"),
    ]);
    const response = await actions(
      request("/api/actions", { action: "mutes" }),
    );
    expect(response.status).toBe(403);
    expect((await response.json()).error).toContain("Vuelve a conectar X");
    expect(fetchMock).not.toHaveBeenCalled();
    mocks.cookie = "";
    expect(
      (await actions(request("/api/actions", { action: "mutes" }))).status,
    ).toBe(401);
  });
  it("does not expose partial mute lists or release their uncertain charges", async () => {
    await activate();
    fetchMock
      .mockReset()
      .mockResolvedValueOnce(
        json({
          data: [{ id: "5", name: "Muted", username: "muted" }],
          errors: [{ title: "partial" }],
        }),
      );
    expect(
      (await actions(request("/api/actions", { action: "mutes" }))).status,
    ).toBe(502);
    expect((await billingSnapshot("1")).used.xCredits).toBe(4);
  });
  it("prevents block requests and cross-account mute requests at the adapter", async () => {
    await expect(
      accountXRequest("1", "token", "/users/1/blocking", { method: "POST" }),
    ).rejects.toThrow("sin presupuesto");
    await expect(
      accountXRequest("1", "token", "/users/2/muting"),
    ).rejects.toThrow("sin presupuesto");
    await expect(
      accountXRequest("1", "token", "/users/2/muting", { method: "POST" }),
    ).rejects.toThrow("sin presupuesto");
  });
  it("allows disabling BPN without a subscription", async () => {
    expect(
      (
        await actions(
          request("/api/actions", {
            action: "settings",
            settings: defaultSettings,
          }),
        )
      ).status,
    ).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
