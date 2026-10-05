import type { Snapshot } from "@feud/shared";

function playerName(snapshot: Snapshot, id: string | null): string {
  if (!id) return "—";
  return snapshot.players.find((player) => player.id === id)?.name ?? "—";
}

export function Board({ snapshot }: { snapshot: Snapshot }) {
  const round = snapshot.round;
  const goal = snapshot.game.pointsToWin;
  const reached = goal ? snapshot.game.teams.filter((team) => team.score >= goal) : [];
  const awarded = snapshot.game.teams.find((team) => team.id === round?.awardedTeamId);

  return (
    <section className="rounded-3xl bg-board p-4 shadow-2xl shadow-black/40 sm:p-6">
      <div className="grid grid-cols-2 gap-3">
        {snapshot.game.teams.map((team) => (
          <div key={team.id} className="rounded-2xl bg-ink/50 px-4 py-3" style={{ boxShadow: `inset 0 0 0 3px ${team.color}` }}>
            <p className="truncate text-sm font-semibold uppercase tracking-widest" style={{ color: team.color }}>
              {team.name}
            </p>
            <p className="font-display text-6xl leading-none sm:text-7xl" data-testid={`team-score-${team.slot}`}>
              {team.score}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-4 text-center">
        {goal ? <p className="text-sm uppercase tracking-[0.2em] text-gold">First to {goal}</p> : null}
        {reached.length === 1 ? (
          <p className="mt-1 font-display text-2xl text-gold">{reached[0]?.name} reached the goal</p>
        ) : null}
        {reached.length === 2 ? <p className="mt-1 font-display text-2xl text-gold">Both teams reached the goal</p> : null}
        <p className="mt-3 font-display text-3xl uppercase leading-tight text-white sm:text-4xl" data-testid="board-question">
          {round ? round.question : "Waiting for a question"}
        </p>
        {round && (round.phase === "faceoff" || round.phase === "faceoffAnswer") ? (
          <p className="mt-2 text-gold">
            {playerName(snapshot, round.faceoffPlayerAId)} vs {playerName(snapshot, round.faceoffPlayerBId)}
          </p>
        ) : null}
        {round?.buzzWinnerId && round.phase !== "play" && round.phase !== "steal" && round.phase !== "roundEnd" ? (
          <p className="mt-1 text-lg">{playerName(snapshot, round.buzzWinnerId)} buzzed first</p>
        ) : null}
      </div>

      <div className="mt-4 flex items-center justify-center gap-4">
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            data-testid={`strike-${index}`}
            data-active={round ? index < round.strikes : false}
            className={`font-display text-6xl leading-none ${round && index < round.strikes ? "text-red-500" : "text-white/20"}`}
          >
            ×
          </span>
        ))}
      </div>

      <p className="mt-2 text-center font-display text-2xl tracking-wide text-gold" data-testid="pot">
        Round {round?.pot ?? 0}
      </p>
      {round?.phase === "roundEnd" && awarded ? (
        <p className="text-center font-display text-3xl uppercase text-white">{awarded.name} takes the round</p>
      ) : null}

      <div className="mt-4 grid gap-2">
        {round?.answers.map((row) => (
          <div key={row.id} className="flip-scene" data-testid={`board-row-${row.rank}`}>
            <div className={`flip-card ${row.revealed ? "is-open" : ""}`}>
              <div className="flip-face cover">
                <span className="font-display text-2xl text-gold">{row.rank}</span>
                <span className="h-2 flex-1 rounded-full bg-white/15" />
              </div>
              <div className="flip-face answer">
                <span className="truncate font-display text-2xl uppercase">{row.text}</span>
                <span className="font-display text-3xl text-board">{row.points}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
