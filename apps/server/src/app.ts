import { existsSync } from "node:fs";
import path from "node:path";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import { SOCKET_BUZZ, SOCKET_STATE, type Snapshot } from "@feud/shared";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { Server } from "socket.io";
import { z, ZodError } from "zod";
import { passwordsMatch, readHostCookie } from "./auth.js";
import { openDatabase, seed } from "./db.js";
import { GameError, GameStore, type QuestionInput } from "./game.js";

export type AppConfig = {
  dbPath: string;
  hostPassword: string;
  roomCode: string;
  sessionSecret: string;
  secureCookie: boolean;
  logger: boolean;
};

const AnswerInput = z.object({
  text: z.string(),
  points: z.number().int(),
  rank: z.number().int(),
  aliases: z.array(z.string()).default([]),
});

const QuestionInputSchema = z.object({
  prompt: z.string(),
  answers: z.array(AnswerInput).min(1).max(8),
});

function findWebDist(): string | null {
  const candidates = [
    path.resolve(process.cwd(), "apps/web/dist"),
    path.resolve(process.cwd(), "../../apps/web/dist"),
  ];
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, "index.html"))) return candidate;
  }
  return null;
}

function header(req: FastifyRequest, name: string): string {
  const value = req.headers[name];
  return typeof value === "string" ? value : "";
}

