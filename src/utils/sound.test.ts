// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeAudioContext, installFakeAudio, removeFakeAudio, tonesPlayed } from "@/test/fakeAudio";
import { playSound, resetSound, SOUNDS, soundSupported, unlockSound } from "./sound";

beforeEach(() => resetSound());
afterEach(() => {
  removeFakeAudio();
  resetSound();
});

describe("sound", () => {
  it("does nothing, and says so, where there's no Web Audio", () => {
    removeFakeAudio();
    expect(soundSupported()).toBe(false);
    expect(unlockSound()).toBe(false);
    expect(playSound("pop")).toBe(false);
  });

  it("synthesizes a pop and a thud: no audio files", () => {
    installFakeAudio();
    expect(soundSupported()).toBe(true);
    expect(playSound("pop")).toBe(true);
    expect(playSound("thud")).toBe(true);
    expect(tonesPlayed()).toEqual([880, 150, 75]);
    expect(FakeAudioContext.made).toHaveLength(1); // one shared context
  });

  it("keeps the pop short and bright, the thud low and soft", () => {
    const [pop] = SOUNDS.pop;
    expect(pop.attack + pop.decay).toBeLessThan(0.12);
    expect(pop.to).toBeLessThan(pop.from);
    for (const t of SOUNDS.thud) {
      expect(t.from).toBeLessThanOrEqual(150);
      expect(t.attack + t.decay).toBeLessThan(0.25);
    }
    for (const t of [...SOUNDS.pop, ...SOUNDS.thud]) expect(t.peak).toBeLessThanOrEqual(0.25); // never loud
  });

  it("wakes a context the browser suspended", () => {
    installFakeAudio();
    unlockSound();
    FakeAudioContext.made[0].state = "suspended";
    playSound("pop");
    expect(FakeAudioContext.made[0].resume).toHaveBeenCalled();
  });
});
