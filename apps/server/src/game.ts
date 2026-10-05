import type Database from "better-sqlite3";
import {
  addToPot,
  judgeBuzz,
  matchAnswer,
  normalizeAnswer,
  nextStrikeCount,
  playerAffordances,
  resolveSteal,
  type AnswerCandidate,
  type BoardRow,
  type RoundPhase,
  type Snapshot,
} from "@feud/shared";
import { asc, eq } from "drizzle-orm";
import { hashToken, newToken } from "./auth.js";
import type { AppDb } from "./db.js";
import {
  aliases,
  answers,
  buzzWindows,
  buzzes,
  displayTokens,
  games,
  players,
  questions,
  roundReveals,
  rounds,
  settings,
  teams,
} from "./schema.js";

export class GameError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GameError";
  }
}

export type AnswerInput = {
  text: string;
  points: number;
  rank: number;
  aliases: string[];
};

export type QuestionInput = {
  prompt: string;
  answers: AnswerInput[];
};

export type QuestionDto = {
  id: string;
  prompt: string;
  usedAt: number | null;
  sortOrder: number;
  answers: { id: string; text: string; points: number; rank: number; aliases: string[] }[];
};

type RoundRow = typeof rounds.$inferSelect;
type TeamRow = typeof teams.$inferSelect;
type PlayerRow = typeof players.$inferSelect;

type UndoBlob = {
  round: {
    phase: string;
    controllingTeamId: string | null;
    faceoffPlayerA: string | null;
    faceoffPlayerB: string | null;
    answeringPlayerId: string | null;
    faceoffMisses: number;
    strikes: number;
    pot: number;
    stealTeamId: string | null;
    buzzWindowId: string | null;
    buzzWinnerId: string | null;
    pendingText: string | null;
    pointsApplied: number;
    awardedTeamId: string | null;
  };
  reveals: { id: string; answerId: string; revealedAt: number }[];
  scores: { id: string; score: number }[];
  usedAt: number | null;
};

function nid(): string {
  return crypto.randomUUID();
}

function isConstraint(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && String((error as { code: unknown }).code).includes("CONSTRAINT");
}

function cleanName(name: string): string {
  const cleaned = name.trim().replace(/\s+/g, " ");
  if (cleaned.length < 1 || cleaned.length > 24) throw new GameError(400, "Name must be 1 to 24 characters");
  return cleaned;
}

function asPhase(phase: string): RoundPhase {
  if (
    phase === "faceoff" ||
    phase === "faceoffAnswer" ||
    phase === "faceoffChoice" ||
    phase === "play" ||
    phase === "steal" ||
    phase === "roundEnd"
  ) {
    return phase;
  }
  throw new GameError(500, "Unknown round phase");
}

function asSlot(slot: number): 1 | 2 {
  if (slot !== 1 && slot !== 2) throw new GameError(500, "Invalid team slot");
  return slot;
}

export class GameStore {
  constructor(
    private readonly sqlite: Database.Database,
    private readonly db: AppDb,
  ) {}

  private tx<T>(fn: () => T): T {
    return this.sqlite.transaction(fn)();
  }

  private setting(key: string): string {
    const row = this.db.select().from(settings).where(eq(settings.key, key)).get();
    if (!row) throw new GameError(500, `Missing setting ${key}`);
    return row.value;
  }

  private roomMatches(given: string): boolean {
    return given.trim().toLowerCase() === this.setting("room_code").trim().toLowerCase();
  }

  private teamRows(): [TeamRow, TeamRow] {
    const rows = this.db.select().from(teams).all().sort((a, b) => a.slot - b.slot);
    if (rows.length !== 2 || !rows[0] || !rows[1]) throw new GameError(500, "Expected two teams");
    return [rows[0], rows[1]];
  }

  private mustTeam(id: string): TeamRow {
    const team = this.db.select().from(teams).where(eq(teams.id, id)).get();
    if (!team) throw new GameError(404, "Team not found");
    return team;
  }

  private otherTeamId(teamId: string): string {
    const [a, b] = this.teamRows();
    if (a.id === teamId) return b.id;
    if (b.id === teamId) return a.id;
    throw new GameError(400, "That team is not in this game");
  }

  private playerRows(): PlayerRow[] {
    return this.db.select().from(players).all().sort((a, b) => a.name.localeCompare(b.name));
  }

  private mustPlayer(id: string | null): PlayerRow {
    if (!id) throw new GameError(400, "Choose a player");
    const player = this.db.select().from(players).where(eq(players.id, id)).get();
    if (!player) throw new GameError(404, "Player not found");
    return player;
  }

