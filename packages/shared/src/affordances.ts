import type { Affordances, RoundPhase } from "./types.js";

export function playerAffordances(input: {
  hasTeam: boolean;
  phase: RoundPhase | null;
  buzzerOpen: boolean;
  eligible: boolean;
  isControllingTeam: boolean;
  isStealTeam: boolean;
  isAnswering: boolean;
}): Affordances {
  if (
    input.isAnswering &&
    input.phase &&
    (input.phase === "faceoffAnswer" || input.phase === "play" || input.phase === "steal")
  ) {
    return { canBuzz: false, canAnswer: true, buzzReason: null };
  }
  if (!input.hasTeam || !input.phase) {
    return { canBuzz: false, canAnswer: false, buzzReason: "Buzzer closed" };
  }
  if (input.phase === "faceoff") {
    if (input.eligible && input.buzzerOpen) {
      return { canBuzz: true, canAnswer: false, buzzReason: null };
    }
    if (!input.eligible && input.buzzerOpen) {
      return { canBuzz: false, canAnswer: false, buzzReason: "Face-off" };
    }
    return { canBuzz: false, canAnswer: false, buzzReason: "Buzzer closed" };
  }
  if (
    (input.phase === "play" && input.isControllingTeam) ||
    (input.phase === "steal" && input.isStealTeam)
  ) {
    return { canBuzz: false, canAnswer: false, buzzReason: "Your team is playing" };
  }
  return { canBuzz: false, canAnswer: false, buzzReason: "Buzzer closed" };
}
