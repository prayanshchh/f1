import { describe, expect, test } from "vitest";
import {
  type GraphicsLevel,
  GraphicsMode,
  type GraphicsView,
} from "../../apps/client/src/game/graphics-mode.ts";

interface Probe {
  view: GraphicsView;
  drawn: number;
  shown: boolean;
}

function probe(): Probe {
  const made: Probe = {
    drawn: 0,
    shown: false,
    view: {
      draw: () => {
        made.drawn += 1;
      },
      overlay: () => undefined,
      show: (shown) => {
        made.shown = shown;
      },
    },
  };
  return made;
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("graphics mode", () => {
  test("switching builds the other renderer once and draws only the shown one", async () => {
    const ultra = probe();
    const low = probe();
    const builds: GraphicsLevel[] = [];
    const changes: GraphicsLevel[] = [];
    const mode = new GraphicsMode(
      "ultra",
      (level) => {
        builds.push(level);
        return Promise.resolve(level === "ultra" ? ultra.view : low.view);
      },
      (level) => changes.push(level),
    );
    await mode.start();
    mode.draw();
    expect(await mode.switchTo("low")).toBe(true);
    mode.draw();
    expect(await mode.switchTo("ultra")).toBe(true);
    expect(await mode.switchTo("low")).toBe(true);
    mode.draw();
    expect(builds).toEqual(["ultra", "low"]);
    expect(changes).toEqual(["ultra", "low", "ultra", "low"]);
    expect([ultra.drawn, low.drawn]).toEqual([1, 2]);
    expect([ultra.shown, low.shown]).toEqual([false, true]);
    expect(mode.low).toBe(true);
  });

  test("pressing G twice while Low is still loading stays on Ultra", async () => {
    const ultra = probe();
    const low = probe();
    const lowLoad = deferred<GraphicsView>();
    const mode = new GraphicsMode(
      "ultra",
      (level) =>
        level === "ultra" ? Promise.resolve(ultra.view) : lowLoad.promise,
      () => undefined,
    );
    await mode.start();
    const first = mode.switchTo("low");
    expect(mode.target).toBe("low");
    const second = mode.switchTo("ultra");
    lowLoad.resolve(low.view);
    expect(await first).toBe(false);
    expect(await second).toBe(false);
    expect(mode.level).toBe("ultra");
    expect([ultra.shown, low.shown]).toEqual([true, false]);
  });

  test("a renderer that fails to load keeps the race on the current one and can be retried", async () => {
    const low = probe();
    const ultra = probe();
    let attempts = 0;
    const mode = new GraphicsMode(
      "low",
      (level) => {
        if (level === "low") return Promise.resolve(low.view);
        attempts += 1;
        return attempts === 1
          ? Promise.reject(new Error("no graphics card"))
          : Promise.resolve(ultra.view);
      },
      () => undefined,
    );
    await mode.start();
    await expect(mode.switchTo("ultra")).rejects.toThrow("no graphics card");
    expect(mode.level).toBe("low");
    expect(mode.target).toBe("low");
    expect(low.shown).toBe(true);
    expect(await mode.switchTo("ultra")).toBe(true);
    expect([low.shown, ultra.shown]).toEqual([false, true]);
  });

  test("Ultra is judged too slow from the median frame after the opening frames", () => {
    const judge = (frameMs: number, openingMs: number) => {
      const mode = new GraphicsMode(
        "ultra",
        () => Promise.resolve(probe().view),
        () => undefined,
      );
      let now = 0;
      let verdict = false;
      for (let frame = 0; frame < 400 && !verdict; frame++) {
        now += (frame < 120 ? openingMs : frameMs) / 1000;
        verdict = mode.tooSlowForUltra(now);
      }
      return verdict;
    };
    expect(judge(30, 30)).toBe(true);
    expect(judge(16.7, 200)).toBe(false);
    expect(judge(8.3, 8.3)).toBe(false);
  });
});
