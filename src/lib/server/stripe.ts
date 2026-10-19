import "server-only";
import Stripe from "stripe";
import { required } from "./config";

export const STRIPE_API_VERSION = "2026-09-30.endive" as const;

export function stripe() {
  return new Stripe(required("STRIPE_SECRET_KEY"), {
    apiVersion: STRIPE_API_VERSION,
    httpClient: Stripe.createFetchHttpClient(),
    timeout: 10_000,
    maxNetworkRetries: 1,
  });
}
