import { describe, expect, it } from "vitest";
import { Experimental_DecisionMockModelV4 } from "ai/test";
import { evaluate } from "@/lib/server/jev";

describe("JEV decision adapter", () => {
  it("uses native Boolean probabilities instead of generated text", async () => {
    const model = new Experimental_DecisionMockModelV4({
      doDecide: async (options) => {
        expect(options.state).toEqual([
          {
            type: "json",
            value: { message: "ERES GILIPOLLAS", parentPost: "Una opinión" },
          },
        ]);
        expect(options.questions.abuse.type).toBe("boolean");
        return {
          answers: {
            abuse: { type: "boolean", probability: 0.99 },
            insult: { type: "boolean", probability: 0.98 },
            optOut: { type: "boolean", probability: 0.01 },
          },
          warnings: [],
        };
      },
    });
    expect(
      await evaluate("ERES GILIPOLLAS", "Una opinión", model),
    ).toMatchObject({ abuse: 0.99, insult: 0.98, label: "insult" });
  });
  it("rejects invalid model output rather than making a moderation decision", async () => {
    const model = new Experimental_DecisionMockModelV4({
      doDecide: async () => ({
        answers: {
          abuse: { type: "boolean", probability: 9 },
          insult: { type: "boolean", probability: 0 },
          optOut: { type: "boolean", probability: 0 },
        },
        warnings: [],
      }),
    });
    await expect(evaluate("anything", undefined, model)).rejects.toThrow();
  });
});
