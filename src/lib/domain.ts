import { z } from "zod";

export const BPN_REPLY = "block por nabo 🫜";
export const BPN_PAGE = "/bpn";
// A post with a URL costs 40 of our 0.005 USD activity credits.
export const BPN_REPLY_CREDITS = 40;
export const MODEL = "typesafe-ai/jev-1.14.0";
export const settingsSchema = z.object({
  enabled: z.boolean(),
  threshold: z.number().min(0.6).max(0.99),
  allowlist: z.array(z.string().regex(/^[A-Za-z0-9_]{1,15}$/)).max(100),
});
export type Settings = z.infer<typeof settingsSchema>;
export const defaultSettings: Settings = {
  enabled: false,
  threshold: 0.9,
  allowlist: [],
};
export type Decision = {
  abuse: number;
  insult: number;
  optOut: number;
  label: "insult" | "rude" | "healthy";
  latency: number;
  model: string;
  // Older evaluations did not record the threshold used for routing.
  threshold?: number;
};
export type Interaction = {
  id: string;
  author_id: string;
  username: string;
  name: string;
  text: string;
  created_at: string;
  direct_reply: boolean;
  decision: Decision | null;
  status:
    | "pending"
    | "allowed"
    | "review"
    | "ignored"
    | "sending"
    | "replied"
    | "blocked"
    | "error";
  reply_id: string | null;
  error: string | null;
};
export type Usage = {
  xRequests: number;
  xCredits: number;
  analyses: number;
};
export type Billing = {
  configured: boolean;
  active: boolean;
  status: string;
  hasCustomer: boolean;
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  used: Usage;
  limits: Usage;
};
export type Snapshot = {
  mode: "live";
  billing: Billing;
  account: { id: string; username: string; name: string };
  settings: Settings;
  interactions: Interaction[];
  stats: {
    analyzed: number;
    flagged: number;
    blocked: number;
  };
  lastSync: string | null;
  lastError: string | null;
};

export function routeDecision(decision: Decision, settings: Settings) {
  if (decision.optOut >= 0.5) return "ignored" as const;
  if (decision.abuse < settings.threshold) return "allowed" as const;
  return settings.enabled ? ("send" as const) : ("pending" as const);
}

export function isOptOut(text: string) {
  return /\b(stop|bpn stop|no me respondas|no me contestes|deja de responderme)\b/i.test(
    text,
  );
}
