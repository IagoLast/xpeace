import { describe, expect, it } from "vitest";
import {
  defaultSettings,
  matchesCleanup,
  routeDecision,
  settingsSchema,
  type Decision,
} from "@/lib/domain";
import { sameSecret, seal, unseal } from "@/lib/server/crypto";

const abuse: Decision = {
  abuse: 0.99,
  insult: 0.99,
  optOut: 0,
  label: "insult",
  latency: 5,
  model: "test",
};
const automatic = {
  ...defaultSettings,
  enabled: true,
  mode: "automatic" as const,
};
describe("BPN routing", () => {
  it("sends only when enabled, above threshold and a direct reply", () => {
    expect(routeDecision(abuse, automatic, true)).toBe("send");
    expect(routeDecision(abuse, automatic, false)).toBe("review");
    expect(routeDecision(abuse, { ...automatic, enabled: false }, true)).toBe(
      "review",
    );
    expect(routeDecision(abuse, { ...automatic, mode: "review" }, true)).toBe(
      "review",
    );
  });
  it("keeps legitimate disagreement and opt-outs out of the reply flow", () => {
    expect(routeDecision({ ...abuse, abuse: 0.05 }, automatic, true)).toBe(
      "allowed",
    );
    expect(routeDecision({ ...abuse, optOut: 0.95 }, automatic, true)).toBe(
      "ignored",
    );
  });
  it("validates settings on the server", () => {
    expect(
      settingsSchema.safeParse({ ...automatic, threshold: 0 }).success,
    ).toBe(false);
    expect(
      settingsSchema.safeParse({ ...automatic, allowlist: ["<script>"] })
        .success,
    ).toBe(false);
  });
});
describe("cleanup cutoff", () => {
  it("applies type selection and a strict UTC cutoff", () => {
    expect(
      matchesCleanup(
        "tweets",
        "2024-12-31T23:59:59Z",
        ["tweets"],
        "2025-01-01",
      ),
    ).toBe(true);
    expect(
      matchesCleanup(
        "tweets",
        "2025-01-01T00:00:00Z",
        ["tweets"],
        "2025-01-01",
      ),
    ).toBe(false);
    expect(
      matchesCleanup(
        "replies",
        "2024-01-01T00:00:00Z",
        ["tweets"],
        "2025-01-01",
      ),
    ).toBe(false);
    expect(matchesCleanup("likes", "invalid", ["likes"], "2025-01-01")).toBe(
      false,
    );
  });
});
describe("encrypted credentials", () => {
  it("round-trips and binds ciphertext to its purpose/account", () => {
    const cipher = seal({ token: "private-token" }, "tokens:123");
    expect(cipher).not.toContain("private-token");
    expect(unseal(cipher, "tokens:123")).toEqual({ token: "private-token" });
    expect(() => unseal(cipher, "tokens:456")).toThrow();
    expect(() => unseal(cipher.slice(0, -3) + "ABC", "tokens:123")).toThrow();
    expect(sameSecret("", "secret")).toBe(false);
  });
});
