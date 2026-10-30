/**
 * Sound feedback, synthesized with the Web Audio API: no audio files, so it works offline
 * and adds nothing to download. Two sounds:
 *
 *   pop  — a correct answer: a short, bright sine blip that falls an octave, like a bubble.
 *   thud — a dead end or an error: a low, soft knock (two low tones falling, fast decay).
 *
 * It's for iPhones above all, which have no Vibration API. Off by default (the header toggle
 * turns it on). Browsers only allow audio after a tap or a key press, so the audio context is
 * created, or woken, by the toggle itself; after that every sound just plays. Every call is
 * feature-checked and never throws. On iPhone, the ring/silent switch mutes these sounds,
 * like any web page's; that's left as the player set it.
 */

export type SoundName = "pop" | "thud";

type AudioContextLike = Pick<AudioContext, "currentTime" | "state" | "destination" | "resume" | "createOscillator" | "createGain">;
type AudioContextClass = new () => AudioContextLike;

let context: AudioContextLike | null = null;

function audioContextClass(): AudioContextClass | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { AudioContext?: AudioContextClass; webkitAudioContext?: AudioContextClass };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** Whether this browser can make sounds at all. */
export function soundSupported(): boolean {
  return audioContextClass() !== null;
}

/** The shared context, created on first use and woken if the browser suspended it. */
function getContext(): AudioContextLike | null {
  if (!context) {
    const Ctx = audioContextClass();
    if (!Ctx) return null;
    try {
      context = new Ctx();
    } catch {
      return null;
    }
  }
  if (context.state === "suspended") void context.resume().catch(() => {});
  return context;
}

/** Call from a tap (the sound toggle): browsers only start audio from a user gesture. */
export function unlockSound(): boolean {
  return getContext() !== null;
}

/** One tone: a frequency glide under a fast attack and an exponential decay. */
function tone(
  ctx: AudioContextLike,
  { type, from, to, peak, attack, decay, delay = 0 }: { type: OscillatorType; from: number; to: number; peak: number; attack: number; decay: number; delay?: number },
) {
  const start = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, start);
  osc.frequency.exponentialRampToValueAtTime(to, start + attack + decay);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + attack + decay);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + attack + decay + 0.02);
}

/** The recipes, exported for tests: each is one or more tones. */
export const SOUNDS: Record<SoundName, Parameters<typeof tone>[1][]> = {
  // ~90 ms: 880 Hz falling to 440, quiet, with a 4 ms attack so it clicks softly rather than snaps.
  pop: [{ type: "sine", from: 880, to: 440, peak: 0.16, attack: 0.004, decay: 0.085 }],
  // ~190 ms: 150 Hz falling to 55, with a quieter sine an octave below for weight.
  thud: [
    { type: "triangle", from: 150, to: 55, peak: 0.22, attack: 0.006, decay: 0.18 },
    { type: "sine", from: 75, to: 40, peak: 0.18, attack: 0.006, decay: 0.2 },
  ],
};

/** Plays a sound. Returns false where the browser can't. Never throws. */
export function playSound(name: SoundName): boolean {
  const ctx = getContext();
  if (!ctx) return false;
  try {
    for (const t of SOUNDS[name]) tone(ctx, t);
    return true;
  } catch {
    return false;
  }
}

/** Test hook: forget the shared context. */
export function resetSound() {
  context = null;
}