export async function createApp(config: AppConfig): Promise<{
  app: FastifyInstance;
  io: Server;
  game: GameStore;
  close: () => Promise<void>;
}> {
  const { sqlite, db } = openDatabase(config.dbPath);
  seed(db, config.roomCode);
  const game = new GameStore(sqlite, db);
  const app = Fastify({ logger: config.logger });
  await app.register(cookie, { secret: config.sessionSecret });

  const io = new Server(app.server, {
    cors: { origin: true, credentials: true },
  });

  function isHost(req: FastifyRequest): boolean {
    return readHostCookie(req.headers.cookie, config.sessionSecret);
  }

  function requireHost(req: FastifyRequest): void {
    if (!isHost(req)) throw new GameError(401, "Host login required");
  }

  function snapshotFor(req: FastifyRequest): Snapshot {
    if (isHost(req)) return game.snapshot({ role: "host" });
    const playerToken = header(req, "x-player-token");
    if (playerToken) {
      const player = game.playerByToken(playerToken);
      if (!player) throw new GameError(401, "Join again");
      return game.snapshot({ role: "player", playerId: player.id });
    }
    const displayToken = header(req, "x-display-token");
    if (displayToken && game.displayValid(displayToken)) return game.snapshot({ role: "display" });
    throw new GameError(401, "Sign in required");
  }

  function snapshotForSocket(socket: { data: { role?: string; playerId?: string } }): Snapshot {
    if (socket.data.role === "host") return game.snapshot({ role: "host" });
    if (socket.data.role === "player" && socket.data.playerId) {
      return game.snapshot({ role: "player", playerId: socket.data.playerId });
    }
    return game.snapshot({ role: "display" });
  }

  function broadcast(): void {
    for (const socket of io.sockets.sockets.values()) {
      socket.emit(SOCKET_STATE, snapshotForSocket(socket));
    }
  }

  app.setErrorHandler((error, req, reply) => {
    if (error instanceof GameError) {
      reply.code(error.status).send({ error: error.message });
      return;
    }
    if (error instanceof ZodError) {
      reply.code(400).send({ error: "Invalid request" });
      return;
    }
    req.log.error(error);
    reply.code(500).send({ error: "Something went wrong" });
  });

  app.get("/health", async () => ({ ok: true }));

  app.post("/api/join", async (req, reply) => {
    const body = z.object({ roomCode: z.string(), name: z.string() }).parse(req.body);
    const result = game.join(body.roomCode, body.name);
    broadcast();
    return reply.send(result);
  });

  app.get("/api/me", async (req) => {
    const player = game.playerByToken(header(req, "x-player-token"));
    if (!player) throw new GameError(401, "Join again");
    return { player: { id: player.id, name: player.name, teamId: player.teamId } };
  });

  app.post("/api/display/join", async (req) => {
    const body = z.object({ roomCode: z.string() }).parse(req.body);
    return game.createDisplayToken(body.roomCode);
  });

  app.get("/api/state", async (req) => snapshotFor(req));
  app.get("/api/session", async (req) => ({ host: isHost(req) }));

  app.post("/api/host/login", async (req, reply) => {
    const body = z.object({ password: z.string() }).parse(req.body);
    if (!passwordsMatch(body.password, config.hostPassword)) {
      return reply.code(401).send({ error: "Wrong password" });
    }
    reply.setCookie("host_session", "ok", {
      signed: true,
      httpOnly: true,
      secure: config.secureCookie,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 14,
    });
    return reply.send({ ok: true });
  });

  app.post("/api/host/logout", async (_req, reply) => {
    reply.clearCookie("host_session", { path: "/" });
    return reply.send({ ok: true });
  });

  app.patch("/api/host/settings", async (req) => {
    requireHost(req);
    const body = z
      .object({
        roomCode: z.string().optional(),
        pointsToWin: z.number().int().nullable().optional(),
      })
      .parse(req.body);
    game.updateSettings(body);
    broadcast();
    return { ok: true };
  });

  app.put("/api/host/teams/:slot", async (req) => {
    requireHost(req);
    const params = z.object({ slot: z.enum(["1", "2"]) }).parse(req.params);
    const body = z.object({ name: z.string(), color: z.string() }).parse(req.body);
    game.updateTeam(params.slot === "1" ? 1 : 2, body.name, body.color);
    broadcast();
    return { ok: true };
  });

  app.post("/api/host/players/:id/assign", async (req) => {
    requireHost(req);
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    const body = z.object({ teamId: z.string().nullable() }).parse(req.body);
    game.assignPlayer(params.id, body.teamId);
    broadcast();
    return { ok: true };
  });

  app.post("/api/host/players/:id/rename", async (req) => {
    requireHost(req);
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    const body = z.object({ name: z.string() }).parse(req.body);
    game.renamePlayer(params.id, body.name);
    broadcast();
    return { ok: true };
  });

  app.delete("/api/host/players/:id", async (req) => {
    requireHost(req);
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    game.removePlayer(params.id);
    broadcast();
    return { ok: true };
  });

  app.get("/api/host/questions", async (req) => {
    requireHost(req);
    const query = z
      .object({
        q: z.string().optional(),
        used: z.enum(["all", "used", "unused"]).optional(),
      })
      .parse(req.query);
    return game.listQuestions(query);
  });

  app.post("/api/host/questions", async (req, reply) => {
    requireHost(req);
    const body = QuestionInputSchema.parse(req.body) as QuestionInput;
    const created = game.createQuestion(body);
    broadcast();
    return reply.code(201).send(created);
  });

  app.put("/api/host/questions/:id", async (req) => {
    requireHost(req);
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    const body = QuestionInputSchema.parse(req.body) as QuestionInput;
    const updated = game.updateQuestion(params.id, body);
    broadcast();
    return updated;
  });

  app.delete("/api/host/questions/:id", async (req) => {
    requireHost(req);
    const params = z.object({ id: z.string().min(1) }).parse(req.params);
    game.deleteQuestion(params.id);
    broadcast();
    return { ok: true };
  });

  app.post("/api/host/questions/reorder", async (req) => {
    requireHost(req);
    const body = z.object({ ids: z.array(z.string().min(1)) }).parse(req.body);
    game.reorderQuestions(body.ids);
    broadcast();
    return { ok: true };
  });

  app.post("/api/host/round/start", async (req) => {
    requireHost(req);
    const body = z
      .object({
        questionId: z.string().min(1),
        faceoffPlayerAId: z.string().min(1),
        faceoffPlayerBId: z.string().min(1),
      })
      .parse(req.body);
    game.startFaceoff(body);
    broadcast();
    return { ok: true };
  });

  app.post("/api/host/round/buzzers", async (req) => {
    requireHost(req);
    const body = z.object({ open: z.boolean() }).parse(req.body);
    game.setBuzzers(body.open);
    broadcast();
    return { ok: true };
  });

  app.post("/api/host/round/answer", async (req) => {
    requireHost(req);
    const body = z.object({ text: z.string() }).parse(req.body);
    game.submitAnswer(body.text, { host: true });
    broadcast();
    return { ok: true };
  });

  app.post("/api/host/round/accept", async (req) => {
    requireHost(req);
    const body = z.object({ answerId: z.string().min(1) }).parse(req.body);
    game.acceptAnswer(body.answerId);
    broadcast();
    return { ok: true };
  });

  app.post("/api/host/round/reject", async (req) => {
    requireHost(req);
    game.rejectAnswer();
    broadcast();
    return { ok: true };
  });

  app.post("/api/host/round/strike", async (req) => {
    requireHost(req);
    game.strike();
    broadcast();
    return { ok: true };
  });

  app.post("/api/host/round/choice", async (req) => {
    requireHost(req);
    const body = z.object({ choice: z.enum(["play", "pass"]) }).parse(req.body);
    game.choose(body.choice);
    broadcast();
    return { ok: true };
  });

  app.post("/api/host/round/answerer", async (req) => {
    requireHost(req);
    const body = z.object({ playerId: z.string().min(1) }).parse(req.body);
    game.setAnswerer(body.playerId);
    broadcast();
    return { ok: true };
  });

  app.post("/api/host/round/undo", async (req) => {
    requireHost(req);
    game.undo();
    broadcast();
    return { ok: true };
  });

  app.post("/api/host/round/reveal-rest", async (req) => {
    requireHost(req);
    game.revealRest();
    broadcast();
    return { ok: true };
  });

  app.post("/api/host/round/done", async (req) => {
    requireHost(req);
    game.done();
    broadcast();
    return { ok: true };
  });

  app.post("/api/host/new-game", async (req) => {
    requireHost(req);
    game.newGame();
    broadcast();
    return { ok: true };
  });

  app.post("/api/play/answer", async (req) => {
    const player = game.playerByToken(header(req, "x-player-token"));
    if (!player) throw new GameError(401, "Join again");
    const body = z.object({ text: z.string() }).parse(req.body);
    game.submitAnswer(body.text, { host: false, playerId: player.id });
    broadcast();
    return { ok: true };
  });

  io.use((socket, next) => {
    const auth = socket.handshake.auth as { role?: string; token?: string };
    if (auth.role === "host") {
      if (!readHostCookie(socket.handshake.headers.cookie, config.sessionSecret)) {
        next(new Error("unauthorized"));
        return;
      }
      socket.data.role = "host";
      next();
      return;
    }
    if (auth.role === "player") {
      const player = game.playerByToken(auth.token ?? "");
      if (!player) {
        next(new Error("unauthorized"));
        return;
      }
      socket.data.role = "player";
      socket.data.playerId = player.id;
      next();
      return;
    }
    if (auth.role === "display") {
      if (!game.displayValid(auth.token ?? "")) {
        next(new Error("unauthorized"));
        return;
      }
      socket.data.role = "display";
      next();
      return;
    }
    next(new Error("unauthorized"));
  });

  io.on("connection", (socket) => {
    socket.emit(SOCKET_STATE, snapshotForSocket(socket));
    socket.on(SOCKET_BUZZ, (payload: unknown, ack?: (result: { won: boolean }) => void) => {
      const windowId =
        typeof payload === "object" && payload && "windowId" in payload
          ? String((payload as { windowId: unknown }).windowId)
          : "";
      const playerId = socket.data.playerId as string | undefined;
      if (!playerId) {
        if (typeof ack === "function") ack({ won: false });
        return;
      }
      try {
        const result = game.buzz(playerId, windowId);
        if (result.won) broadcast();
        if (typeof ack === "function") ack(result);
      } catch {
        if (typeof ack === "function") ack({ won: false });
      }
    });
  });

  const dist = findWebDist();
  if (dist) {
    await app.register(fastifyStatic, { root: dist });
    app.setNotFoundHandler((req, reply) => {
      const url = req.raw.url ?? "";
      if (url.startsWith("/api") || url.startsWith("/socket.io") || url.startsWith("/health")) {
        reply.code(404).send({ error: "Not found" });
        return;
      }
      reply.sendFile("index.html");
    });
  }

  return {
    app,
    io,
    game,
    close: async () => {
      await io.close();
      await app.close();
      sqlite.close();
    },
  };
}
