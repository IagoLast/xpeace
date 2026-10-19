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
import { defaultSettings, type Interaction } from "@/lib/domain";

const mocks = vi.hoisted(() => ({ sql: vi.fn(), evaluate: vi.fn() }));
vi.mock("@neondatabase/serverless", () => ({
  neon: () => ({ query: mocks.sql }),
}));
vi.mock("@/lib/server/jev", () => ({ evaluate: mocks.evaluate }));
import { query, withAccountLock } from "@/lib/server/db";
import {
  ingestMentions,
  processModeration,
  recoverSideEffects,
  replyAndMute,
} from "@/lib/server/moderation";
import { getAccount, xRequest, XError } from "@/lib/server/x";
import { seal } from "@/lib/server/crypto";
import { snapshot } from "@/lib/server/snapshot";

let db: PGlite;
const fetchMock = vi.fn();
const json = (data: unknown, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers });
const decision = {
  abuse: 0.99,
  insult: 0.99,
  optOut: 0,
  label: "insult",
  latency: 5,
  model: "test",
};
const settings = {
  ...defaultSettings,
  enabled: true,
};
beforeAll(async () => {
  db = new PGlite();
  await db.exec(await readFile("db/001-initial.sql", "utf8"));
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
  process.env.STRIPE_SECRET_KEY = "sk_test_fixture";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_fixture";
  process.env.STRIPE_PRICE_ID = "price_fixture";
  process.env.BILLING_X_CREDITS_LIMIT = "2000";
  await db.exec("TRUNCATE accounts CASCADE; TRUNCATE locks;");
  await query(
    "INSERT INTO accounts(id,username,name,tokens,token_expires_at,settings) VALUES($1,$2,$3,$4,now()+interval '1 hour',$5::jsonb)",
    [
      "1",
      "owner",
      "Owner",
      seal(
        {
          access_token: "token",
          expires_in: 3600,
          scope: "users.read mute.read mute.write",
        },
        "tokens:1",
      ),
      JSON.stringify(settings),
    ],
  );
  await query(`INSERT INTO billing_subscriptions(id,account_id,status,price_id,paid,period_start,period_end)
    VALUES('sub_fixture','1','active','price_fixture',true,now()-interval '1 day',now()+interval '29 days')`);
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  mocks.evaluate.mockReset().mockResolvedValue(decision);
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await db.close();
});

async function interaction(
  status = "review",
  id = "100",
  author = "2",
  text = "ERES GILIPOLLAS",
) {
  await query(
    "INSERT INTO interactions(account_id,id,author_id,username,name,text,created_at,direct_reply,status) VALUES('1',$1,$2,'example','Example',$3,now(),true,$4)",
    [id, author, text, status],
  );
}
const current = async (id = "100") =>
  (
    await query<Interaction>(
      "SELECT * FROM interactions WHERE account_id='1' AND id=$1",
      [id],
    )
  )[0];

