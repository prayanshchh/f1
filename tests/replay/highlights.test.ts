import { describe, expect, test } from "vitest";
import {
  Highlights,
  type Pass,
} from "../../apps/client/src/game/highlights.ts";
import { ReplayTape } from "../../apps/client/src/game/replay.ts";

function pass(time: number, position: number, passer = 0): Pass {
  return { time, passer, passed: position + 1, position, lap: 2 };
}

function recorder() {
  const cuts: [number, number][] = [];
  const highlights = new Highlights(0, (from, to) => {
    cuts.push([from, to]);
    return new ReplayTape(1, to - from);
  });
  let total = 0;
  const run = (time: number, fresh: Pass[] = []) => {
    total += fresh.length;
    highlights.update(time, total, fresh);
  };
  return { highlights, cuts, run };
}

describe("race highlights", () => {
  test("passes close together share one clip, cut once the moment is over", () => {
    const { highlights, cuts, run } = recorder();
    run(10, [pass(10, 6), pass(10, 3, 7)]);
    run(12, [pass(12, 5)]);
    run(14);
    expect(cuts).toEqual([]);
    run(14.6);
    expect(cuts).toEqual([[5, 14.5]]);
    run(40, [pass(40, 4)]);
    const reel = highlights.reel();
    expect(reel.map((clip) => clip.passes.map((p) => p.position))).toEqual([
      [6, 5],
      [4],
    ]);
  });

  test("a flashback forgets overtakes that have not happened yet", () => {
    const { highlights, run } = recorder();
    run(10, [pass(10, 6)]);
    run(20, [pass(20, 5)]);
    run(30);
    highlights.update(15, 1, []);
    expect(highlights.from).toBe(1);
    expect(highlights.reel().map((clip) => clip.passes[0]?.position)).toEqual([
      6,
    ]);
  });

  test("the reel keeps the passes for the best places, in race order", () => {
    const { highlights, run } = recorder();
    [10, 9, 8, 7, 6, 5, 4, 1].forEach((position, k) => {
      run(20 + k * 30, [pass(20 + k * 30, position)]);
    });
    run(400);
    expect(highlights.reel().map((clip) => clip.passes[0]?.position)).toEqual([
      8, 7, 6, 5, 4, 1,
    ]);
  });
});
