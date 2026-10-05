export const MAX_STRIKES = 3;

export function nextStrikeCount(strikes: number): { strikes: number; turnOver: boolean } {
  const next = strikes + 1;
  return { strikes: next, turnOver: next >= MAX_STRIKES };
}

export function addToPot(pot: number, points: number): number {
  return pot + points;
}

export function resolveSteal(args: {
  pot: number;
  stolenAnswerPoints: number;
  correct: boolean;
}): { pot: number; awardTo: "stealer" | "controller" } {
  if (args.correct) {
    return { pot: args.pot + args.stolenAnswerPoints, awardTo: "stealer" };
  }
  return { pot: args.pot, awardTo: "controller" };
}

export function judgeBuzz(args: {
  windowOpen: boolean;
  expectedWindowId: string | null;
  givenWindowId: string;
  eligiblePlayerIds: string[];
  playerId: string;
  alreadyHasWinner: boolean;
}): "accept" | "ignore" {
  if (!args.windowOpen) return "ignore";
  if (args.alreadyHasWinner) return "ignore";
  if (!args.expectedWindowId || args.givenWindowId !== args.expectedWindowId) return "ignore";
  if (!args.eligiblePlayerIds.includes(args.playerId)) return "ignore";
  return "accept";
}

/** Winner is the first eligible id in server receipt order. Closed windows award nobody. */
export function firstReceivedBuzz(args: {
  receiptOrder: string[];
  eligiblePlayerIds: string[];
  windowOpen: boolean;
}): string | null {
  if (!args.windowOpen) return null;
  for (const id of args.receiptOrder) {
    if (args.eligiblePlayerIds.includes(id)) return id;
  }
  return null;
}
