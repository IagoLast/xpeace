import "server-only";
import { mutedPageSchema, type MutedPage } from "../domain";
import {
  accessToken,
  accountXRequest,
  getAccount,
  requireMuteScope,
} from "./x";
import { requireSubscription } from "./billing-access";

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
