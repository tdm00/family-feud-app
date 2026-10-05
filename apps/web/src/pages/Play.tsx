import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, PLAYER_TOKEN_KEY } from "../api.js";
import { useRoundSounds } from "../sounds.js";
import { useLiveState } from "../useGame.js";

export function PlayPage() {
  const navigate = useNavigate();
  const token = localStorage.getItem(PLAYER_TOKEN_KEY) ?? "";
  const { snapshot, buzz } = useLiveState({ role: "player", token, enabled: Boolean(token) });
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  useRoundSounds(snapshot?.round ?? null, "player", snapshot?.you.role === "player" ? snapshot.you.id : undefined);

  useEffect(() => {
    if (!token) navigate("/");
  }, [token, navigate]);

  if (!token) return null;

  if (!snapshot || snapshot.you.role !== "player") {
    return <main className="grid min-h-dvh place-items-center text-xl">Connecting…</main>;
  }

  const you = snapshot.you;
  const team = snapshot.game.teams.find((item) => item.id === you.teamId);
  const affordances = snapshot.affordances;
  const round = snapshot.round;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await api("/api/play/answer", { playerToken: token, body: { text } });
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send that");
    }
  }

  function leave() {
    localStorage.removeItem(PLAYER_TOKEN_KEY);
    navigate("/");
  }

  return (
    <main
      className="flex min-h-dvh flex-col px-5 py-6"
      style={{ background: `radial-gradient(circle at top, ${team?.color ?? "#2f6fed"}55, #071433 48%)` }}
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm uppercase tracking-[0.25em] text-white/70">{team?.name ?? "No team yet"}</p>
          <h1 className="font-display text-4xl uppercase">{you.name}</h1>
        </div>
        <button className="min-h-11 rounded-full px-3 text-white/70" onClick={leave} type="button">
          Leave
        </button>
      </header>

      {round ? (
        <p className="mt-6 text-center text-xl text-white/90">{round.question}</p>
      ) : (
        <p className="mt-6 text-center text-xl text-white/80">Waiting in the lobby.</p>
      )}

      <div className="mt-4 flex flex-1 flex-col items-center justify-center gap-4">
        {affordances?.canAnswer ? (
          <form className="grid w-full max-w-md gap-3" onSubmit={submit}>
            <label className="text-center text-lg">Your answer</label>
            <input
              data-testid="answer-input"
              className="min-h-16 rounded-2xl border border-white/20 bg-white px-4 text-2xl text-ink"
              value={text}
              onChange={(event) => setText(event.target.value)}
              autoFocus
            />
            <button data-testid="answer-submit" className="min-h-14 rounded-2xl bg-gold text-xl font-semibold text-ink">
              Send
            </button>
            {round?.answerSubmitted ? <p className="text-center text-white/80">Sent. Waiting for the host.</p> : null}
          </form>
        ) : (
          <>
            <button
              data-testid="buzz"
              type="button"
              disabled={!affordances?.canBuzz}
              className={`grid h-64 w-64 place-items-center rounded-full text-4xl font-display tracking-widest ${
                affordances?.canBuzz ? "buzz-live bg-red-600 text-white shadow-2xl shadow-red-900/60" : "bg-white/10 text-white/40"
              }`}
              onClick={() => {
                if (round?.buzzWindowId) buzz(round.buzzWindowId);
              }}
            >
              Buzz
            </button>
            {affordances?.buzzReason ? (
              <p data-testid="buzz-reason" className="text-center font-display text-3xl uppercase text-gold">
                {affordances.buzzReason}
              </p>
            ) : null}
          </>
        )}
        {error ? <p className="text-red-300">{error}</p> : null}
      </div>

      {round ? (
        <ul className="mt-4 grid gap-1 text-lg">
          {round.answers
            .filter((row) => row.revealed)
            .map((row) => (
              <li key={row.id} className="flex justify-between rounded-lg bg-white/10 px-3 py-2">
                <span>{row.text}</span>
                <span>{row.points}</span>
              </li>
            ))}
        </ul>
      ) : null}
    </main>
  );
}