  playerByToken(token: string): PlayerRow | null {
    if (!token) return null;
    return this.db.select().from(players).where(eq(players.tokenHash, hashToken(token))).get() ?? null;
  }

  displayValid(token: string): boolean {
    if (!token) return false;
    return Boolean(this.db.select().from(displayTokens).where(eq(displayTokens.tokenHash, hashToken(token))).get());
  }

  private activeGame() {
    const game = this.db.select().from(games).where(eq(games.status, "active")).get();
    if (!game) throw new GameError(500, "No active game");
    return game;
  }

  private activeRound(): RoundRow | null {
    return this.db.select().from(rounds).where(eq(rounds.active, 1)).get() ?? null;
  }

  private mustActive(): RoundRow {
    const round = this.activeRound();
    if (!round) throw new GameError(400, "Start a round first");
    return round;
  }

  private mustRound(id: string): RoundRow {
    const round = this.db.select().from(rounds).where(eq(rounds.id, id)).get();
    if (!round) throw new GameError(404, "Round not found");
    return round;
  }

  private mustQuestion(id: string) {
    const question = this.db.select().from(questions).where(eq(questions.id, id)).get();
    if (!question) throw new GameError(404, "Question not found");
    return question;
  }

  private answerRows(questionId: string) {
    return this.db.select().from(answers).where(eq(answers.questionId, questionId)).all();
  }

  private revealRows(roundId: string) {
    return this.db.select().from(roundReveals).where(eq(roundReveals.roundId, roundId)).all();
  }

  private aliasMap(): Map<string, string[]> {
    const map = new Map<string, string[]>();
    for (const alias of this.db.select().from(aliases).all()) {
      const list = map.get(alias.answerId) ?? [];
      list.push(alias.text);
      map.set(alias.answerId, list);
    }
    return map;
  }

  private candidates(questionId: string, roundId: string): AnswerCandidate[] {
    const revealed = new Set(this.revealRows(roundId).map((row) => row.answerId));
    const aliasMap = this.aliasMap();
    return this.answerRows(questionId).map((answer) => ({
      id: answer.id,
      text: answer.text,
      aliases: aliasMap.get(answer.id) ?? [],
      revealed: revealed.has(answer.id),
    }));
  }

  private windowRow(id: string) {
    return this.db.select().from(buzzWindows).where(eq(buzzWindows.id, id)).get() ?? null;
  }

  private closeWindow(id: string | null): void {
    if (!id) return;
    this.db.update(buzzWindows).set({ open: 0 }).where(eq(buzzWindows.id, id)).run();
  }

  private assertAnswerPhase(phase: string): void {
    if (phase !== "faceoffAnswer" && phase !== "play" && phase !== "steal") {
      throw new GameError(400, "Nobody can answer right now");
    }
  }

  private prepareQuestion(input: QuestionInput): QuestionInput {
    const prompt = input.prompt.trim().replace(/\s+/g, " ");
    if (prompt.length < 1 || prompt.length > 200) throw new GameError(400, "Enter a question");
    if (input.answers.length < 1 || input.answers.length > 8) {
      throw new GameError(400, "A question needs 1 to 8 answers");
    }
    const ranks = new Set<number>();
    const seen = new Set<string>();
    const prepared: AnswerInput[] = [];
    for (const answer of input.answers) {
      const text = answer.text.trim().replace(/\s+/g, " ");
      const norm = normalizeAnswer(text);
      if (!norm || text.length > 80) throw new GameError(400, "Each answer needs text");
      if (!Number.isInteger(answer.points) || answer.points < 1 || answer.points > 999) {
        throw new GameError(400, "Points must be from 1 to 999");
      }
      if (!Number.isInteger(answer.rank) || answer.rank < 1 || answer.rank > 8) {
        throw new GameError(400, "Rank must be from 1 to 8");
      }
      if (ranks.has(answer.rank)) throw new GameError(400, "Each answer needs its own rank");
      ranks.add(answer.rank);
      if (seen.has(norm)) throw new GameError(400, "Answers must be different");
      seen.add(norm);
      const aliasText: string[] = [];
      for (const alias of answer.aliases) {
        const trimmed = alias.trim().replace(/\s+/g, " ");
        const aliasNorm = normalizeAnswer(trimmed);
        if (!aliasNorm) continue;
        if (trimmed.length > 40) throw new GameError(400, "Aliases must be 40 characters or less");
        if (seen.has(aliasNorm)) throw new GameError(400, "Aliases must be different from every answer");
        seen.add(aliasNorm);
        aliasText.push(trimmed);
      }
      prepared.push({ text, points: answer.points, rank: answer.rank, aliases: aliasText });
    }
    return { prompt, answers: prepared };
  }

