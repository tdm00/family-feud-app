import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { Snapshot } from "@feud/shared";
import { api } from "../api.js";
import { Board } from "../components/Board.js";
import { useRoundSounds } from "../sounds.js";
import { useLiveState } from "../useGame.js";

type Question = {
  id: string;
  prompt: string;
  usedAt: number | null;
};

export function HostPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { snapshot } = useLiveState({ role: "host", enabled: authed === true });
  useRoundSounds(snapshot?.round ?? null, "show");

  useEffect(() => {
    api<{ host: boolean }>("/api/session")
      .then((session) => setAuthed(session.host))
      .catch(() => setAuthed(false));
  }, []);

  async function login(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await api("/api/host/login", { body: { password } });
      setAuthed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not log in");
    }
  }

  if (authed === null) return <main className="grid min-h-dvh place-items-center">Checking the host session…</main>;
  if (!authed) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5">
        <h1 className="font-display text-5xl uppercase text-gold">Host</h1>
        <form className="mt-6 grid gap-3" onSubmit={login}>
          <input
            data-testid="host-password"
            type="password"
            className="min-h-14 rounded-xl border border-white/15 bg-white/10 px-4 text-xl"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Password"
          />
          {error ? <p className="text-red-300">{error}</p> : null}
          <button data-testid="host-login" className="min-h-14 rounded-xl bg-gold font-semibold text-ink">
            Unlock
          </button>
        </form>
      </main>
    );
  }

  if (!snapshot) return <main className="grid min-h-dvh place-items-center">Connecting the board…</main>;

  return (
    <main className="min-h-dvh">
      <HostBar snapshot={snapshot} onError={setError} />
      {error ? <p className="px-4 text-red-300">{error}</p> : null}
      {snapshot.round ? (
        <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1.5fr)_380px]">
          <Board snapshot={snapshot} />
          <RoundControls snapshot={snapshot} onError={setError} />
        </div>
      ) : (
        <Lobby snapshot={snapshot} onError={setError} />
      )}
    </main>
  );
}

function HostBar({ snapshot, onError }: { snapshot: Snapshot; onError: (message: string | null) => void }) {
  const [points, setPoints] = useState(snapshot.game.pointsToWin?.toString() ?? "");
  const [roomCode, setRoomCode] = useState(snapshot.game.roomCode ?? "");

  useEffect(() => {
    setPoints(snapshot.game.pointsToWin?.toString() ?? "");
    setRoomCode(snapshot.game.roomCode ?? "");
  }, [snapshot.game.pointsToWin, snapshot.game.roomCode]);

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    try {
      await api("/api/host/settings", {
        method: "PATCH",
        body: {
          roomCode,
          pointsToWin: points.trim() === "" ? null : Number(points),
        },
      });
      onError(null);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not save settings");
    }
  }

  async function newGame() {
    if (!window.confirm("Start a new game? Scores and the live round will clear.")) return;
    try {
      await api("/api/host/new-game", { body: {} });
      onError(null);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not start a new game");
    }
  }

  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
      <div>
        <p className="font-display text-3xl uppercase text-gold">Host</p>
        <nav className="flex gap-3 text-sm text-white/70">
          <Link to="/admin">Questions</Link>
          <Link to="/display">Display</Link>
        </nav>
      </div>
      <form className="flex flex-wrap items-end gap-2" onSubmit={saveSettings}>
        <label className="grid text-xs uppercase tracking-widest text-white/60">
          Room
          <input className="min-h-11 w-28 rounded-lg bg-white/10 px-2 text-base" value={roomCode} onChange={(event) => setRoomCode(event.target.value)} />
        </label>
        <label className="grid text-xs uppercase tracking-widest text-white/60">
          Points to win
          <input className="min-h-11 w-28 rounded-lg bg-white/10 px-2 text-base" value={points} onChange={(event) => setPoints(event.target.value)} inputMode="numeric" />
        </label>
        <button className="min-h-11 rounded-lg bg-white/10 px-3">Save</button>
      </form>
      <button data-testid="new-game" className="min-h-11 rounded-lg bg-white/10 px-3" type="button" onClick={() => void newGame()}>
        New game
      </button>
    </header>
  );
}

