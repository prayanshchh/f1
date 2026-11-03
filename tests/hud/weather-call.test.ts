import { describe, expect, test } from "vitest";
import {
  weatherCall,
  type WeatherInfo,
} from "../../apps/client/src/game/weather.ts";

const medium = 1;
const inter = 3;
const wet = 4;

function weather(patch: Partial<WeatherInfo>): WeatherInfo {
  return {
    rain: 0,
    lineWater: 0,
    offWater: 0,
    carWater: 0,
    clock: 0,
    slickLimit: 0.16,
    interLimit: 0.55,
    forecast: [0, 0, 0, 0, 0, 0],
    ...patch,
  };
}

describe("engineer tyre calls", () => {
  test("stays quiet while the fitted tyre suits the track", () => {
    expect(weatherCall(weather({}), medium).message).toBeNull();
    expect(
      weatherCall(weather({ rain: 0.4, lineWater: 0.3 }), inter).message,
    ).toBeNull();
    expect(
      weatherCall(weather({ rain: 1, lineWater: 0.8 }), wet).message,
    ).toBeNull();
  });

  test("calls the right tyre in each direction", () => {
    const title = (w: WeatherInfo, fitted: number) =>
      weatherCall(w, fitted).message?.title;
    expect(title(weather({ rain: 0.4, lineWater: 0.3 }), medium)).toBe(
      "Box for intermediates",
    );
    expect(title(weather({ rain: 1, lineWater: 0.8 }), inter)).toBe(
      "Box for wets",
    );
    expect(title(weather({ lineWater: 0.3 }), wet)).toBe(
      "Box for intermediates",
    );
    expect(title(weather({ lineWater: 0.05, offWater: 0.4 }), inter)).toBe(
      "Box for slicks",
    );
  });

  test("warns before forecast rain arrives, once per change", () => {
    const coming = weather({ forecast: [0.4, 0.6, 0, 0, 0, 0] });
    const first = weatherCall(coming, medium);
    expect(first.message?.title).toBe("Rain expected");
    expect(weatherCall(coming, medium).key).toBe(first.key);
  });
});