  private insertAnswers(questionId: string, input: AnswerInput[]): void {
    for (const answer of input) {
      const answerId = nid();
      this.db
        .insert(answers)
        .values({ id: answerId, questionId, text: answer.text, points: answer.points, rank: answer.rank })
        .run();
      for (const alias of answer.aliases) {
        this.db.insert(aliases).values({ id: nid(), answerId, text: alias }).run();
      }
    }
  }

  private questionDto(id: string): QuestionDto {
    const question = this.mustQuestion(id);
    const aliasMap = this.aliasMap();
    return {
      id: question.id,
      prompt: question.prompt,
      usedAt: question.usedAt,
      sortOrder: question.sortOrder,
      answers: this.answerRows(id)
        .sort((a, b) => a.rank - b.rank)
        .map((answer) => ({
          id: answer.id,
          text: answer.text,
          points: answer.points,
          rank: answer.rank,
          aliases: aliasMap.get(answer.id) ?? [],
        })),
    };
  }

  private captureUndo(roundId: string): void {
    const round = this.mustRound(roundId);
    const question = this.mustQuestion(round.questionId);
    const blob: UndoBlob = {
      round: {
        phase: round.phase,
        controllingTeamId: round.controllingTeamId,
        faceoffPlayerA: round.faceoffPlayerA,
        faceoffPlayerB: round.faceoffPlayerB,
        answeringPlayerId: round.answeringPlayerId,
        faceoffMisses: round.faceoffMisses,
        strikes: round.strikes,
        pot: round.pot,
        stealTeamId: round.stealTeamId,
        buzzWindowId: round.buzzWindowId,
        buzzWinnerId: round.buzzWinnerId,
        pendingText: round.pendingText,
        pointsApplied: round.pointsApplied,
        awardedTeamId: round.awardedTeamId,
      },
      reveals: this.revealRows(roundId).map((row) => ({
        id: row.id,
        answerId: row.answerId,
        revealedAt: row.revealedAt,
      })),
      scores: this.teamRows().map((team) => ({ id: team.id, score: team.score })),
      usedAt: question.usedAt,
    };
    this.db.update(rounds).set({ undoJson: JSON.stringify(blob) }).where(eq(rounds.id, roundId)).run();
  }

  private award(roundId: string, teamId: string, pot: number): void {
    const round = this.mustRound(roundId);
    if (round.pointsApplied) throw new GameError(400, "Points already awarded");
    const team = this.mustTeam(teamId);
    this.db.update(teams).set({ score: team.score + pot }).where(eq(teams.id, teamId)).run();
    this.db.update(questions).set({ usedAt: Date.now() }).where(eq(questions.id, round.questionId)).run();
    this.db
      .update(rounds)
      .set({
        pot,
        pointsApplied: 1,
        awardedTeamId: teamId,
        phase: "roundEnd",
        answeringPlayerId: null,
        pendingText: null,
      })
      .where(eq(rounds.id, roundId))
      .run();
  }

  private applyMiss(round: RoundRow): void {
    this.captureUndo(round.id);
    if (round.phase === "faceoffAnswer") {
      const misses = round.faceoffMisses + 1;
      if (misses >= 2) {
        this.closeWindow(round.buzzWindowId);
        this.db
          .update(rounds)
          .set({
            faceoffMisses: misses,
            phase: "faceoff",
            answeringPlayerId: null,
            pendingText: null,
          })
          .where(eq(rounds.id, round.id))
          .run();
        return;
      }
      const other = round.answeringPlayerId === round.faceoffPlayerA ? round.faceoffPlayerB : round.faceoffPlayerA;
      this.db
        .update(rounds)
        .set({
          faceoffMisses: misses,
          answeringPlayerId: other,
          pendingText: null,
          phase: "faceoffAnswer",
        })
        .where(eq(rounds.id, round.id))
        .run();
      return;
    }
    if (round.phase === "play") {
      if (!round.controllingTeamId) throw new GameError(400, "No team has control");
      const next = nextStrikeCount(round.strikes);
      if (next.turnOver) {
        this.db
          .update(rounds)
          .set({
            strikes: next.strikes,
            phase: "steal",
            stealTeamId: this.otherTeamId(round.controllingTeamId),
            answeringPlayerId: null,
            pendingText: null,
          })
          .where(eq(rounds.id, round.id))
          .run();
        return;
      }
      this.db
        .update(rounds)
        .set({ strikes: next.strikes, pendingText: null })
        .where(eq(rounds.id, round.id))
        .run();
      return;
    }
    if (round.phase === "steal") {
      if (!round.controllingTeamId) throw new GameError(400, "No team has control");
      const result = resolveSteal({ pot: round.pot, stolenAnswerPoints: 0, correct: false });
      this.award(round.id, round.controllingTeamId, result.pot);
      return;
    }
    throw new GameError(400, "That miss does not apply right now");
  }

