import { describe, expect, test } from "vitest";
import {
  controlEvent,
  flagCause,
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

  test("a yellow flag says who, what happened and where, and the safety car names whose crash it was", () => {
    const spun = message({
      stage: stage.flag,
      car: 1,
      other: 0,
      offence: offence.yellowSingle,
      penalty: penalty.none,
      points: flagCause.spun,
    });
    expect(noticeFor(spun, name, turns, true)).toMatchObject({
      kind: "flag",
      title: "Yellow flag",
      detail:
        "Bellamy spun after contact with you - Turn 12 - Slow down, no overtaking",
    });
    const stopped = message({
      stage: stage.flag,
      car: 0,
      other: 2,
      offence: offence.yellowDouble,
      penalty: penalty.none,
      points: flagCause.stopped,
      count: 2,
      distance: 650,
    });
    expect(noticeFor(stopped, name, turns, true)).toMatchObject({
      title: "Double yellow flag",
      detail:
        "You stopped on track after contact with Okafor - Turn 1 - Be ready to stop",
    });
    const safetyCar = message({
      stage: stage.control,
      car: -1,
      offence: controlEvent.safetyCar,
      penalty: penalty.none,
      value: 1,
    });
    const incidents = new Map([[1, spun]]);
    expect(
      noticeFor(safetyCar, name, turns, true, incidents)?.detail,
    ).toContain("After Bellamy's crash at Turn 12");
    const red = { ...safetyCar, offence: controlEvent.red, value: 0 };
    expect(
      noticeFor(red, name, turns, true, new Map([[0, stopped]]))?.detail,
    ).toContain("After your crash at Turn 1");
  });

  test("a car that passed you under yellow is told to give the place back and you see it handed back", () => {
    const told = message({
      stage: stage.instruction,
      car: 2,
      other: 0,
      offence: offence.yellowOvertake,
      penalty: penalty.none,
      value: 90,
    });
    expect(noticeFor(told, name, turns, true)).toMatchObject({
      title: "Okafor must give the place back",
      detail: "Passed you under yellow flags - they will wait for you to pass",
    });
    expect(
      noticeFor({ ...told, stage: stage.returned }, name, turns, true)?.title,
    ).toBe("Okafor gave the place back");
    expect(
      noticeFor({ ...told, car: 0, other: 2 }, name, turns, true)?.detail,
    ).toBe(
      "You overtook under yellow flags - Let Okafor past within 90 seconds",
    );
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
