import { authorize } from "@/lib/server/auth";
import { refreshBilling } from "@/lib/server/billing";
import { billingSnapshot } from "@/lib/server/billing-access";
import { apiError } from "@/lib/server/http";

export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    const account = await authorize(request);
    await refreshBilling(account.id);
    return Response.json(await billingSnapshot(account.id), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return apiError(error);
  }
}