  join(roomCode: string, name: string): { token: string; player: { id: string; name: string; teamId: string | null } } {
    if (!this.roomMatches(roomCode)) throw new GameError(401, "Wrong room code");
    const cleaned = cleanName(name);
    const token = newToken();
    const id = nid();
    try {
      this.db
        .insert(players)
        .values({ id, name: cleaned, tokenHash: hashToken(token), teamId: null, createdAt: Date.now() })
        .run();
    } catch (error) {
      if (isConstraint(error)) throw new GameError(409, "That name is already taken");
      throw error;
    }
    return { token, player: { id, name: cleaned, teamId: null } };
  }

  createDisplayToken(roomCode: string): { token: string } {
    if (!this.roomMatches(roomCode)) throw new GameError(401, "Wrong room code");
    const token = newToken();
    this.db.insert(displayTokens).values({ tokenHash: hashToken(token), createdAt: Date.now() }).run();
    return { token };
  }

  updateTeam(slot: 1 | 2, name: string, color: string): void {
    const cleaned = name.trim().replace(/\s+/g, " ");
    if (cleaned.length < 1 || cleaned.length > 24) throw new GameError(400, "Give the team a name");
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new GameError(400, "Pick a hex color");
    const team = this.teamRows().find((row) => row.slot === slot);
    if (!team) throw new GameError(500, "Teams are not ready");
    this.db.update(teams).set({ name: cleaned, color }).where(eq(teams.id, team.id)).run();
  }

  assignPlayer(playerId: string, teamId: string | null): void {
    const player = this.mustPlayer(playerId);
    const round = this.activeRound();
    if (round && round.phase !== "roundEnd") {
      const involved = [round.faceoffPlayerA, round.faceoffPlayerB, round.answeringPlayerId];
      if (involved.includes(player.id)) throw new GameError(409, "That player is in the current round");
    }
    if (teamId) this.mustTeam(teamId);
    this.db.update(players).set({ teamId }).where(eq(players.id, playerId)).run();
  }

  renamePlayer(playerId: string, name: string): void {
    this.mustPlayer(playerId);
    const cleaned = cleanName(name);
    try {
      this.db.update(players).set({ name: cleaned }).where(eq(players.id, playerId)).run();
    } catch (error) {
      if (isConstraint(error)) throw new GameError(409, "That name is already taken");
      throw error;
    }
  }

  removePlayer(playerId: string): void {
    this.mustPlayer(playerId);
    const round = this.activeRound();
    if (round && round.phase !== "roundEnd") {
      const involved = [round.faceoffPlayerA, round.faceoffPlayerB, round.answeringPlayerId];
      if (involved.includes(playerId)) throw new GameError(409, "That player is in the current round");
    }
    this.db.delete(players).where(eq(players.id, playerId)).run();
  }

  updateSettings(input: { roomCode?: string; pointsToWin?: number | null }): void {
    if (input.roomCode !== undefined) {
      const code = input.roomCode.trim();
      if (!/^[A-Za-z0-9]{3,16}$/.test(code)) {
        throw new GameError(400, "Room code must be 3 to 16 letters or numbers");
      }
      this.db.update(settings).set({ value: code }).where(eq(settings.key, "room_code")).run();
    }
    if (input.pointsToWin !== undefined) {
      if (input.pointsToWin !== null && (!Number.isInteger(input.pointsToWin) || input.pointsToWin < 1 || input.pointsToWin > 100000)) {
        throw new GameError(400, "Points to win must be a positive number");
      }
      this.db
        .update(settings)
        .set({ value: input.pointsToWin == null ? "" : String(input.pointsToWin) })
        .where(eq(settings.key, "points_to_win"))
        .run();
    }
  }

  listQuestions(filter: { q?: string; used?: "all" | "used" | "unused" }): QuestionDto[] {
    let rows = this.db.select().from(questions).orderBy(asc(questions.sortOrder), asc(questions.createdAt)).all();
    if (filter.used === "used") rows = rows.filter((row) => row.usedAt != null);
    if (filter.used === "unused") rows = rows.filter((row) => row.usedAt == null);
    const q = filter.q?.trim().toLowerCase();
    if (q) rows = rows.filter((row) => row.prompt.toLowerCase().includes(q));
    return rows.map((row) => this.questionDto(row.id));
  }

