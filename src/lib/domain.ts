import { z } from "zod";

export const BPN_REPLY = "block por nabo 🫜";
export const BPN_PAGE = "/bpn";
// A post with a URL costs 40 of our 0.005 USD activity credits.
export const BPN_REPLY_CREDITS = 40;
export const ALL_HISTORY_BEFORE = "9999-12-31";
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
export type Kind = "tweets" | "replies" | "likes";
export const cleanupSchema = z.object({
  kinds: z
    .array(z.enum(["tweets", "replies", "likes"]))
    .min(1)
    .max(3),
  before: z.iso.date(),
});
export type Decision = {
  abuse: number;
  insult: number;
  optOut: number;
  label: "insult" | "rude" | "healthy";
  latency: number;
  model: string;
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
export type CleanupJob = {
  id: string;
  kinds: Kind[];
  before_date: string;
  status:
    "scanning" | "ready" | "running" | "completed" | "cancelled" | "error";
  phase: "tweets" | "likes";
  cursor: string | null;
  scanned: number;
  total: number;
  done: number;
  failed: number;
  error: string | null;
  created_at: string;
};
export type Usage = {
  xRequests: number;
  xCredits: number;
  analyses: number;
  cleanup: number;
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
  jobs: CleanupJob[];
  preview: { id: string; text: string; kind: Kind; created_at: string }[];
  stats: {
    analyzed: number;
    flagged: number;
    blocked: number;
    deleted: number;
  };
  lastSync: string | null;
  lastError: string | null;
};

export function routeDecision(decision: Decision, settings: Settings) {
  if (decision.optOut >= 0.5) return "ignored" as const;
  if (decision.abuse < settings.threshold) return "allowed" as const;
  return settings.enabled ? ("send" as const) : ("pending" as const);
}

export function matchesCleanup(
  kind: Kind,
  createdAt: string,
  kinds: Kind[],
  before: string,
) {
  // Date input denotes a strict UTC cutoff, independent of server/browser timezone.
  return (
    kinds.includes(kind) &&
    Date.parse(createdAt) < Date.parse(`${before}T00:00:00.000Z`)
  );
}

export function isOptOut(text: string) {
  return /\b(stop|bpn stop|no me respondas|no me contestes|deja de responderme)\b/i.test(
    text,
  );
}
