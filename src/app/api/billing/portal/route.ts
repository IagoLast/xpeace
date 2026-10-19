import { authorize } from "@/lib/server/auth";
import { createPortal } from "@/lib/server/billing";
import { apiError } from "@/lib/server/http";

export async function POST(request: Request) {
  try {
    const account = await authorize(request);
    return Response.json(
      { url: await createPortal(account.id) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
