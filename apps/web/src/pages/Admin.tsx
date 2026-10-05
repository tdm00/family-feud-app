import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";

type Answer = { id: string; text: string; points: number; rank: number; aliases: string[] };
type Question = { id: string; prompt: string; usedAt: number | null; sortOrder: number; answers: Answer[] };
type DraftAnswer = { text: string; points: string; aliases: string };
type Draft = { id: string | null; prompt: string; answers: DraftAnswer[] };

const blankAnswer = (): DraftAnswer => ({ text: "", points: "", aliases: "" });

export function AdminPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [q, setQ] = useState("");
  const [used, setUsed] = useState<"all" | "used" | "unused">("all");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    api<{ host: boolean }>("/api/session")
      .then((session) => setAuthed(session.host))
      .catch(() => setAuthed(false));
  }, []);

  useEffect(() => {
    if (!authed) return;
    const handle = window.setTimeout(() => {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (used !== "all") params.set("used", used);
      api<Question[]>(`/api/host/questions?${params}`)
        .then(setQuestions)
        .catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not load questions"));
    }, 150);
    return () => window.clearTimeout(handle);
  }, [authed, q, used, version]);

  async function login(event: FormEvent) {
    event.preventDefault();
    try {
      await api("/api/host/login", { body: { password } });
      setAuthed(true);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not log in");
    }
  }

  function startNew() {
    setDraft({ id: null, prompt: "", answers: [blankAnswer(), blankAnswer()] });
  }

  function edit(question: Question) {
    setDraft({
      id: question.id,
      prompt: question.prompt,
      answers: question.answers
        .sort((a, b) => a.rank - b.rank)
        .map((answer) => ({ text: answer.text, points: String(answer.points), aliases: answer.aliases.join(", ") })),
    });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    const answers = draft.answers
      .filter((answer) => answer.text.trim())
      .map((answer, index) => ({
        text: answer.text,
        points: Number(answer.points),
        rank: index + 1,
        aliases: answer.aliases
          .split(",")
          .map((alias) => alias.trim())
          .filter(Boolean),
      }));
    try {
      if (draft.id) {
        await api(`/api/host/questions/${draft.id}`, { method: "PUT", body: { prompt: draft.prompt, answers } });
      } else {
        await api("/api/host/questions", { body: { prompt: draft.prompt, answers } });
      }
      setDraft(null);
      setVersion((value) => value + 1);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this question?")) return;
    try {
      await api(`/api/host/questions/${id}`, { method: "DELETE" });
      setVersion((value) => value + 1);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete");
    }
  }

  async function move(index: number, direction: -1 | 1) {
    if (q.trim() || used !== "all") {
      setError("Clear the search and filter before reordering");
      return;
    }
    const next = questions.slice();
    const target = index + direction;
    const current = next[index];
    const swap = next[target];
    if (!current || !swap) return;
    next[index] = swap;
    next[target] = current;
    try {
      await api("/api/host/questions/reorder", { body: { ids: next.map((question) => question.id) } });
      setQuestions(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reorder");
    }
  }

  if (authed === null) return <main className="grid min-h-dvh place-items-center">Checking the host session…</main>;
  if (!authed) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5">
        <h1 className="font-display text-5xl uppercase text-gold">Questions</h1>
        <form className="mt-6 grid gap-3" onSubmit={login}>
          <input data-testid="host-password" type="password" className="min-h-14 rounded-xl bg-white/10 px-4 text-xl" value={password} onChange={(event) => setPassword(event.target.value)} />
          {error ? <p className="text-red-300">{error}</p> : null}
          <button data-testid="host-login" className="min-h-14 rounded-xl bg-gold font-semibold text-ink">
            Unlock
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="mx-auto grid min-h-dvh max-w-5xl gap-6 px-4 py-6">
      <header className="flex items-center justify-between">
        <h1 className="font-display text-4xl uppercase text-gold">Questions</h1>
        <Link to="/host" className="text-white/70">
          Back to host
        </Link>
      </header>
      {error ? <p className="text-red-300">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <input className="min-h-11 flex-1 rounded-lg bg-white/10 px-3" placeholder="Search" value={q} onChange={(event) => setQ(event.target.value)} />
        <select className="min-h-11 rounded-lg bg-white/10 px-3" value={used} onChange={(event) => setUsed(event.target.value as "all" | "used" | "unused")}>
          <option value="all">All</option>
          <option value="unused">Unused</option>
          <option value="used">Used</option>
        </select>
        <button className="min-h-11 rounded-lg bg-gold px-4 font-semibold text-ink" type="button" onClick={startNew}>
          New question
        </button>
      </div>
      <ul className="grid gap-2">
        {questions.map((question, index) => (
          <li key={question.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-white/5 p-3">
            <span className="flex-1">
              {question.prompt}{" "}
              {question.usedAt ? <span className="text-sm text-gold">Used</span> : <span className="text-sm text-white/50">Unused</span>}
            </span>
            <button className="min-h-11 px-2" type="button" onClick={() => void move(index, -1)} disabled={index === 0}>
              Up
            </button>
            <button className="min-h-11 px-2" type="button" onClick={() => void move(index, 1)} disabled={index === questions.length - 1}>
              Down
            </button>
            <button className="min-h-11 px-2" type="button" onClick={() => edit(question)}>
              Edit
            </button>
            <button className="min-h-11 px-2" type="button" onClick={() => void remove(question.id)}>
              Delete
            </button>
          </li>
        ))}
      </ul>
      {draft ? (
        <form className="grid gap-3 rounded-2xl bg-white/5 p-4" onSubmit={save}>
          <label className="grid gap-1">
            Prompt
            <input data-testid="admin-prompt" className="min-h-12 rounded-lg bg-ink px-3" value={draft.prompt} onChange={(event) => setDraft({ ...draft, prompt: event.target.value })} />
          </label>
          {draft.answers.map((answer, index) => (
            <div key={index} className="grid gap-2 sm:grid-cols-[1fr_120px_1fr_auto]">
              <input
                data-testid={`admin-answer-text-${index}`}
                className="min-h-11 rounded-lg bg-ink px-3"
                placeholder="Answer"
                value={answer.text}
                onChange={(event) => {
                  const answers = draft.answers.slice();
                  answers[index] = { ...answer, text: event.target.value };
                  setDraft({ ...draft, answers });
                }}
              />
              <input
                data-testid={`admin-answer-points-${index}`}
                className="min-h-11 rounded-lg bg-ink px-3"
                placeholder="Points"
                inputMode="numeric"
                value={answer.points}
                onChange={(event) => {
                  const answers = draft.answers.slice();
                  answers[index] = { ...answer, points: event.target.value };
                  setDraft({ ...draft, answers });
                }}
              />
              <input
                className="min-h-11 rounded-lg bg-ink px-3"
                placeholder="Aliases, comma separated"
                value={answer.aliases}
                onChange={(event) => {
                  const answers = draft.answers.slice();
                  answers[index] = { ...answer, aliases: event.target.value };
                  setDraft({ ...draft, answers });
                }}
              />
              <button
                type="button"
                className="min-h-11 px-2"
                onClick={() => setDraft({ ...draft, answers: draft.answers.filter((_, item) => item !== index) })}
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            className="min-h-11 justify-self-start rounded-lg bg-white/10 px-3"
            disabled={draft.answers.length >= 8}
            onClick={() => setDraft({ ...draft, answers: [...draft.answers, blankAnswer()] })}
          >
            Add answer
          </button>
          <div className="flex gap-2">
            <button data-testid="admin-save" className="min-h-12 rounded-xl bg-gold px-4 font-semibold text-ink">
              Save question
            </button>
            <button type="button" className="min-h-12 rounded-xl bg-white/10 px-4" onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </main>
  );
}
