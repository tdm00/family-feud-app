import { describe, expect, it } from "vitest";
import { matchAnswer, normalizeAnswer } from "./match.js";

const couch = {
  id: "couch",
  text: "Couch",
  aliases: ["Sofa"],
  revealed: false,
};
const chair = {
  id: "chair",
  text: "Chair",
  aliases: [],
  revealed: false,
};

describe("normalizeAnswer", () => {
  it("trims, lowercases, strips punctuation, and collapses spaces", () => {
    expect(normalizeAnswer("  SOFA!! ")).toBe("sofa");
    expect(normalizeAnswer("Ice-cream")).toBe("icecream");
    expect(normalizeAnswer("hot   dog")).toBe("hot dog");
  });
});

describe("matchAnswer", () => {
  it("matches aliases and the canonical answer", () => {
    expect(matchAnswer("sofa", [couch, chair]).exactAnswerId).toBe("couch");
    expect(matchAnswer("  Couch! ", [couch, chair]).exactAnswerId).toBe("couch");
  });

  it("flags a repeat of a revealed answer and does not treat it as a new hit", () => {
    const revealed = { ...couch, revealed: true };
    const outcome = matchAnswer("sofa", [revealed, chair]);
    expect(outcome.exactAnswerId).toBe("couch");
    expect(outcome.duplicate).toBe(true);
    expect(outcome.suggestion).toBeNull();
  });

  it("suggests a close match without an exact award", () => {
    const outcome = matchAnswer("couhc", [couch, chair]);
    expect(outcome.exactAnswerId).toBeNull();
    expect(outcome.duplicate).toBe(false);
    expect(outcome.suggestion).toMatchObject({ answerId: "couch", distance: 2 });
  });

  it("does not suggest an unrelated guess", () => {
    expect(matchAnswer("zzzz", [couch, chair]).suggestion).toBeNull();
    expect(matchAnswer("!!!", [couch, chair])).toEqual({
      exactAnswerId: null,
      duplicate: false,
      suggestion: null,
    });
  });
});
