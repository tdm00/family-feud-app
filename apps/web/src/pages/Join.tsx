import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, PLAYER_TOKEN_KEY } from "../api.js";

export function JoinPage() {
  const navigate = useNavigate();
  const [roomCode, setRoomCode] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem(PLAYER_TOKEN_KEY);
    if (!token) return;
    api("/api/me", { playerToken: token })
      .then(() => navigate("/play"))
      .catch(() => localStorage.removeItem(PLAYER_TOKEN_KEY));
  }, [navigate]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const result = await api<{ token: string }>("/api/join", { body: { roomCode, name } });
      localStorage.setItem(PLAYER_TOKEN_KEY, result.token);
      navigate("/play");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not join");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
      <p className="font-display text-5xl uppercase tracking-wide text-gold">Family Feud</p>
      <p className="mt-2 text-lg text-white/80">Enter the room code and your name.</p>
      <form className="mt-8 grid gap-4" onSubmit={onSubmit}>
        <label className="grid gap-1 text-sm uppercase tracking-widest text-white/70">
          Room code
          <input
            data-testid="join-code"
            className="min-h-14 rounded-xl border border-white/15 bg-white/10 px-4 text-2xl text-white"
            value={roomCode}
            onChange={(event) => setRoomCode(event.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
          />
        </label>
        <label className="grid gap-1 text-sm uppercase tracking-widest text-white/70">
          Your name
          <input
            data-testid="join-name"
            className="min-h-14 rounded-xl border border-white/15 bg-white/10 px-4 text-2xl text-white"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="nickname"
          />
        </label>
        {error ? <p className="text-red-300">{error}</p> : null}
        <button
          data-testid="join-submit"
          className="min-h-14 rounded-xl bg-gold text-xl font-semibold text-ink disabled:opacity-50"
          disabled={pending}
        >
          Join
        </button>
      </form>
      <nav className="mt-8 flex gap-4 text-white/70">
        <Link to="/host">Host</Link>
        <Link to="/display">Display</Link>
      </nav>
    </main>
  );
}