  createQuestion(input: QuestionInput): QuestionDto {
    const prepared = this.prepareQuestion(input);
    const id = nid();
    const sortOrder = this.db.select().from(questions).all().reduce((max, row) => Math.max(max, row.sortOrder), -1) + 1;
    this.tx(() => {
      this.db
        .insert(questions)
        .values({
          id,
          prompt: prepared.prompt,
          usedAt: null,
          sortOrder,
          createdAt: Date.now(),
        })
        .run();
      this.insertAnswers(id, prepared.answers);
    });
    return this.questionDto(id);
  }

  updateQuestion(id: string, input: QuestionInput): QuestionDto {
    const prepared = this.prepareQuestion(input);
    const active = this.activeRound();
    if (active?.questionId === id) throw new GameError(409, "This question is on the board");
    this.mustQuestion(id);
    this.tx(() => {
      const existing = this.answerRows(id);
      for (const answer of existing) {
        this.db.delete(aliases).where(eq(aliases.answerId, answer.id)).run();
      }
      this.db.delete(answers).where(eq(answers.questionId, id)).run();
      this.db.update(questions).set({ prompt: prepared.prompt }).where(eq(questions.id, id)).run();
      this.insertAnswers(id, prepared.answers);
    });
    return this.questionDto(id);
  }

  deleteQuestion(id: string): void {
    const active = this.activeRound();
    if (active?.questionId === id) throw new GameError(409, "This question is on the board");
    const used = this.db.select().from(rounds).where(eq(rounds.questionId, id)).get();
    if (used) throw new GameError(409, "This question was used in a round");
    this.mustQuestion(id);
    this.tx(() => {
      const existing = this.answerRows(id);
      for (const answer of existing) {
        this.db.delete(aliases).where(eq(aliases.answerId, answer.id)).run();
      }
      this.db.delete(answers).where(eq(answers.questionId, id)).run();
      this.db.delete(questions).where(eq(questions.id, id)).run();
    });
  }

  reorderQuestions(ids: string[]): void {
    this.tx(() => {
      const existing = this.db.select().from(questions).all();
      const known = new Set(existing.map((row) => row.id));
      if (ids.length !== existing.length || ids.some((id) => !known.has(id)) || new Set(ids).size !== ids.length) {
        throw new GameError(400, "Include every question");
      }
      ids.forEach((id, index) => {
        this.db.update(questions).set({ sortOrder: index }).where(eq(questions.id, id)).run();
      });
    });
  }

  startFaceoff(input: { questionId: string; faceoffPlayerAId: string; faceoffPlayerBId: string }): void {
    this.tx(() => {
      if (this.activeRound()) throw new GameError(400, "Finish the current round first");
      const question = this.mustQuestion(input.questionId);
      if (this.answerRows(question.id).length < 1) throw new GameError(400, "That question has no answers");
      const first = this.mustPlayer(input.faceoffPlayerAId);
      const second = this.mustPlayer(input.faceoffPlayerBId);
      const [teamA, teamB] = this.teamRows();
      const playerA = first.teamId === teamA.id ? first : second;
      const playerB = first.teamId === teamB.id ? first : second;
      if (playerA.id === playerB.id || playerA.teamId !== teamA.id || playerB.teamId !== teamB.id) {
        throw new GameError(400, "Pick one player from each team");
      }
      const game = this.activeGame();
      const roundId = nid();
      const windowId = nid();
      const now = Date.now();
      this.db
        .insert(rounds)
        .values({
          id: roundId,
          gameId: game.id,
          questionId: question.id,
          phase: "faceoff",
          active: 1,
          controllingTeamId: null,
          faceoffPlayerA: playerA.id,
          faceoffPlayerB: playerB.id,
          answeringPlayerId: null,
          faceoffMisses: 0,
          strikes: 0,
          pot: 0,
          stealTeamId: null,
          buzzWindowId: windowId,
          buzzWinnerId: null,
          pendingText: null,
          pointsApplied: 0,
          awardedTeamId: null,
          undoJson: null,
          createdAt: now,
        })
        .run();
      this.db
        .insert(buzzWindows)
        .values({
          id: windowId,
          roundId,
          winnerPlayerId: null,
          open: 1,
          eligibleJson: JSON.stringify([playerA.id, playerB.id]),
          createdAt: now,
        })
        .run();
    });
  }

