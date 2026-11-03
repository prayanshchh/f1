import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, ApiError } from "../../apps/client/src/game/api.ts";
import {
  PlayerError,
  playerMessage,
} from "../../apps/client/src/game/player-error.ts";

const fallback = "Something went wrong. Try again.";

async function shown(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    return playerMessage(error, fallback);
  }
  throw new Error("expected the request to fail");
}

describe("errors shown to the player", () => {
  beforeEach(() => {
    vi.stubGlobal("reportError", vi.fn());
    const stored = new Map([["revracers.player", "k".repeat(43)]]);
    vi.stubGlobal("localStorage", {
      getItem: (name: string) => stored.get(name) ?? null,
      setItem: (name: string, value: string) => stored.set(name, value),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("internal errors are logged, not shown", () => {
    const log = vi.fn();
    vi.stubGlobal("reportError", log);
    const internal = new TypeError(
      "Cannot read properties of undefined (reading 'x')",
    );
    expect(playerMessage(internal, fallback)).toBe(fallback);
    expect(playerMessage("raw string", fallback)).toBe(fallback);
    expect(log).toHaveBeenCalledWith(internal);
  });

  test("messages written for the player are shown", () => {
    expect(
      playerMessage(new PlayerError("Turn the phone sideways."), fallback),
    ).toBe("Turn the phone sideways.");
  });

  test("a server validation message reaches the player", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          Response.json(
            { error: "Use up to 24 letters.", field: "firstName" },
            { status: 400 },
          ),
        ),
      ),
    );
    expect(await shown(api.join())).toBe("Use up to 24 letters.");
  });

  test("a network failure reads as unreachable, not the browser error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );
    const failure = api.join();
    await expect(failure).rejects.toBeInstanceOf(ApiError);
    expect(await shown(api.join())).toBe("The server could not be reached.");
  });

  test("a server crash page does not leak to the player", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            "Error: relation drivers does not exist\n    at db.ts:12",
            {
              status: 500,
            },
          ),
        ),
      ),
    );
    expect(await shown(api.join())).toBe("The server could not be reached.");
  });
});
