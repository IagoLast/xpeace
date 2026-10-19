import "server-only";
import { mutedPageSchema, type MutedPage } from "../domain";
import {
  accessToken,
  accountXRequest,
  getAccount,
  requireMuteScope,
} from "./x";
import { requireSubscription } from "./billing-access";
import { HttpError } from "./auth";
import { query } from "./db";

// Called under the account lock so OAuth refresh and quota reservations serialize.
export async function listMutedUsers(
  accountId: string,
  cursor?: string,
): Promise<MutedPage> {
  const account = await getAccount(accountId);
  requireMuteScope(account, "mute.read");
  await requireSubscription(accountId);
  const token = await accessToken(account);
  const params = new URLSearchParams({ max_results: "20" });
  if (cursor) params.set("pagination_token", cursor);
  const page = mutedPageSchema.parse(
    await accountXRequest(
      accountId,
      token,
      `/users/${accountId}/muting?${params}`,
    ),
  );
  return { users: page.data, nextCursor: page.meta?.next_token ?? null };
}

// Called under the same lock as the worker, so a queued mute cannot race undo.
export async function unmuteUser(accountId: string, userId: string) {
  const account = await getAccount(accountId);
  requireMuteScope(account, "mute.write");
  await requireSubscription(accountId);
  const token = await accessToken(account);
  const result = await accountXRequest<{ data?: { muting?: boolean } }>(
    accountId,
    token,
    `/users/${accountId}/muting/${userId}`,
    { method: "DELETE" },
  );
  if (result.data?.muting !== false)
    throw new HttpError(
      502,
      "X no ha confirmado que se haya dejado de silenciar a esta cuenta. Actualiza la lista para comprobarlo.",
    );
  // Keep completed actions as history, but cancel retries that could undo this choice.
  await query(
    `UPDATE interactions SET mute_requested=false,
    error='Silencio pendiente cancelado al dejar de silenciar manualmente.'
    WHERE account_id=$1 AND author_id=$2 AND status='replied' AND mute_requested=true`,
    [accountId, userId],
  );
  return { ok: true, userId };
}