function Lobby({ snapshot, onError }: { snapshot: Snapshot; onError: (message: string | null) => void }) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [questionId, setQuestionId] = useState("");
  const [faceA, setFaceA] = useState("");
  const [faceB, setFaceB] = useState("");
  const [teamA, teamB] = snapshot.game.teams;

  useEffect(() => {
    api<Question[]>("/api/host/questions")
      .then(setQuestions)
      .catch((err: unknown) => onError(err instanceof Error ? err.message : "Could not load questions"));
  }, [onError, snapshot.round]);

  async function run(fn: () => Promise<unknown>) {
    try {
      await fn();
      onError(null);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  return (
    <div className="grid gap-6 p-4 lg:grid-cols-2">
      <section className="grid gap-4">
        <h2 className="font-display text-3xl uppercase">Teams</h2>
        {snapshot.game.teams.map((team) => (
          <TeamEditor key={team.id} team={team} onError={onError} />
        ))}
        <h2 className="font-display text-3xl uppercase">Players</h2>
        <ul className="grid gap-2">
          {snapshot.players.map((player) => (
            <li key={player.id} data-testid={`player-${player.name}`} className="flex flex-wrap items-center gap-2 rounded-xl bg-white/5 p-3">
              <span className="min-w-24 text-lg">{player.name}</span>
              <select
                data-testid={`assign-${player.name}`}
                className="min-h-11 rounded-lg bg-ink px-2"
                value={player.teamId ?? ""}
                onChange={(event) =>
                  void run(() =>
                    api(`/api/host/players/${player.id}/assign`, {
                      body: { teamId: event.target.value || null },
                    }),
                  )
                }
              >
                <option value="">Unassigned</option>
                {snapshot.game.teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
              <button
                className="min-h-11 rounded-lg px-3 text-white/70"
                type="button"
                onClick={() => {
                  const name = window.prompt("New name", player.name);
                  if (!name) return;
                  void run(() => api(`/api/host/players/${player.id}/rename`, { body: { name } }));
                }}
              >
                Rename
              </button>
              <button
                className="min-h-11 rounded-lg px-3 text-white/70"
                type="button"
                onClick={() => void run(() => api(`/api/host/players/${player.id}`, { method: "DELETE" }))}
              >
                Remove
              </button>
            </li>
          ))}
          {snapshot.players.length === 0 ? <li className="text-white/60">Nobody has joined yet.</li> : null}
        </ul>
      </section>
      <section className="grid content-start gap-3">
        <h2 className="font-display text-3xl uppercase">Face-off</h2>
        <select data-testid="question-select" className="min-h-12 rounded-xl bg-white/10 px-3" value={questionId} onChange={(event) => setQuestionId(event.target.value)}>
          <option value="">Choose a question</option>
          <optgroup label="Ready">
            {questions
              .filter((question) => !question.usedAt)
              .map((question) => (
                <option key={question.id} value={question.id}>
                  {question.prompt}
                </option>
              ))}
          </optgroup>
          <optgroup label="Used">
            {questions
              .filter((question) => question.usedAt)
              .map((question) => (
                <option key={question.id} value={question.id}>
                  {question.prompt}
                </option>
              ))}
          </optgroup>
        </select>
        <select data-testid="faceoff-1" className="min-h-12 rounded-xl bg-white/10 px-3" value={faceA} onChange={(event) => setFaceA(event.target.value)}>
          <option value="">{teamA.name} player</option>
          {snapshot.players
            .filter((player) => player.teamId === teamA.id)
            .map((player) => (
              <option key={player.id} value={player.id}>
                {player.name}
              </option>
            ))}
        </select>
        <select data-testid="faceoff-2" className="min-h-12 rounded-xl bg-white/10 px-3" value={faceB} onChange={(event) => setFaceB(event.target.value)}>
          <option value="">{teamB.name} player</option>
          {snapshot.players
            .filter((player) => player.teamId === teamB.id)
            .map((player) => (
              <option key={player.id} value={player.id}>
                {player.name}
              </option>
            ))}
        </select>
        <button
          data-testid="start-faceoff"
          className="min-h-14 rounded-xl bg-gold text-xl font-semibold text-ink disabled:opacity-40"
          disabled={!questionId || !faceA || !faceB}
          type="button"
          onClick={() =>
            void run(() =>
              api("/api/host/round/start", {
                body: { questionId, faceoffPlayerAId: faceA, faceoffPlayerBId: faceB },
              }),
            )
          }
        >
          Start face-off
        </button>
      </section>
    </div>
  );
}

function TeamEditor({ team, onError }: { team: Snapshot["game"]["teams"][number]; onError: (message: string | null) => void }) {
  const [name, setName] = useState(team.name);
  const [color, setColor] = useState(team.color);
  useEffect(() => {
    setName(team.name);
    setColor(team.color);
  }, [team.name, team.color]);

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        api(`/api/host/teams/${team.slot}`, { method: "PUT", body: { name, color } })
          .then(() => onError(null))
          .catch((err: unknown) => onError(err instanceof Error ? err.message : "Could not save the team"));
      }}
    >
      <input data-testid={`team-name-${team.slot}`} className="min-h-11 flex-1 rounded-lg bg-white/10 px-3" value={name} onChange={(event) => setName(event.target.value)} />
      <input type="color" aria-label={`${team.name} color`} className="h-11 w-14 bg-transparent" value={color} onChange={(event) => setColor(event.target.value)} />
      <button className="min-h-11 rounded-lg bg-white/10 px-3">Save</button>
    </form>
  );
}

