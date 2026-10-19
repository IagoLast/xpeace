import { cookies } from "next/headers";
import { z } from "zod";
import { settingsSchema } from "@/lib/domain";
import { authorize, HttpError } from "@/lib/server/auth";
import { query, withAccountLock } from "@/lib/server/db";
import { runAccount } from "@/lib/server/worker";
import { apiError } from "@/lib/server/http";
import { requireSubscription } from "@/lib/server/billing-access";
import { listMutedUsers } from "@/lib/server/mutes";
import { getAccount, requireMuteScope } from "@/lib/server/x";

export const maxDuration = 60;
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("settings"), settings: settingsSchema }),
  z.object({ action: z.literal("sync") }),
  z.object({
    action: z.literal("mutes"),
    cursor: z.string().min(1).max(2048).optional(),
  }),
  z.object({ action: z.literal("logout") }),
  z.object({ action: z.literal("disconnect") }),
]);

export async function POST(request: Request) {
  try {
    const account = await authorize(request);
    const body = await request.text();
    if (body.length > 10_000)
      throw new HttpError(413, "Petición demasiado grande.");
    const input = actionSchema.parse(JSON.parse(body));
    if (input.action === "sync") {
      await runAccount(account.id, true);
      return Response.json({ ok: true });
    }
    return await withAccountLock(account.id, async () => {
      if (input.action === "mutes")
        return Response.json(await listMutedUsers(account.id, input.cursor), {
          headers: { "Cache-Control": "no-store" },
        });
      if (input.action === "settings" && input.settings.enabled)
        await requireSubscription(account.id);
      if (input.action === "settings") {
        const current = await getAccount(account.id);
        if (input.settings.enabled && !current.settings.enabled)
          requireMuteScope(current, "mute.write");
        await query("UPDATE accounts SET settings=$2::jsonb WHERE id=$1", [
          account.id,
          JSON.stringify(input.settings),
        ]);
      } else if (input.action === "logout") {
        await query(
          "UPDATE accounts SET session_version=session_version+1 WHERE id=$1",
          [account.id],
        );
        (await cookies()).delete("xpeace_session");
      } else if (input.action === "disconnect") {
        await query(
          "UPDATE accounts SET tokens='',settings=jsonb_set(settings,'{enabled}','false'),session_version=session_version+1 WHERE id=$1",
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
