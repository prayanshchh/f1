import { describe, expect, test } from "vitest";
import {
  noticeFor,
  offence,
  penalty,
  penaltyBadge,
  stage,
  type StewardCar,
  type StewardMessage,
} from "../../apps/client/src/game/stewards.ts";

const turns = [
  { number: 1, distance: 656 },
  { number: 12, distance: 3764 },
];
const names = ["You", "Bellamy", "Okafor"];
const name = (car: number) => names[car] ?? "?";

function message(fields: Partial<StewardMessage>): StewardMessage {
  return {
    id: 1,
    time: 10,
    lap: 3,
    car: 0,
    other: -1,
    offence: offence.trackLimits,
    stage: stage.warning,
    penalty: penalty.warning,
    value: 0,
    distance: 3790,
    count: 1,
    points: 0,
    ...fields,
  };
}

const clean: StewardCar = {
  strikes: 0,
  owedTime: 0,
  pending: "none",
  crossingsLeft: 0,
  points: 0,
  reprimands: 0,
  disqualified: false,
  lapInvalid: false,
  lastLapInvalid: false,
  timeAdded: 0,
  blue: false,
  flag: 0,
  gridDrop: 0,
  drivingReprimands: 0,
  offTracks: 0,
  giveBackTo: null,
};

describe("race control notices", () => {
  test("a track limits strike in a race names the lap, the corner and the count", () => {
    const notice = noticeFor(message({ count: 2 }), name, turns, true);
    expect(notice?.kind).toBe("warning");
    expect(notice?.detail).toContain("Lap 3 time deleted");
    expect(notice?.detail).toContain("Turn 12");
    expect(notice?.detail).toContain("2 of 3");
  });

  test("a deleted lap is announced outside races but folds into the strike during a race", () => {
    const deleted = message({ penalty: penalty.lapDeleted, count: 0 });
    expect(noticeFor(deleted, name, turns, true)).toBeNull();
    expect(noticeFor(deleted, name, turns, false)?.title).toBe(
      "Lap invalidated",
    );
  });

  test("an investigation is followed by the decision with the other driver named", () => {
    const noted = message({
      stage: stage.noted,
      penalty: penalty.none,
      offence: offence.collision,
      other: 2,
      distance: 650,
    });
    expect(noticeFor(noted, name, turns, true)).toMatchObject({
      kind: "investigation",
      detail: "Causing a collision with Okafor - Turn 1",
    });
    const decided = {
      ...noted,
      stage: stage.decision,
      penalty: penalty.time10,
    };
    expect(noticeFor(decided, name, turns, true)).toMatchObject({
      kind: "penalty",
      title: "10 second time penalty",
    });
  });

  test("other drivers' penalties are shown only when the player was the one wronged", () => {
    const against = message({
      car: 1,
      other: 0,
      stage: stage.decision,
      penalty: penalty.time5,
      offence: offence.forcingOff,
    });
    expect(noticeFor(against, name, turns, true)?.title).toBe(
      "Bellamy penalised",
    );
    expect(noticeFor({ ...against, other: 2 }, name, turns, true)).toBeNull();
  });

  test("the timing badge shows what is still owed", () => {
    expect(penaltyBadge(clean)).toBe("");
    expect(penaltyBadge({ ...clean, owedTime: 5, timeAdded: 10 })).toBe("+15s");
    expect(penaltyBadge({ ...clean, pending: "drive-through" })).toBe("DT");
    expect(penaltyBadge({ ...clean, disqualified: true, owedTime: 5 })).toBe(
      "DSQ",
    );
  });
});