  setBuzzers(open: boolean): void {
    this.tx(() => {
      const round = this.mustActive();
      if (round.phase !== "faceoff") throw new GameError(400, "Buzzers open during the face-off");
      if (!open) {
        this.closeWindow(round.buzzWindowId);
        return;
      }
      if (!round.faceoffPlayerA || !round.faceoffPlayerB) throw new GameError(400, "Face-off players are missing");
      this.closeWindow(round.buzzWindowId);
      const windowId = nid();
      this.db
        .insert(buzzWindows)
        .values({
          id: windowId,
          roundId: round.id,
          winnerPlayerId: null,
          open: 1,
          eligibleJson: JSON.stringify([round.faceoffPlayerA, round.faceoffPlayerB]),
          createdAt: Date.now(),
        })
        .run();
      this.db
        .update(rounds)
        .set({
          buzzWindowId: windowId,
          buzzWinnerId: null,
          answeringPlayerId: null,
          faceoffMisses: 0,
          pendingText: null,
          phase: "faceoff",
        })
        .where(eq(rounds.id, round.id))
        .run();
    });
  }

  buzz(playerId: string, windowId: string): { won: boolean } {
    return this.tx(() => {
      const round = this.activeRound();
      if (!round) return { won: false };
      const window = this.windowRow(windowId);
      let eligible: string[] = [];
      try {
        eligible = window ? (JSON.parse(window.eligibleJson) as string[]) : [];
      } catch {
        eligible = [];
      }
      const decision = judgeBuzz({
        windowOpen: window?.open === 1 && round.phase === "faceoff",
        expectedWindowId: round.buzzWindowId,
        givenWindowId: windowId,
        eligiblePlayerIds: eligible,
        playerId,
        alreadyHasWinner: window?.winnerPlayerId != null,
      });
      const claim =
        decision === "accept"
          ? this.sqlite
              .prepare(
                "UPDATE buzz_windows SET winner_player_id = ?, open = 0 WHERE id = ? AND open = 1 AND winner_player_id IS NULL",
              )
              .run(playerId, windowId).changes
          : 0;
      const won = claim === 1;
      this.db
        .insert(buzzes)
        .values({
          id: nid(),
          roundId: round.id,
          windowId,
          playerId,
          receivedAt: Date.now(),
          won: won ? 1 : 0,
        })
        .run();
      if (!won) return { won: false };
      this.db
        .update(rounds)
        .set({
          buzzWinnerId: playerId,
          answeringPlayerId: playerId,
          phase: "faceoffAnswer",
          pendingText: null,
        })
        .where(eq(rounds.id, round.id))
        .run();
      return { won: true };
    });
  }

  submitAnswer(text: string, actor: { host: true } | { host: false; playerId: string }): void {
    const cleaned = text.trim().replace(/\s+/g, " ");
    if (!cleaned || cleaned.length > 80) throw new GameError(400, "Enter an answer");
    this.tx(() => {
      const round = this.mustActive();
      this.assertAnswerPhase(round.phase);
      if (!actor.host && round.answeringPlayerId !== actor.playerId) {
        throw new GameError(403, "It is not your turn");
      }
      this.db.update(rounds).set({ pendingText: cleaned }).where(eq(rounds.id, round.id)).run();
    });
  }

  acceptAnswer(answerId: string): void {
    this.tx(() => {
      const round = this.mustActive();
      this.assertAnswerPhase(round.phase);
      const answer = this.answerRows(round.questionId).find((row) => row.id === answerId);
      if (!answer) throw new GameError(404, "That answer is not on this question");
      const revealed = new Set(this.revealRows(round.id).map((row) => row.answerId));
      if (revealed.has(answer.id)) {
        this.applyMiss(round);
        return;
      }
      if (round.phase === "faceoffAnswer" && !round.answeringPlayerId) {
        throw new GameError(400, "Nobody has buzzed in");
      }
      if (round.phase === "play" && !round.controllingTeamId) throw new GameError(400, "No team has control");
      if (round.phase === "steal" && !round.stealTeamId) throw new GameError(400, "No team is stealing");

      this.captureUndo(round.id);
      this.db
        .insert(roundReveals)
        .values({ id: nid(), roundId: round.id, answerId: answer.id, revealedAt: Date.now() })
        .run();

      if (round.phase === "steal") {
        const result = resolveSteal({
          pot: round.pot,
          stolenAnswerPoints: answer.points,
          correct: true,
        });
        this.award(round.id, round.stealTeamId!, result.pot);
        return;
      }

      const pot = addToPot(round.pot, answer.points);
      if (round.phase === "faceoffAnswer") {
        const player = this.mustPlayer(round.answeringPlayerId);
        if (!player.teamId) throw new GameError(400, "That player is not on a team");
        this.db
          .update(rounds)
          .set({
            pot,
            pendingText: null,
            phase: "faceoffChoice",
            controllingTeamId: player.teamId,
            answeringPlayerId: null,
          })
          .where(eq(rounds.id, round.id))
          .run();
        return;
      }

      const shown = this.revealRows(round.id).length;
      const total = this.answerRows(round.questionId).length;
      if (shown >= total) {
        this.award(round.id, round.controllingTeamId!, pot);
        return;
      }
      this.db.update(rounds).set({ pot, pendingText: null }).where(eq(rounds.id, round.id)).run();
    });
  }

