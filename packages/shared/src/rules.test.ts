import { describe, expect, it } from "vitest";
import { playerAffordances } from "./affordances.js";
import { addToPot, firstReceivedBuzz, judgeBuzz, nextStrikeCount, resolveSteal } from "./rules.js";

describe("scoring", () => {
  it("counts a strike and ends the turn on the third", () => {
    expect(nextStrikeCount(0)).toEqual({ strikes: 1, turnOver: false });
    expect(nextStrikeCount(1)).toEqual({ strikes: 2, turnOver: false });
    expect(nextStrikeCount(2)).toEqual({ strikes: 3, turnOver: true });
  });

  it("adds revealed points to the pot", () => {
    expect(addToPot(0, 30)).toBe(30);
    expect(addToPot(30, 20)).toBe(50);
  });

  it("awards the whole pot, including the stolen answer, only when the steal is right", () => {
    expect(resolveSteal({ pot: 50, stolenAnswerPoints: 10, correct: true })).toEqual({
      pot: 60,
      awardTo: "stealer",
    });
    expect(resolveSteal({ pot: 50, stolenAnswerPoints: 10, correct: false })).toEqual({
      pot: 50,
      awardTo: "controller",
    });
  });
});

describe("buzz order", () => {
  it("gives the win to the first eligible buzz the server received", () => {
    expect(
      firstReceivedBuzz({
        receiptOrder: ["late", "bob", "alice"],
        eligiblePlayerIds: ["alice", "bob"],
        windowOpen: true,
      }),
    ).toBe("bob");
  });

  it("ignores a closed window and ineligible buzzes", () => {
    expect(
      firstReceivedBuzz({
        receiptOrder: ["alice"],
        eligiblePlayerIds: ["alice"],
        windowOpen: false,
      }),
    ).toBeNull();
    expect(
      firstReceivedBuzz({
        receiptOrder: ["charlie", "charlie"],
        eligiblePlayerIds: ["alice", "bob"],
        windowOpen: true,
      }),
    ).toBeNull();
  });

  it("ignores a second press, a stale window, and an ineligible player", () => {
    const base = {
      windowOpen: true,
      expectedWindowId: "win-1",
      givenWindowId: "win-1",
      eligiblePlayerIds: ["alice"],
      playerId: "alice",
      alreadyHasWinner: false,
    };
    expect(judgeBuzz(base)).toBe("accept");
    expect(judgeBuzz({ ...base, alreadyHasWinner: true })).toBe("ignore");
    expect(judgeBuzz({ ...base, givenWindowId: "win-0" })).toBe("ignore");
    expect(judgeBuzz({ ...base, playerId: "charlie" })).toBe("ignore");
    expect(judgeBuzz({ ...base, windowOpen: false })).toBe("ignore");
  });
});

describe("playerAffordances", () => {
  it("uses the face-off, team, and closed reasons", () => {
    expect(
      playerAffordances({
        hasTeam: true,
        phase: "faceoff",
        buzzerOpen: true,
        eligible: false,
        isControllingTeam: false,
        isStealTeam: false,
        isAnswering: false,
      }).buzzReason,
    ).toBe("Face-off");

    expect(
      playerAffordances({
        hasTeam: true,
        phase: "play",
        buzzerOpen: false,
        eligible: false,
        isControllingTeam: true,
        isStealTeam: false,
        isAnswering: false,
      }).buzzReason,
    ).toBe("Your team is playing");

    expect(
      playerAffordances({
        hasTeam: true,
        phase: "faceoff",
        buzzerOpen: false,
        eligible: true,
        isControllingTeam: false,
        isStealTeam: false,
        isAnswering: false,
      }).buzzReason,
    ).toBe("Buzzer closed");
  });
});
