import { authorize } from "@/lib/server/auth";
import { createCheckout } from "@/lib/server/billing";
import { apiError } from "@/lib/server/http";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    const account = await authorize(request);
    return Response.json(
      { url: await createCheckout(account.id) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
