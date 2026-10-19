import { cookies } from "next/headers";
import { z } from "zod";
import { cleanupSchema, settingsSchema } from "@/lib/domain";
import { authorize, HttpError } from "@/lib/server/auth";
import { query, withAccountLock } from "@/lib/server/db";
import { confirmCleanup, createPreview } from "@/lib/server/cleanup";
import { evaluate } from "@/lib/server/jev";
import { replyAndBlock } from "@/lib/server/moderation";
import { runAccount } from "@/lib/server/worker";
import { accessToken, getAccount } from "@/lib/server/x";
import { apiError } from "@/lib/server/http";
import { requireSubscription, reserveUsage } from "@/lib/server/billing-access";

export const maxDuration = 60;
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("settings"), settings: settingsSchema }),
  z.object({ action: z.literal("sync") }),
  z.object({ action: z.literal("work") }),
  cleanupSchema.extend({ action: z.literal("preview") }),
  z.object({
    action: z.literal("confirm"),
    id: z.uuid(),
    confirmation: z.literal("BORRAR"),
  }),
  z.object({ action: z.literal("cancel"), id: z.uuid() }),
  z.object({
    action: z.literal("moderate"),
    id: z.string().regex(/^\d{1,25}$/),
    choice: z.enum(["apply", "ignore"]),
  }),
  z.object({
    action: z.literal("test"),
    text: z.string().trim().min(1).max(4000),
  }),
  z.object({ action: z.literal("disconnect") }),
]);

export async function POST(request: Request) {
  try {
    const account = await authorize(request);
    const body = await request.text();
    if (body.length > 10_000)
      throw new HttpError(413, "Petición demasiado grande.");
    const input = actionSchema.parse(JSON.parse(body));
    if (input.action === "sync" || input.action === "work") {
      await runAccount(account.id, input.action === "sync");
      return Response.json({ ok: true });
    }
    if (input.action === "cancel") {
      await query(
        "UPDATE cleanup_jobs SET status='cancelled' WHERE account_id=$1 AND id=$2 AND status IN ('scanning','ready','running')",
        [account.id, input.id],
      );
      return Response.json({ ok: true });
    }
    return await withAccountLock(account.id, async () => {
      const fresh = await getAccount(account.id);
      if (
        input.action === "preview" ||
        input.action === "confirm" ||
        (input.action === "settings" && input.settings.enabled) ||
        (input.action === "moderate" && input.choice === "apply")
      )
        await requireSubscription(account.id);
      if (input.action === "settings") {
        await query("UPDATE accounts SET settings=$2::jsonb WHERE id=$1", [
          account.id,
          JSON.stringify(input.settings),
        ]);
      } else if (input.action === "preview") {
        await createPreview(
          account.id,
          [...new Set(input.kinds)],
          input.before,
        );
      } else if (input.action === "confirm") {
        await confirmCleanup(account.id, input.id);
      } else if (input.action === "moderate") {
        if (input.choice === "ignore")
          await query(
            "UPDATE interactions SET status='ignored' WHERE account_id=$1 AND id=$2 AND status IN ('review','pending')",
            [account.id, input.id],
          );
        else await replyAndBlock(fresh, await accessToken(fresh), input.id);
      } else if (input.action === "test") {
        await reserveUsage(account.id, { analyses: 1 });
        return Response.json({ decision: await evaluate(input.text) });
      } else if (input.action === "disconnect") {
        await query(
          "UPDATE accounts SET tokens='',settings=jsonb_set(settings,'{enabled}','false'),session_version=session_version+1 WHERE id=$1",
          [account.id],
        );
        await query(
          "UPDATE cleanup_jobs SET status='cancelled' WHERE account_id=$1 AND status IN ('scanning','ready','running')",
          [account.id],
        );
        (await cookies()).delete("xpeace_session");
      }
      return Response.json({ ok: true });
    });
  } catch (error) {
    return apiError(error);
  }
}
