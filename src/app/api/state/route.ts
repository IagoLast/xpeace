import { authorize } from "@/lib/server/auth";
import { snapshot } from "@/lib/server/snapshot";
import { apiError } from "@/lib/server/http";

export async function GET(request: Request) {
  try {
    return Response.json(await snapshot(await authorize(request)), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return apiError(error);
  }
}