  rejectAnswer(): void {
    this.tx(() => {
      const round = this.mustActive();
      this.assertAnswerPhase(round.phase);
      if (!round.pendingText) throw new GameError(400, "No answer is waiting");
      this.applyMiss(round);
    });
  }

  strike(): void {
    this.tx(() => {
      const round = this.mustActive();
      if (round.phase !== "play") throw new GameError(400, "Strikes happen during main play");
      this.applyMiss(round);
    });
  }

  choose(choice: "play" | "pass"): void {
    this.tx(() => {
      const round = this.mustActive();
      if (round.phase !== "faceoffChoice") throw new GameError(400, "Play or pass is not available");
      if (!round.controllingTeamId) throw new GameError(400, "No team won the face-off");
      const controlling = choice === "pass" ? this.otherTeamId(round.controllingTeamId) : round.controllingTeamId;
      this.db
        .update(rounds)
        .set({
          phase: "play",
          controllingTeamId: controlling,
          answeringPlayerId: null,
          pendingText: null,
        })
        .where(eq(rounds.id, round.id))
        .run();
    });
  }

  setAnswerer(playerId: string): void {
    this.tx(() => {
      const round = this.mustActive();
      const player = this.mustPlayer(playerId);
      if (round.phase === "play") {
        if (player.teamId !== round.controllingTeamId) {
          throw new GameError(400, "Pick someone on the team that has control");
        }
      } else if (round.phase === "steal") {
        if (player.teamId !== round.stealTeamId) throw new GameError(400, "Pick someone on the stealing team");
      } else {
        throw new GameError(400, "Nobody needs to be chosen right now");
      }
      this.db
        .update(rounds)
        .set({ answeringPlayerId: playerId, pendingText: null })
        .where(eq(rounds.id, round.id))
        .run();
    });
  }

  undo(): void {
    this.tx(() => {
      const round = this.mustActive();
      if (!round.undoJson) throw new GameError(400, "Nothing to undo");
      const blob = JSON.parse(round.undoJson) as UndoBlob;
      this.db.delete(roundReveals).where(eq(roundReveals.roundId, round.id)).run();
      for (const reveal of blob.reveals) {
        this.db
          .insert(roundReveals)
          .values({ id: reveal.id, roundId: round.id, answerId: reveal.answerId, revealedAt: reveal.revealedAt })
          .run();
      }
      this.db
        .update(rounds)
        .set({
          phase: blob.round.phase,
          controllingTeamId: blob.round.controllingTeamId,
          faceoffPlayerA: blob.round.faceoffPlayerA,
          faceoffPlayerB: blob.round.faceoffPlayerB,
          answeringPlayerId: blob.round.answeringPlayerId,
          faceoffMisses: blob.round.faceoffMisses,
          strikes: blob.round.strikes,
          pot: blob.round.pot,
          stealTeamId: blob.round.stealTeamId,
          buzzWindowId: blob.round.buzzWindowId,
          buzzWinnerId: blob.round.buzzWinnerId,
          pendingText: blob.round.pendingText,
          pointsApplied: blob.round.pointsApplied,
          awardedTeamId: blob.round.awardedTeamId,
          undoJson: null,
        })
        .where(eq(rounds.id, round.id))
        .run();
      for (const score of blob.scores) {
        this.db.update(teams).set({ score: score.score }).where(eq(teams.id, score.id)).run();
      }
      this.db.update(questions).set({ usedAt: blob.usedAt }).where(eq(questions.id, round.questionId)).run();
    });
  }

  revealRest(): void {
    this.tx(() => {
      const round = this.mustActive();
      if (round.phase !== "roundEnd") throw new GameError(400, "Reveal the rest after the round ends");
      const revealed = new Set(this.revealRows(round.id).map((row) => row.answerId));
      const hidden = this.answerRows(round.questionId).filter((answer) => !revealed.has(answer.id));
      if (hidden.length === 0) return;
      this.captureUndo(round.id);
      for (const answer of hidden) {
        this.db
          .insert(roundReveals)
          .values({ id: nid(), roundId: round.id, answerId: answer.id, revealedAt: Date.now() })
          .run();
      }
    });
  }

  done(): void {
    this.tx(() => {
      const round = this.mustActive();
      if (round.phase !== "roundEnd") throw new GameError(400, "The round is still going");
      this.db.update(rounds).set({ active: 0 }).where(eq(rounds.id, round.id)).run();
    });
  }

