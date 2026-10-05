import { useState, type FormEvent } from "react";
import { api, DISPLAY_TOKEN_KEY } from "../api.js";
import { Board } from "../components/Board.js";
import { useRoundSounds } from "../sounds.js";
import { useLiveState } from "../useGame.js";

export function DisplayPage() {
  const [token, setToken] = useState(localStorage.getItem(DISPLAY_TOKEN_KEY) ?? "");
  const [roomCode, setRoomCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { snapshot } = useLiveState({ role: "display", token, enabled: Boolean(token) });
  useRoundSounds(snapshot?.round ?? null, "show");

  async function join(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const result = await api<{ token: string }>("/api/display/join", { body: { roomCode } });
      localStorage.setItem(DISPLAY_TOKEN_KEY, result.token);
      setToken(result.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open the board");
    }
  }

  if (!token) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5">
        <h1 className="font-display text-5xl uppercase text-gold">Board</h1>
        <form className="mt-6 grid gap-3" onSubmit={join}>
          <input
            data-testid="display-code"
            className="min-h-14 rounded-xl border border-white/15 bg-white/10 px-4 text-2xl"
            value={roomCode}
            onChange={(event) => setRoomCode(event.target.value)}
            placeholder="Room code"
          />
          {error ? <p className="text-red-300">{error}</p> : null}
          <button data-testid="display-join" className="min-h-14 rounded-xl bg-gold font-semibold text-ink">
            Show the board
          </button>
        </form>
      </main>
    );
  }

  if (!snapshot) return <main className="grid min-h-dvh place-items-center text-2xl">Connecting the board…</main>;

  return (
    <main className="min-h-dvh p-4 sm:p-8">
      <Board snapshot={snapshot} />
    </main>
  );
}
