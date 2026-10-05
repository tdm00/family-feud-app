export type AnswerCandidate = {
  id: string;
  text: string;
  aliases: string[];
  revealed: boolean;
};

export type MatchOutcome = {
  exactAnswerId: string | null;
  duplicate: boolean;
  suggestion: {
    answerId: string;
    text: string;
    distance: number;
    revealed: boolean;
  } | null;
};

export function normalizeAnswer(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j]!;
  }
  return prev[b.length]!;
}

function suggestionLimit(left: string, right: string): number {
  return Math.max(left.length, right.length) <= 4 ? 1 : 2;
}

export function matchAnswer(raw: string, answers: AnswerCandidate[]): MatchOutcome {
  const norm = normalizeAnswer(raw);
  if (!norm) {
    return { exactAnswerId: null, duplicate: false, suggestion: null };
  }

  for (const answer of answers) {
    const names = [answer.text, ...answer.aliases].map(normalizeAnswer);
    if (names.includes(norm)) {
      return {
        exactAnswerId: answer.id,
        duplicate: answer.revealed,
        suggestion: null,
      };
    }
  }

  let best: { answer: AnswerCandidate; distance: number } | null = null;
  for (const answer of answers) {
    const names = [answer.text, ...answer.aliases].map(normalizeAnswer).filter(Boolean);
    for (const name of names) {
      const distance = levenshtein(norm, name);
      if (distance === 0 || distance > suggestionLimit(norm, name)) continue;
      if (!best || distance < best.distance) best = { answer, distance };
    }
  }

  return {
    exactAnswerId: null,
    duplicate: false,
    suggestion: best
      ? {
          answerId: best.answer.id,
          text: best.answer.text,
          distance: best.distance,
          revealed: best.answer.revealed,
        }
      : null,
  };
}