  newGame(): void {
    this.tx(() => {
      this.db.update(games).set({ status: "ended" }).where(eq(games.status, "active")).run();
      this.db.insert(games).values({ id: nid(), status: "active", createdAt: Date.now() }).run();
      for (const team of this.teamRows()) {
        this.db.update(teams).set({ score: 0 }).where(eq(teams.id, team.id)).run();
      }
      this.db.update(rounds).set({ active: 0 }).where(eq(rounds.active, 1)).run();
    });
  }

  snapshot(viewer: { role: "host" } | { role: "display" } | { role: "player"; playerId: string }): Snapshot {
    const [teamA, teamB] = this.teamRows();
    const round = this.activeRound();
    const host = viewer.role === "host";
    const pointsRaw = this.setting("points_to_win").trim();
    const pointsToWin = pointsRaw === "" ? null : Number(pointsRaw);
    const playerList = this.playerRows().map((player) => ({
      id: player.id,
      name: player.name,
      teamId: player.teamId,
    }));

    let roundView: Snapshot["round"] = null;
    let buzzerOpen = false;
    let eligible: string[] = [];
    if (round) {
      const question = this.mustQuestion(round.questionId);
      const revealed = new Set(this.revealRows(round.id).map((row) => row.answerId));
      const sorted = this.answerRows(round.questionId).sort((a, b) => a.rank - b.rank);
      const rows: BoardRow[] = sorted.map((answer) => ({
        id: answer.id,
        rank: answer.rank,
        revealed: revealed.has(answer.id),
        text: revealed.has(answer.id) ? answer.text : null,
        points: revealed.has(answer.id) ? answer.points : null,
      }));
      const answerKey: BoardRow[] | null = host
        ? sorted.map((answer) => ({
            id: answer.id,
            rank: answer.rank,
            revealed: revealed.has(answer.id),
            text: answer.text,
            points: answer.points,
          }))
        : null;
      const window = round.buzzWindowId ? this.windowRow(round.buzzWindowId) : null;
      buzzerOpen = Boolean(window && window.open === 1 && round.phase === "faceoff");
      try {
        eligible = window ? (JSON.parse(window.eligibleJson) as string[]) : [];
      } catch {
        eligible = [];
      }
      const pending =
        host && round.pendingText
          ? {
              text: round.pendingText,
              ...matchAnswer(round.pendingText, this.candidates(round.questionId, round.id)),
            }
          : null;
      roundView = {
        id: round.id,
        phase: asPhase(round.phase),
        question: question.prompt,
        answers: rows,
        strikes: round.strikes,
        pot: round.pot,
        controllingTeamId: round.controllingTeamId,
        faceoffPlayerAId: round.faceoffPlayerA,
        faceoffPlayerBId: round.faceoffPlayerB,
        answeringPlayerId: round.answeringPlayerId,
        buzzWindowId: round.buzzWindowId,
        buzzerOpen,
        buzzWinnerId: round.buzzWinnerId,
        answerSubmitted: round.pendingText != null,
        canUndo: round.undoJson != null,
        stealTeamId: round.stealTeamId,
        awardedTeamId: round.awardedTeamId,
        faceoffMisses: round.faceoffMisses,
        pending,
        answerKey,
      };
    }

    const game = this.activeGame();
    const base = {
      game: {
        id: game.id,
        pointsToWin: Number.isInteger(pointsToWin) ? pointsToWin : null,
        roomCode: host ? this.setting("room_code") : null,
        teams: [
          { id: teamA.id, slot: asSlot(teamA.slot), name: teamA.name, color: teamA.color, score: teamA.score },
          { id: teamB.id, slot: asSlot(teamB.slot), name: teamB.name, color: teamB.color, score: teamB.score },
        ] as Snapshot["game"]["teams"],
      },
      players: playerList,
      round: roundView,
    };

    if (viewer.role === "player") {
      const player = this.mustPlayer(viewer.playerId);
      return {
        ...base,
        you: { role: "player", id: player.id, name: player.name, teamId: player.teamId },
        affordances: playerAffordances({
          hasTeam: Boolean(player.teamId),
          phase: roundView?.phase ?? null,
          buzzerOpen,
          eligible: eligible.includes(player.id),
          isControllingTeam: Boolean(player.teamId && player.teamId === round?.controllingTeamId),
          isStealTeam: Boolean(player.teamId && player.teamId === round?.stealTeamId),
          isAnswering: player.id === round?.answeringPlayerId,
        }),
      };
    }

    return {
      ...base,
      you: viewer.role === "host" ? { role: "host" } : { role: "display" },
      affordances: null,
    };
  }
}
