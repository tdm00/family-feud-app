import { useEffect, useRef } from "react";
import type { RoundView } from "@feud/shared";

let audio: AudioContext | null = null;

export function unlockAudio(): void {
  if (!audio) audio = new AudioContext();
  if (audio.state === "suspended") void audio.resume();
}

function beep(frequency: number, duration: number, type: OscillatorType): void {
  if (!audio) return;
  const ctx = audio;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = frequency;
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + duration);
}

export function playBuzz(): void {
  unlockAudio();
  beep(880, 0.15, "square");
}

export function playStrike(): void {
  unlockAudio();
  beep(140, 0.4, "sawtooth");
}

export function useRoundSounds(round: RoundView | null, mode: "show" | "player", playerId?: string): void {
  const previous = useRef<RoundView | null>(null);
  useEffect(() => {
    const before = previous.current;
    previous.current = round;
    if (!before || !round) return;
    const buzzChanged = Boolean(round.buzzWinnerId) && round.buzzWinnerId !== before.buzzWinnerId;
    if (buzzChanged && (mode === "show" || round.buzzWinnerId === playerId)) playBuzz();
    if (mode === "show" && round.strikes > before.strikes) playStrike();
  }, [round, mode, playerId]);
}