describe("persistent moderation", () => {
  it("requires mute permission before analysis or any external action", async () => {
    await interaction("pending");
    await query("UPDATE accounts SET tokens=$1", [
      seal(
        { access_token: "token", scope: "users.read block.write" },
        "tokens:1",
      ),
    ]);
    await expect(
      processModeration(await getAccount("1"), "token", Date.now() + 10_000),
    ).rejects.toThrow("Vuelve a conectar X");
    expect(mocks.evaluate).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await current()).toMatchObject({
      status: "pending",
      reply_id: null,
    });
    expect((await snapshot(await getAccount("1"))).muteAccess).toEqual({
      read: false,
      write: false,
    });
  });
  it("keeps historical blocks and never converts old pending blocks into mutes", async () => {
    await interaction("blocked", "98");
    await interaction("replied", "99", "3");
    await query("UPDATE interactions SET block_requested=true WHERE id='99'");
    await db.exec(await readFile("db/005-mutes.sql", "utf8"));
    await recoverSideEffects(
      await getAccount("1"),
      "token",
      Date.now() + 10_000,
    );
    expect((await current("98")).status).toBe("blocked");
    expect((await current("99")).status).toBe("replied");
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await snapshot(await getAccount("1"))).stats).toMatchObject({
      blocked: 1,
      muted: 0,
    });
  });
  it("does not mark a mute complete until X confirms it", async () => {
    await interaction();
    fetchMock
      .mockResolvedValueOnce(json({ data: { id: "100" } }))
      .mockResolvedValueOnce(json({ data: { id: "999" } }))
      .mockResolvedValueOnce(json({ data: { muting: false } }));
    await expect(
      replyAndMute(await getAccount("1"), "token", "100"),
    ).rejects.toThrow("no ha confirmado");
    expect(await current()).toMatchObject({
      status: "replied",
      reply_id: "999",
      reply_text: "mute por nabo 🫜 http://localhost:3000/bpn",
    });
    expect((await snapshot(await getAccount("1"))).stats.muted).toBe(0);
  });
  it("records the applied threshold and uses changes only for unprocessed messages", async () => {
    await interaction("pending");
    mocks.evaluate.mockResolvedValue({
      ...decision,
      abuse: 0.89,
      insult: 0.61,
    });
    await processModeration(
      await getAccount("1"),
      "token",
      Date.now() + 10_000,
    );
    expect(await current()).toMatchObject({
      status: "allowed",
      decision: { abuse: 0.89, threshold: 0.9 },
    });
    expect(fetchMock).not.toHaveBeenCalled();

    await query(
      "UPDATE accounts SET settings=jsonb_set(settings,'{threshold}','0.89') WHERE id='1'",
    );
    await interaction("pending", "101", "3");
    fetchMock
      .mockResolvedValueOnce(json({ data: { id: "101" } }))
      .mockResolvedValueOnce(json({ data: { id: "999" } }))
      .mockResolvedValueOnce(json({ data: { muting: true } }));
    await processModeration(
      await getAccount("1"),
      "token",
      Date.now() + 10_000,
    );
    expect(await current("101")).toMatchObject({
      status: "muted",
      decision: { abuse: 0.89, threshold: 0.89 },
    });
    expect(await current()).toMatchObject({
      status: "allowed",
      decision: { threshold: 0.9 },
    });
    expect(mocks.evaluate).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("replies with the exact phrase, then mutes, without a second send", async () => {
    await interaction();
    fetchMock
      .mockResolvedValueOnce(json({ data: { id: "100" } }))
      .mockResolvedValueOnce(json({ data: { id: "999" } }))
      .mockResolvedValueOnce(json({ data: { muting: true } }));
    await replyAndMute(await getAccount("1"), "token", "100");
    await expect(current()).resolves.toMatchObject({
      status: "muted",
      reply_id: "999",
    });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      text: "mute por nabo 🫜 http://localhost:3000/bpn",
      reply: { in_reply_to_tweet_id: "100" },
    });
    expect(fetchMock.mock.calls[2][0]).toContain("/users/1/muting");
    await expect(
      replyAndMute(await getAccount("1"), "token", "100"),
    ).rejects.toThrow("ya se ha procesado");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("never retries an ambiguous publication timeout", async () => {
    await interaction();
    fetchMock
      .mockResolvedValueOnce(json({ data: { id: "100" } }))
      .mockRejectedValueOnce(new Error("timeout after POST"));
    const account = await getAccount("1");
    await expect(replyAndMute(account, "token", "100")).rejects.toMatchObject({
      status: 502,
    });
    await recoverSideEffects(account, "token", Date.now() + 10_000);
    expect(await current()).toMatchObject({ status: "error", reply_id: null });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("resumes a failed mute without repeating the reply", async () => {
    await interaction();
    fetchMock
      .mockResolvedValueOnce(json({ data: { id: "100" } }))
      .mockResolvedValueOnce(json({ data: { id: "999" } }))
      .mockResolvedValueOnce(json({}, 503));
    const account = await getAccount("1");
    await expect(replyAndMute(account, "token", "100")).rejects.toBeInstanceOf(
      XError,
    );
    expect(await current()).toMatchObject({
      status: "replied",
      reply_id: "999",
    });
    fetchMock.mockResolvedValueOnce(json({ data: { muting: true } }));
    await recoverSideEffects(account, "token", Date.now() + 10_000);
    expect(await current()).toMatchObject({ status: "muted" });
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) =>
          url === "https://api.x.com/2/tweets" && init.method === "POST",
      ),
    ).toHaveLength(1);
  });
  it("stops retrying a forbidden mute and still evaluates the following message", async () => {
    await interaction("pending", "100", "2");
    await interaction("pending", "101", "3", "Gracias por compartirlo");
    fetchMock
      .mockResolvedValueOnce(json({ data: { id: "100" } }))
      .mockResolvedValueOnce(json({ data: { id: "999" } }))
      .mockResolvedValueOnce(json({ title: "Forbidden" }, 403));
    mocks.evaluate.mockResolvedValueOnce(decision).mockResolvedValueOnce({
      ...decision,
      abuse: 0.01,
      insult: 0.01,
      label: "healthy",
    });
    const account = await getAccount("1");
    await processModeration(account, "token", Date.now() + 10_000);
    expect(await current()).toMatchObject({
      status: "replied",
      reply_id: "999",
      mute_requested: false,
      error: expect.stringContaining("silenciado"),
    });
    expect((await current("101")).status).toBe("allowed");
    await recoverSideEffects(account, "token", Date.now() + 10_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("shows a rejected reply as rejected and never attempts its mute", async () => {
    await interaction("pending");
    fetchMock
      .mockResolvedValueOnce(json({ data: { id: "100" } }))
      .mockResolvedValueOnce(json({ title: "Forbidden" }, 403));
    await expect(
      replyAndMute(await getAccount("1"), "token", "100"),
    ).rejects.toMatchObject({
      status: 403,
      message: expect.stringContaining("rechazado la respuesta"),
    });
    expect(await current()).toMatchObject({
      status: "error",
      reply_id: null,
      error: expect.stringContaining("rechazado la respuesta"),
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("leaves provider failures pending with no X mutations", async () => {
    await interaction("pending");
    mocks.evaluate.mockRejectedValueOnce(new Error("provider down"));
    await expect(
      processModeration(await getAccount("1"), "token", Date.now() + 10_000),
    ).rejects.toThrow("JEV");
    expect(await current()).toMatchObject({
      status: "pending",
      decision: null,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("stores opt-out and ignores later messages by the same sender", async () => {
    await interaction("pending", "100", "2", "no me respondas");
    await interaction("pending", "101", "2");
    await processModeration(
      await getAccount("1"),
      "token",
      Date.now() + 10_000,
    );
    expect((await current()).status).toBe("ignored");
    expect((await current("101")).status).toBe("ignored");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.evaluate).not.toHaveBeenCalled();
  });
  it.each([true, false])(
    "automatically replies and mutes with direct_reply=%s",
    async (directReply) => {
      await interaction("pending");
      await query("UPDATE interactions SET direct_reply=$1", [directReply]);
      fetchMock
        .mockResolvedValueOnce(json({ data: { id: "100" } }))
        .mockResolvedValueOnce(json({ data: { id: "999" } }))
        .mockResolvedValueOnce(json({ data: { muting: true } }));
      await processModeration(
        await getAccount("1"),
        "token",
        Date.now() + 10_000,
      );
      expect((await current()).status).toBe("muted");
      expect(JSON.parse(fetchMock.mock.calls[1][1].body).text).toBe(
        "mute por nabo 🫜 http://localhost:3000/bpn",
      );
      expect(
        (await snapshot(await getAccount("1"))).billing.used.xCredits,
      ).toBe(44);
    },
  );
  it("does not evaluate or send while BPN is paused", async () => {
    await interaction("pending");
    const account = await getAccount("1");
    account.settings.enabled = false;
    await processModeration(account, "token", Date.now() + 10_000);
    expect((await current()).status).toBe("pending");
    expect(mocks.evaluate).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("resumes queued decisions without charging for another evaluation", async () => {
    await interaction("pending");
    await query("UPDATE interactions SET decision=$1::jsonb", [
      JSON.stringify(decision),
    ]);
    fetchMock
      .mockResolvedValueOnce(json({ data: { id: "100" } }))
      .mockResolvedValueOnce(json({ data: { id: "999" } }))
      .mockResolvedValueOnce(json({ data: { muting: true } }));
    await processModeration(
      await getAccount("1"),
      "token",
      Date.now() + 10_000,
    );
    expect((await current()).status).toBe("muted");
    expect(mocks.evaluate).not.toHaveBeenCalled();
  });
  it("excludes trusted accounts case-insensitively", async () => {
    await interaction("pending");
    const account = await getAccount("1");
    account.settings.allowlist = ["EXAMPLE"];
    await processModeration(account, "token", Date.now() + 10_000);
    expect((await current()).status).toBe("ignored");
    expect(mocks.evaluate).not.toHaveBeenCalled();
  });
  it("enforces the per-author cooldown", async () => {
    await interaction("replied", "99");
    await query("UPDATE interactions SET attempted_at=now() WHERE id='99'");
    await interaction();
    await replyAndMute(await getAccount("1"), "token", "100");
    expect((await current()).status).toBe("ignored");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("does not advance since_id until every mention page has been ingested", async () => {
    await query("UPDATE accounts SET since_id='50' WHERE id='1'");
    const post = (id: string) => ({
      id,
      author_id: "2",
      text: "hola",
      created_at: "2026-10-01T10:00:00Z",
      in_reply_to_user_id: "1",
    });
    const includes = {
      users: [{ id: "2", username: "example", name: "Example" }],
    };
    fetchMock
      .mockResolvedValueOnce(
        json({ data: [post("200")], includes, meta: { next_token: "page2" } }),
      )
      .mockResolvedValueOnce(json({ data: [post("100")], includes, meta: {} }));
    await ingestMentions(await getAccount("1"), "token");
    expect(await getAccount("1")).toMatchObject({
      since_id: "50",
      mention_cursor: "page2",
    });
    await ingestMentions(await getAccount("1"), "token");
    expect(await getAccount("1")).toMatchObject({
      since_id: "200",
      mention_cursor: null,
    });
    expect(fetchMock.mock.calls[1][0]).toContain("since_id=50");
    expect(fetchMock.mock.calls[1][0]).toContain("pagination_token=page2");
  });
});

describe("external boundaries", () => {
  it("logs provider error codes without publishing private response details", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce(
      json(
        {
          type: "https://api.x.com/2/problems/client-forbidden",
          reason: "client-not-enrolled",
          detail: "private-token user@example.com",
          errors: [{ code: 453, message: "private" }],
        },
        403,
      ),
    );
    await expect(
      xRequest("private-token", "/users/1/muting", { method: "POST" }),
    ).rejects.toMatchObject({ status: 403, operation: "mute" });
    expect(log).toHaveBeenCalledWith(
      "x_request_failed",
      expect.objectContaining({
        problemType: "client-forbidden",
        reason: "client-not-enrolled",
        codes: [453],
      }),
    );
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/private|user@example/);
    log.mockRestore();
  });
  it("serializes concurrent work using the database lease", async () => {
    await withAccountLock("1", async () => {
      await expect(
        withAccountLock("1", async () => "should not run"),
      ).rejects.toThrow("en curso");
    });
    expect(await withAccountLock("1", async () => "released")).toBe("released");
  });
  it("rejects partial X responses so pagination cannot silently skip records", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ data: [], errors: [{ title: "Partial failure" }] }),
    );
    await expect(xRequest("token", "/users/1/mentions")).rejects.toMatchObject({
      status: 502,
    });
  });
});
