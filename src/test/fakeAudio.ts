import { vi } from "vitest";

/** A stand-in for Web Audio: records the tones the game schedules. */
class FakeParam {
  calls: [string, number, number][] = [];
  setValueAtTime(value: number, time: number) {
    this.calls.push(["set", value, time]);
  }
  exponentialRampToValueAtTime(value: number, time: number) {
    this.calls.push(["ramp", value, time]);
  }
}

export class FakeOscillator {
  type = "";
  frequency = new FakeParam();
  started = false;
  connect() {}
  start() {
    this.started = true;
  }
  stop() {}
}

export class FakeAudioContext {
  static made: FakeAudioContext[] = [];
  currentTime = 0;
  state: "running" | "suspended" = "running";
  destination = {};
  oscillators: FakeOscillator[] = [];
  resume = vi.fn(async () => {});
  constructor() {
    FakeAudioContext.made.push(this);
  }
  createOscillator() {
    const o = new FakeOscillator();
    this.oscillators.push(o);
    return o;
  }
  createGain() {
    return { gain: new FakeParam(), connect() {} };
  }
}

/** The starting frequency of each tone played so far, in order: 880 is a pop, 150 (+75) a thud. */
export function tonesPlayed(): number[] {
  return FakeAudioContext.made.flatMap((c) => c.oscillators.map((o) => o.frequency.calls[0][1]));
}

export function installFakeAudio() {
  FakeAudioContext.made = [];
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
}

export function removeFakeAudio() {
  delete (window as unknown as { AudioContext?: unknown }).AudioContext;
  FakeAudioContext.made = [];
}
