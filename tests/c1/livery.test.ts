import { describe, expect, test } from "vitest";
import {
  paintLivery,
  parseLivery,
} from "../../apps/client/src/livery/index.ts";
import { caughtError } from "../f1/support/sim.ts";

describe("the livery system", () => {
  const livery = parseLivery({
    id: "test",
    name: "Test",
    primary: "#ff8000",
    secondary: "#0040c0",
    accent: "#ffffff",
    number: 42,
  });

  test("parses a livery into exactly its fields", () => {
    expect(livery).toEqual({
      id: "test",
      name: "Test",
      primary: "#ff8000",
      secondary: "#0040c0",
      accent: "#ffffff",
      number: 42,
    });
  });

  test("paints each zone with its colour and blends anti-aliased edges", () => {
    const data = new Uint8ClampedArray([
      255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 128, 128, 127, 0, 255, 0, 0, 0,
      0,
    ]);
    const painted = paintLivery({ width: 5, height: 1, data }, livery);
    expect(painted).toBeInstanceOf(Uint8ClampedArray);
    expect([...painted]).toEqual([
      255, 128, 0, 255, 0, 64, 192, 255, 255, 255, 255, 128, 128, 96, 96, 255,
      0, 0, 0, 0,
    ]);
    expect([...data].slice(0, 4), "the mask itself is not modified").toEqual([
      255, 0, 0, 255,
    ]);
  });

  test("painting is fast enough for a 2048 by 2048 mask", () => {
    const size = 2048;
    const data = new Uint8ClampedArray(size * size * 4).fill(255);
    const started = performance.now();
    const painted = paintLivery({ width: size, height: size, data }, livery);
    expect(performance.now() - started).toBeLessThan(1500);
    expect(painted.length).toBe(data.length);
  });

  const bad: [string, unknown][] = [
    ["nothing", undefined],
    ["an array", []],
    [
      "a missing colour",
      {
        id: "x",
        name: "X",
        primary: "#ffffff",
        secondary: "#000000",
        number: 1,
      },
    ],
    [
      "an unknown field",
      {
        id: "x",
        name: "X",
        primary: "#ffffff",
        secondary: "#000000",
        accent: "#111111",
        number: 1,
        sponsor: "y",
      },
    ],
    [
      "a short colour",
      {
        id: "x",
        name: "X",
        primary: "#fff",
        secondary: "#000000",
        accent: "#111111",
        number: 1,
      },
    ],
    [
      "an upper-case colour",
      {
        id: "x",
        name: "X",
        primary: "#FFFFFF",
        secondary: "#000000",
        accent: "#111111",
        number: 1,
      },
    ],
    [
      "a named colour",
      {
        id: "x",
        name: "X",
        primary: "red",
        secondary: "#000000",
        accent: "#111111",
        number: 1,
      },
    ],
    [
      "number zero",
      {
        id: "x",
        name: "X",
        primary: "#ffffff",
        secondary: "#000000",
        accent: "#111111",
        number: 0,
      },
    ],
    [
      "number 100",
      {
        id: "x",
        name: "X",
        primary: "#ffffff",
        secondary: "#000000",
        accent: "#111111",
        number: 100,
      },
    ],
    [
      "a fractional number",
      {
        id: "x",
        name: "X",
        primary: "#ffffff",
        secondary: "#000000",
        accent: "#111111",
        number: 4.5,
      },
    ],
    [
      "an empty name",
      {
        id: "x",
        name: " ",
        primary: "#ffffff",
        secondary: "#000000",
        accent: "#111111",
        number: 4,
      },
    ],
    [
      "a bad id",
      {
        id: "Bad Id",
        name: "X",
        primary: "#ffffff",
        secondary: "#000000",
        accent: "#111111",
        number: 4,
      },
    ],
  ];

  test.each(bad)("rejects %s with an Error", (_label, value) => {
    const error = caughtError(() => parseLivery(value));
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toBe("");
  });

  test("rejects masks whose pixel data does not match their size", () => {
    const error = caughtError(() =>
      paintLivery(
        { width: 2, height: 2, data: new Uint8ClampedArray(12) },
        livery,
      ),
    );
    expect(error).toBeInstanceOf(Error);
  });
});
