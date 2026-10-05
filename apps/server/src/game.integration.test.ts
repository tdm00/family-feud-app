import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Snapshot } from "@feud/shared";
import { SOCKET_BUZZ } from "@feud/shared";
import { io, type Socket } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";

const password = "test-host";
const roomCode = "TEST";

async function boot(dbPath: string) {
  const created = await createApp({
    dbPath,
    hostPassword: password,
    roomCode,
    sessionSecret: "test-secret-test-secret",
    secureCookie: false,
    logger: false,
  });
  await created.app.listen({ port: 0, host: "127.0.0.1" });
  const address = created.app.server.address() as AddressInfo;
  return { ...created, base: `http://127.0.0.1:${address.port}` };
}

function cookieHeader(res: Response): string {
  return res.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

describe("game api", () => {
  let closeServer: (() => Promise<void>) | null = null;
  const sockets: Socket[] = [];

  function stopSockets(): void {
    for (const socket of sockets) socket.close();
    sockets.length = 0;
  }

  afterEach(async () => {
    stopSockets();
    if (closeServer) await closeServer();
    closeServer = null;
  });

  async function start(dbPath: string) {
    stopSockets();
    if (closeServer) await closeServer();
    const server = await boot(dbPath);
    closeServer = server.close;
    return server;
  }

  it("rejects a bad room code and a duplicate name", async () => {
    const dbPath = path.join(mkdtempSync(path.join(tmpdir(), "feud-")), "game.sqlite");
    const server = await start(dbPath);
    const health = await fetch(`${server.base}/health`);
    expect(health.status).toBe(200);

    const wrong = await fetch(`${server.base}/api/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ roomCode: "NOPE", name: "Ada" }),
    });
    expect(wrong.status).toBe(401);

    const joined = await fetch(`${server.base}/api/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ roomCode: "test", name: "Ada" }),
    });
    expect(joined.status).toBe(200);
    const again = await fetch(`${server.base}/api/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ roomCode: "TEST", name: "ada" }),
    });
    expect(again.status).toBe(409);

    const badHost = await fetch(`${server.base}/api/host/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "nope" }),
    });
    expect(badHost.status).toBe(401);
  });

  it("plays a round, survives a restart, and clears only the live game", async () => {
    const dbPath = path.join(mkdtempSync(path.join(tmpdir(), "feud-")), "game.sqlite");
    const first = await start(dbPath);

    const login = await fetch(`${first.base}/api/host/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const hostCookie = cookieHeader(login);
    expect(login.status).toBe(200);

    const host = (pathName: string, init?: RequestInit) =>
      fetch(`${first.base}${pathName}`, {
        ...init,
        headers: {
          "content-type": "application/json",
          cookie: hostCookie,
          ...(init?.headers ?? {}),
        },
      });

    const join = async (name: string) => {
      const res = await fetch(`${first.base}/api/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roomCode, name }),
      });
      expect(res.status).toBe(200);
      return json<{ token: string; player: { id: string; name: string } }>(res);
    };

    const alice = await join("Alice");
    const bob = await join("Bob");
    const charlie = await join("Charlie");
    const stateBefore = await json<Snapshot>(await host("/api/state"));
    const [teamA, teamB] = stateBefore.game.teams;

    expect((await host(`/api/host/players/${alice.player.id}/assign`, { method: "POST", body: JSON.stringify({ teamId: teamA.id }) })).status).toBe(200);
    expect((await host(`/api/host/players/${bob.player.id}/assign`, { method: "POST", body: JSON.stringify({ teamId: teamB.id }) })).status).toBe(200);
    expect((await host(`/api/host/players/${charlie.player.id}/assign`, { method: "POST", body: JSON.stringify({ teamId: teamA.id }) })).status).toBe(200);

    const created = await host("/api/host/questions", {
      method: "POST",
      body: JSON.stringify({
        prompt: "Name a color",
        answers: [
          { text: "Red", points: 40, rank: 1, aliases: ["Scarlet"] },
          { text: "Blue", points: 20, rank: 2, aliases: [] },
          { text: "Green", points: 10, rank: 3, aliases: [] },
        ],
      }),
    });
    expect(created.status).toBe(201);
    const question = await json<{ id: string; answers: { id: string; text: string }[] }>(created);
    const red = question.answers.find((answer) => answer.text === "Red");
    const green = question.answers.find((answer) => answer.text === "Green");
    expect(red && green).toBeTruthy();

    expect(
      (
        await host("/api/host/round/start", {
          method: "POST",
          body: JSON.stringify({
            questionId: question.id,
            faceoffPlayerAId: alice.player.id,
            faceoffPlayerBId: bob.player.id,
          }),
        })
      ).status,
    ).toBe(200);

    const connect = (auth: { role: string; token?: string }, cookie?: string) =>
      new Promise<Socket>((resolve, reject) => {
        const socket = io(first.base, {
          auth,
          extraHeaders: cookie ? { cookie } : undefined,
          transports: ["websocket"],
        });
        socket.once("connect", () => resolve(socket));
        socket.once("connect_error", (error) => reject(error));
      });

    const aliceSocket = await connect({ role: "player", token: alice.token });
    const bobSocket = await connect({ role: "player", token: bob.token });
    const charlieSocket = await connect({ role: "player", token: charlie.token });
    sockets.push(aliceSocket, bobSocket, charlieSocket);

    const opened = await json<Snapshot>(await host("/api/state"));
    const windowId = opened.round?.buzzWindowId ?? "";
    expect(opened.round?.buzzerOpen).toBe(true);

    const buzz = (socket: Socket) =>
      new Promise<{ won: boolean }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("buzz timeout")), 3000);
        socket.emit(SOCKET_BUZZ, { windowId }, (result: { won: boolean }) => {
          clearTimeout(timer);
          resolve(result);
        });
      });

    const charlieBuzz = await buzz(charlieSocket);
    expect(charlieBuzz.won).toBe(false);
    expect((await json<Snapshot>(await host("/api/state"))).round?.phase).toBe("faceoff");

    const [aliceBuzz, bobBuzz] = await Promise.all([buzz(aliceSocket), buzz(bobSocket)]);
    expect([aliceBuzz.won, bobBuzz.won].filter(Boolean)).toHaveLength(1);

    const afterBuzz = await json<Snapshot>(await host("/api/state"));
    const winnerId = afterBuzz.round?.buzzWinnerId;
    expect([alice.player.id, bob.player.id]).toContain(winnerId);
    expect(winnerId).not.toBe(charlie.player.id);
    const winner = winnerId === alice.player.id ? alice : bob;
    const loser = winnerId === alice.player.id ? bob : alice;

    const hidden = await fetch(`${first.base}/api/state`, { headers: { "x-player-token": alice.token } });
    const hiddenState = await json<Snapshot>(hidden);
    expect(hiddenState.round?.answers.every((row) => row.text == null)).toBe(true);
    expect(hiddenState.round?.answerKey).toBeNull();

    const submitted = await fetch(`${first.base}/api/play/answer`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-player-token": winner.token },
      body: JSON.stringify({ text: "scarlet" }),
    });
    expect(submitted.status).toBe(200);
    const pending = await json<Snapshot>(await host("/api/state"));
    expect(pending.round?.pending?.exactAnswerId).toBe(red?.id);
    expect(pending.round?.pending?.duplicate).toBe(false);

    expect((await host("/api/host/round/accept", { method: "POST", body: JSON.stringify({ answerId: red?.id }) })).status).toBe(200);
    const revealed = await json<Snapshot>(await host("/api/state"));
    expect(revealed.round?.pot).toBe(40);
    expect(revealed.round?.phase).toBe("faceoffChoice");
    expect(revealed.round?.answers.find((row) => row.rank === 1)?.text).toBe("Red");

    const playerView = await json<Snapshot>(await fetch(`${first.base}/api/state`, { headers: { "x-player-token": alice.token } }));
    expect(playerView.round?.answers.find((row) => row.rank === 1)?.text).toBe("Red");
    expect(playerView.round?.answers.find((row) => row.rank === 2)?.text).toBeNull();

    expect((await host("/api/host/round/undo", { method: "POST", body: "{}" })).status).toBe(200);
    const undone = await json<Snapshot>(await host("/api/state"));
    expect(undone.round?.pot).toBe(0);
    expect(undone.round?.answers.every((row) => !row.revealed)).toBe(true);

    expect((await host("/api/host/round/accept", { method: "POST", body: JSON.stringify({ answerId: red?.id }) })).status).toBe(200);
    expect((await host("/api/host/round/choice", { method: "POST", body: JSON.stringify({ choice: "play" }) })).status).toBe(200);
    expect((await host("/api/host/round/strike", { method: "POST", body: "{}" })).status).toBe(200);
    expect((await host("/api/host/round/strike", { method: "POST", body: "{}" })).status).toBe(200);
    const third = await host("/api/host/round/strike", { method: "POST", body: "{}" });
    expect(third.status).toBe(200);
    const stealing = await json<Snapshot>(await host("/api/state"));
    expect(stealing.round?.phase).toBe("steal");
    expect(stealing.round?.strikes).toBe(3);
    const loserTeam = loser.player.id === alice.player.id ? teamA.id : teamB.id;
    expect(stealing.round?.stealTeamId).toBe(loserTeam);

    expect((await host("/api/host/round/answerer", { method: "POST", body: JSON.stringify({ playerId: loser.player.id }) })).status).toBe(200);
    expect(
      (
        await fetch(`${first.base}/api/play/answer`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-player-token": loser.token },
          body: JSON.stringify({ text: "Green" }),
        })
      ).status,
    ).toBe(200);
    expect((await host("/api/host/round/accept", { method: "POST", body: JSON.stringify({ answerId: green?.id }) })).status).toBe(200);

    const scored = await json<Snapshot>(await host("/api/state"));
    expect(scored.round?.phase).toBe("roundEnd");
    expect(scored.round?.pot).toBe(50);
    const stealingTeam = scored.game.teams.find((team) => team.id === loserTeam);
    const buildingTeam = scored.game.teams.find((team) => team.id !== loserTeam);
    expect(stealingTeam?.score).toBe(50);
    expect(buildingTeam?.score).toBe(0);

    const second = await start(dbPath);
    const relogin = await fetch(`${second.base}/api/host/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const secondCookie = cookieHeader(relogin);
    const host2 = (pathName: string, init?: RequestInit) =>
      fetch(`${second.base}${pathName}`, {
        ...init,
        headers: { "content-type": "application/json", cookie: secondCookie, ...(init?.headers ?? {}) },
      });
    const restored = await json<Snapshot>(await host2("/api/state"));
    expect(restored.round?.phase).toBe("roundEnd");
    expect(restored.round?.pot).toBe(50);
    expect(restored.game.teams.find((team) => team.id === loserTeam)?.score).toBe(50);
    expect(restored.players.map((player) => player.name).sort()).toEqual(["Alice", "Bob", "Charlie"]);

    const extra = await host2("/api/host/questions", {
      method: "POST",
      body: JSON.stringify({
        prompt: "Name a pet",
        answers: [{ text: "Dog", points: 30, rank: 1, aliases: ["Puppy"] }],
      }),
    });
    const extraBody = await json<{ id: string }>(extra);
    const edited = await host2(`/api/host/questions/${extraBody.id}`, {
      method: "PUT",
      body: JSON.stringify({
        prompt: "Name a common pet",
        answers: [{ text: "Dog", points: 30, rank: 1, aliases: ["Puppy"] }],
      }),
    });
    expect(edited.status).toBe(200);

    const thirdServer = await start(dbPath);
    const relogin3 = await fetch(`${thirdServer.base}/api/host/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const thirdCookie = cookieHeader(relogin3);
    const host3 = (pathName: string, init?: RequestInit) =>
      fetch(`${thirdServer.base}${pathName}`, {
        ...init,
        headers: { "content-type": "application/json", cookie: thirdCookie, ...(init?.headers ?? {}) },
      });
    const questions = await json<{ prompt: string; usedAt: number | null }[]>(await host3("/api/host/questions"));
    expect(questions.some((questionRow) => questionRow.prompt === "Name a common pet")).toBe(true);
    expect(questions.find((questionRow) => questionRow.prompt === "Name a color")?.usedAt).not.toBeNull();

    expect((await host3("/api/host/new-game", { method: "POST", body: "{}" })).status).toBe(200);
    const cleared = await json<Snapshot>(await host3("/api/state"));
    expect(cleared.round).toBeNull();
    expect(cleared.game.teams.every((team) => team.score === 0)).toBe(true);
    expect(cleared.players).toHaveLength(3);
    const afterReset = await json<{ prompt: string }[]>(await host3("/api/host/questions"));
    expect(afterReset.map((questionRow) => questionRow.prompt).sort()).toEqual(["Name a color", "Name a common pet"]);
  });
});
