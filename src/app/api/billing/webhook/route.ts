import Stripe from "stripe";
import { processStripeEvent } from "@/lib/server/billing";
import { required } from "@/lib/server/config";
import { stripe } from "@/lib/server/stripe";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    const signature = request.headers.get("stripe-signature");
    if (!signature)
      return Response.json(
        { error: "Falta la firma de Stripe." },
        { status: 400 },
      );
    const body = await request.text();
    if (body.length > 1_000_000) return new Response(null, { status: 413 });
    const event = stripe().webhooks.constructEvent(
      body,
      signature,
      required("STRIPE_WEBHOOK_SECRET"),
    );
    await processStripeEvent(event);
    return Response.json({ received: true });
  } catch (error) {
    if (error instanceof Stripe.errors.StripeSignatureVerificationError)
      return Response.json(
        { error: "Firma de Stripe inválida." },
        { status: 400 },
      );
    // Stripe must retry failed processing, including a busy billing lease.
    console.error(
      "No se pudo procesar el webhook de Stripe:",
      error instanceof Error ? error.name : "Error",
    );
    return Response.json(
      { error: "No se pudo procesar el evento." },
      { status: 500 },
    );
  }
}
