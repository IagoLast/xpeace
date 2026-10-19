import "server-only";
import { z } from "zod";
import { required } from "./config";
import { query } from "./db";
import { seal, unseal } from "./crypto";
import type { Settings } from "../domain";
import { BillingError, billingSnapshot, reserveUsage } from "./billing-access";

export type Account = {
  id: string;
  username: string;
  name: string;
  tokens: string;
  token_expires_at: string;
  session_version: number;
  settings: Settings;
  since_id: string | null;
  mention_cursor: string | null;
  mention_high_water: string | null;
  connected_at: string;
  last_sync: string | null;
  last_error: string | null;
  retry_at: string | null;
};
const tokensSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number(),
  scope: z.string().optional(),
});
export type Tokens = z.infer<typeof tokensSchema>;
export type Post = {
  id: string;
  text: string;
  author_id?: string;
  created_at?: string;
  in_reply_to_user_id?: string;
  referenced_tweets?: { type: string; id: string }[];
};
export type Timeline = {
  data?: Post[];
  meta?: { next_token?: string; newest_id?: string };
  includes?: { users?: { id: string; username: string; name: string }[] };
};

export class XError extends Error {
  constructor(
    public status: number,
    public retryAt?: Date,
  ) {
    super(
      status === 429
        ? "X ha limitado las peticiones. Se reanudará cuando termine la espera."
        : status === 401
          ? "La autorización de X ha caducado. Vuelve a conectar la cuenta."
          : status === 403
            ? "X ha rechazado la operación. Comprueba los permisos y el acceso de tu aplicación."
            : status === 402
              ? "X requiere saldo o acceso adicional para esta operación."
              : `X no pudo completar la operación (${status}).`,
    );
  }
}

export async function xRequest<T>(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`https://api.x.com/2${path}`, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  if (!response.ok) {
    const reset = Number(response.headers.get("x-rate-limit-reset"));
    const retry = Number(response.headers.get("retry-after"));
    throw new XError(
      response.status,
      response.status === 429
        ? new Date(
            reset > 0
              ? reset * 1000
              : Date.now() + (retry > 0 ? retry : 900) * 1000,
          )
        : undefined,
    );
  }
  if (response.status === 204) return {} as T;
  const result = await response.json();
  // Never advance a pagination cursor past a partial/error response.
  if (result.errors?.length) throw new XError(502);
  return result as T;
}

export async function exchangeToken(
  params: Record<string, string>,
): Promise<Tokens> {
  const auth = Buffer.from(
    `${encodeURIComponent(required("X_CLIENT_ID"))}:${encodeURIComponent(required("X_CLIENT_SECRET"))}`,
  ).toString("base64");
  const response = await fetch("https://api.x.com/2/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
  });
  if (!response.ok) throw new XError(response.status);
  return tokensSchema.parse(await response.json());
}

// All account operations use this wrapper. The raw adapter is reserved for
// OAuth identity and operations whose quota was reserved before a durable claim.
export async function accountXRequest<T>(
  accountId: string,
  token: string,
  path: string,
  init: RequestInit = {},
  cleanup = false,
): Promise<T> {
  const url = new URL(`https://api.x.com/2${path}`);
  const method = (init.method ?? "GET").toUpperCase();
  const timeline =
    method === "GET" &&
    /^\/2\/users\/\d+\/(mentions|tweets|liked_tweets)$/.test(url.pathname);
  let credits: number;
  if (timeline) {
    const expansions = url.searchParams.get("expansions");
    if (expansions && expansions !== "author_id")
      throw new Error("Expansión de X sin presupuesto definido.");
    // X bills resources, not HTTP requests. Budget a full page plus expanded
    // authors before fetching; do not rely on X's best-effort daily deduplication.
    const perPost = expansions ? 3 : 1;
    const billing = await billingSnapshot(accountId);
    const available = billing.limits.xCredits - billing.used.xCredits;
    const requested = Number(url.searchParams.get("max_results") ?? 10);
    if (!Number.isSafeInteger(requested) || requested < 5)
      throw new Error("Tamaño de página de X inválido.");
    const count = Math.min(20, requested, Math.floor(available / perPost));
    if (count < 5) {
      // Validate entitlement before reporting an insufficient balance.
      await reserveUsage(accountId, { xRequests: 0 });
      throw new BillingError(
        "Has agotado el cupo disponible para esta consulta a X. Se reanudará en la renovación.",
        billing.periodEnd ? new Date(billing.periodEnd) : undefined,
      );
    }
    url.searchParams.set("max_results", String(count));
    credits = count * perPost;
  } else if (
    method === "GET" &&
    /^\/2\/tweets\/\d+$/.test(url.pathname) &&
    !url.search
  ) {
    credits = 1;
  } else if (
    method === "POST" &&
    /^\/2\/users\/\d+\/blocking$/.test(url.pathname)
  ) {
    credits = 3;
  } else if (
    method === "DELETE" &&
    (/^\/2\/tweets\/\d+$/.test(url.pathname) ||
      /^\/2\/users\/\d+\/likes\/\d+$/.test(url.pathname))
  ) {
    credits = 2;
  } else {
    throw new Error("Operación de X sin presupuesto definido.");
  }
  const receipt = await reserveUsage(accountId, {
    xRequests: 1,
    xCredits: credits,
    cleanup: cleanup ? 1 : 0,
  });
  const result = await xRequest<T>(
    token,
    url.pathname.slice(2) + url.search,
    init,
  );
  if (timeline) {
    const page = result as Timeline;
    // Only successful, complete pages release their unused credit reservation.
    // Errors/timeouts retain the full reservation because their cost is unknown.
    await receipt.settleXCredits(
      (page.data?.length ?? 0) + 2 * (page.includes?.users?.length ?? 0),
    );
  }
  return result;
}

// Call under withAccountLock: refresh tokens rotate, so refresh must be serialized.
export async function accessToken(account: Account) {
  const old = unseal<Tokens>(account.tokens, `tokens:${account.id}`);
  if (Date.parse(account.token_expires_at) > Date.now() + 60_000)
    return old.access_token;
  if (!old.refresh_token) throw new XError(401);
  const tokens = await exchangeToken({
    grant_type: "refresh_token",
    refresh_token: old.refresh_token,
  });
  tokens.refresh_token ??= old.refresh_token;
  await query(
    "UPDATE accounts SET tokens=$2, token_expires_at=$3 WHERE id=$1",
    [
      account.id,
      seal(tokens, `tokens:${account.id}`),
      new Date(Date.now() + tokens.expires_in * 1000),
    ],
  );
  return tokens.access_token;
}

export async function getAccount(id: string) {
  const [account] = await query<Account>("SELECT * FROM accounts WHERE id=$1", [
    id,
  ]);
  if (!account) throw new XError(401);
  return account;
}
