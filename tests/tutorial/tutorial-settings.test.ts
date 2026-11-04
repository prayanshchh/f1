import { describe, expect, test } from "vitest";
import {
  defaults,
  type Settings,
} from "../../apps/client/src/game/settings.ts";
import {
  keptChanges,
  rememberTutorial,
  tutorialSettings,
  tutorialStatus,
} from "../../apps/client/src/game/tutorial-settings.ts";

function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => {
      items.clear();
    },
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => {
      items.delete(key);
    },
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
}

const player: Settings = {
  ...defaults,
  session: "race",
  laps: 20,
  racingLine: "off",
  transmission: "sequential",
  antiLock: false,
  rain: "heavy",
  buildUp: true,
  hud: { ...defaults.hud, map: false, help: false },
};

describe("tutorial settings", () => {
  test("saving from the tutorial menu keeps only what the player changed there", () => {
    const start = tutorialSettings(player);
    const now: Settings = structuredClone(start);
    now.hud.tyres = false;
    now.steerSensitivity = 0.9;
    now.musicVolume = 30;

    const kept = keptChanges(player, start, now);
    expect(kept).toMatchObject({
      session: "race",
      laps: 20,
      racingLine: "off",
      transmission: "sequential",
      antiLock: false,
      rain: "heavy",
      buildUp: true,
      steerSensitivity: 0.9,
      musicVolume: 30,
    });
    expect(kept.hud).toEqual({
      ...player.hud,
      tyres: false,
    });
    expect(keptChanges(player, start, start)).toEqual(player);
  });

  test("finishing is remembered and a later skip never downgrades it", () => {
    const store = memoryStorage();
    expect(tutorialStatus(store)).toBeNull();
    rememberTutorial("skipped", store);
    expect(tutorialStatus(store)).toBe("skipped");
    rememberTutorial("done", store);
    rememberTutorial("skipped", store);
    expect(tutorialStatus(store)).toBe("done");
    store.setItem("revracers.tutorial", "maybe");
    expect(tutorialStatus(store)).toBeNull();
  });
});