function RoundControls({ snapshot, onError }: { snapshot: Snapshot; onError: (message: string | null) => void }) {
  const round = snapshot.round;
  const [text, setText] = useState("");
  if (!round) return null;
  const pending = round.pending;
  const acceptId =
    pending?.exactAnswerId && !pending.duplicate
      ? pending.exactAnswerId
      : pending?.suggestion && !pending.suggestion.revealed
        ? pending.suggestion.answerId
        : null;
  const controlling = snapshot.game.teams.find((team) => team.id === round.controllingTeamId);
  const stealing = snapshot.game.teams.find((team) => team.id === round.stealTeamId);
  const answerPool =
    round.phase === "steal"
      ? snapshot.players.filter((player) => player.teamId === round.stealTeamId)
      : snapshot.players.filter((player) => player.teamId === round.controllingTeamId);

  async function run(fn: () => Promise<unknown>) {
    try {
      await fn();
      onError(null);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  return (
    <aside className="grid content-start gap-3 lg:max-h-[calc(100dvh-5.5rem)] lg:overflow-auto">
      <p className="font-display text-2xl uppercase text-gold">{phaseLabel(round.phase)}</p>
      {controlling ? <p>{controlling.name} has control</p> : null}
      {round.phase === "faceoff" && round.faceoffMisses >= 2 ? <p>Both missed. Open the buzzers to try again.</p> : null}
      {round.phase === "faceoff" ? (
        <button
          className="min-h-12 rounded-xl bg-white/10"
          type="button"
          onClick={() => void run(() => api("/api/host/round/buzzers", { body: { open: !round.buzzerOpen } }))}
        >
          {round.buzzerOpen ? "Close buzzers" : "Open buzzers"}
        </button>
      ) : null}

      {pending ? (
        <div className="rounded-2xl bg-white/10 p-3">
          <p data-testid="pending-text">They said: {pending.text}</p>
          {pending.duplicate ? <p>That answer is already on the board.</p> : null}
          {pending.suggestion ? (
            <p>
              Possible match: {pending.suggestion.text} ({pending.suggestion.distance})
            </p>
          ) : null}
          {acceptId ? (
            <button
              data-testid="accept-answer"
              className="mt-2 min-h-12 w-full rounded-xl bg-gold font-semibold text-ink"
              type="button"
              onClick={() => void run(() => api("/api/host/round/accept", { body: { answerId: acceptId } }))}
            >
              Accept match
            </button>
          ) : null}
          <button
            data-testid="reject-answer"
            className="mt-2 min-h-12 w-full rounded-xl bg-red-700"
            type="button"
            onClick={() => void run(() => api("/api/host/round/reject", { body: {} }))}
          >
            Reject
          </button>
          <div className="mt-2 grid gap-1">
            {round.answerKey
              ?.filter((row) => !row.revealed)
              .map((row) => (
                <button
                  key={row.id}
                  className="min-h-11 rounded-lg bg-ink px-2 text-left"
                  type="button"
                  onClick={() => void run(() => api("/api/host/round/accept", { body: { answerId: row.id } }))}
                >
                  Force {row.text} ({row.points})
                </button>
              ))}
          </div>
        </div>
      ) : null}

      {round.phase === "faceoffChoice" ? (
        <div className="grid grid-cols-2 gap-2">
          <button data-testid="choice-play" className="min-h-14 rounded-xl bg-gold font-semibold text-ink" type="button" onClick={() => void run(() => api("/api/host/round/choice", { body: { choice: "play" } }))}>
            Play
          </button>
          <button data-testid="choice-pass" className="min-h-14 rounded-xl bg-white/10" type="button" onClick={() => void run(() => api("/api/host/round/choice", { body: { choice: "pass" } }))}>
            Pass
          </button>
        </div>
      ) : null}

      {round.phase === "play" || round.phase === "steal" || round.phase === "faceoffAnswer" ? (
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const value = text;
            setText("");
            void run(() => api("/api/host/round/answer", { body: { text: value } }));
          }}
        >
          {(round.phase === "play" || round.phase === "steal") && (
            <select
              className="min-h-12 rounded-xl bg-white/10 px-3"
              value={round.answeringPlayerId ?? ""}
              onChange={(event) => {
                if (!event.target.value) return;
                void run(() => api("/api/host/round/answerer", { body: { playerId: event.target.value } }));
              }}
            >
              <option value="">{round.phase === "steal" ? `Steal for ${stealing?.name ?? "the other team"}` : "Whose phone can answer?"}</option>
              {answerPool.map((player) => (
                <option key={player.id} value={player.id}>
                  {player.name}
                </option>
              ))}
            </select>
          )}
          <input
            data-testid="host-answer"
            className="min-h-12 rounded-xl bg-white px-3 text-ink"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Type an answer"
          />
          <button data-testid="host-answer-submit" className="min-h-12 rounded-xl bg-white/10">
            Submit answer
          </button>
        </form>
      ) : null}

      {round.phase === "play" ? (
        <button data-testid="strike" className="min-h-12 rounded-xl bg-red-700" type="button" onClick={() => void run(() => api("/api/host/round/strike", { body: {} }))}>
          Strike
        </button>
      ) : null}

      {round.canUndo ? (
        <button data-testid="undo" className="min-h-12 rounded-xl bg-white/10" type="button" onClick={() => void run(() => api("/api/host/round/undo", { body: {} }))}>
          Undo
        </button>
      ) : null}

      {round.phase === "roundEnd" ? (
        <>
          <button className="min-h-12 rounded-xl bg-white/10" type="button" onClick={() => void run(() => api("/api/host/round/reveal-rest", { body: {} }))}>
            Reveal the rest
          </button>
          <button className="min-h-12 rounded-xl bg-gold font-semibold text-ink" type="button" onClick={() => void run(() => api("/api/host/round/done", { body: {} }))}>
            Next round
          </button>
        </>
      ) : null}

      {round.answerKey ? (
        <ul className="grid gap-1 text-sm text-white/80">
          {round.answerKey.map((row) => (
            <li key={row.id}>
              {row.rank}. {row.text} ({row.points}){row.revealed ? " — shown" : ""}
            </li>
          ))}
        </ul>
      ) : null}
    </aside>
  );
}

function phaseLabel(phase: string): string {
  switch (phase) {
    case "faceoff":
      return "Face-off";
    case "faceoffAnswer":
      return "Face-off answer";
    case "faceoffChoice":
      return "Play or pass";
    case "play":
      return "Main play";
    case "steal":
      return "Steal";
    case "roundEnd":
      return "Round over";
    default:
      return phase;
  }
}
