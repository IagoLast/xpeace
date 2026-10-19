import "server-only";
import { query, withAccountLock } from "./db";
import { accessToken, getAccount, XError } from "./x";
import {
  ingestMentions,
  processModeration,
  recoverSideEffects,
} from "./moderation";
import { HttpError } from "./auth";
import {
  BillingError,
  billingSnapshot,
  requireSubscription,
} from "./billing-access";

export async function runAccount(accountId: string, sync = false) {
  return withAccountLock(accountId, async () => {
    const account = await getAccount(accountId);
    await query("UPDATE accounts SET last_work_at=now() WHERE id=$1", [
      accountId,
    ]);
    if (account.retry_at && Date.parse(account.retry_at) > Date.now()) return;
    const deadline = Date.now() + 35_000;
    let quotaMessage: string | null = null;
    async function withinQuota(work: () => Promise<void>) {
      try {
        await work();
      } catch (error) {
        if (!(error instanceof BillingError)) throw error;
        const billing = await billingSnapshot(accountId);
        if (
          !billing.active ||
          billing.used.xRequests >= billing.limits.xRequests ||
          billing.used.xCredits >= billing.limits.xCredits
        )
          throw error;
        // A depleted analysis quota must not prevent recovering pending blocks.
        quotaMessage = error.message;
      }
    }
    try {
      await requireSubscription(accountId);
      const token = await accessToken(account);
      if (
        sync ||
        (account.settings.enabled &&
          (account.mention_cursor ||
            !account.last_sync ||
            Date.parse(account.last_sync) < Date.now() - 240_000))
      ) {
        await withinQuota(() => ingestMentions(account, token));
      }
      if (Date.now() < deadline)
        await withinQuota(() => recoverSideEffects(account, token, deadline));
      if ((sync || account.settings.enabled) && Date.now() < deadline)
        await withinQuota(() => processModeration(account, token, deadline));
      await query(
        "UPDATE accounts SET last_error=$2,retry_at=NULL WHERE id=$1",
        [accountId, quotaMessage],
      );
    } catch (error) {
      const message =
        error instanceof XError ||
        error instanceof HttpError ||
        error instanceof BillingError
          ? error.message
          : "La tarea no se ha podido completar. Se conserva el progreso.";
      const retry =
        (error instanceof XError || error instanceof BillingError) &&
        error.retryAt
          ? error.retryAt
          : new Date(Date.now() + 60_000);
      await query("UPDATE accounts SET last_error=$2,retry_at=$3 WHERE id=$1", [
        accountId,
        message,
        retry,
      ]);
      throw new HttpError(
        error instanceof XError ||
          error instanceof HttpError ||
          error instanceof BillingError
          ? error.status
          : 503,
        message,
      );
    }
  });
}
