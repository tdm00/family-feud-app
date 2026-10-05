export const ROUND_PHASES = [
  "faceoff",
  "faceoffAnswer",
  "faceoffChoice",
  "play",
  "steal",
  "roundEnd",
] as const;

export type RoundPhase = (typeof ROUND_PHASES)[number];

export type TeamView = {
  id: string;
  slot: 1 | 2;
  name: string;
  color: string;
  score: number;
};

export type PlayerView = {
  id: string;
  name: string;
  teamId: string | null;
};

export type BoardRow = {
  id: string;
  rank: number;
  revealed: boolean;
  text: string | null;
  points: number | null;
};

export type MatchSuggestion = {
  answerId: string;
  text: string;
  distance: number;
  revealed: boolean;
};

export type PendingView = {
  text: string;
  exactAnswerId: string | null;
  duplicate: boolean;
  suggestion: MatchSuggestion | null;
};

export type RoundView = {
  id: string;
  phase: RoundPhase;
  question: string;
  answers: BoardRow[];
  strikes: number;
  pot: number;
  controllingTeamId: string | null;
  faceoffPlayerAId: string | null;
  faceoffPlayerBId: string | null;
  answeringPlayerId: string | null;
  buzzWindowId: string | null;
  buzzerOpen: boolean;
  buzzWinnerId: string | null;
  answerSubmitted: boolean;
  canUndo: boolean;
  stealTeamId: string | null;
  awardedTeamId: string | null;
  faceoffMisses: number;
  pending: PendingView | null;
  answerKey: BoardRow[] | null;
};

export type YouView =
  | { role: "host" }
  | { role: "display" }
  | { role: "player"; id: string; name: string; teamId: string | null };

export type Affordances = {
  canBuzz: boolean;
  canAnswer: boolean;
  buzzReason: string | null;
};

export type Snapshot = {
  game: {
    id: string;
    pointsToWin: number | null;
    roomCode: string | null;
    teams: [TeamView, TeamView];
  };
  players: PlayerView[];
  round: RoundView | null;
  you: YouView;
  affordances: Affordances | null;
};

export const SOCKET_STATE = "state";
export const SOCKET_BUZZ = "buzz";
