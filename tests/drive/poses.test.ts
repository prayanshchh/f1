import { expect, test } from "vitest";
import {
  createPoseBuffer,
  type PoseSample,
} from "../../apps/client/src/scene/follow/poses.ts";

function sample(tick: number): PoseSample {
  return {
    tick,
    position: { x: tick - 100, y: (tick - 100) / 4, z: (100 - tick) / 2 },
    orientation: { x: 0, y: 0, z: 0, w: 1 },
  };
}
function buffer() {
  const poses = createPoseBuffer(8);
  poses.push(sample(100), 0);
  poses.push(sample(108), 16);
  return poses;
}
test("the car is drawn between the two states around the render time", () => {
  expect(createPoseBuffer(8).at(0)).toBeNull();
  const poses = buffer();
  expect(poses.at(16)).toEqual(sample(100));
  expect(poses.at(24)).toEqual(sample(104));
  expect(poses.at(20)).toEqual(sample(102));
});
test("the car is never drawn ahead of the newest state", () => {
  const poses = buffer();
  expect(poses.at(1000)).toEqual(sample(108));
  expect(poses.at(-1000)).toEqual(sample(100));
  const copy = poses.at(1000);
  if (copy === null) throw new Error("Missing pose");
  copy.position.x = 900;
  expect(poses.at(1000)).toEqual(sample(108));
});
test("rotation turns the short way and stays a unit quaternion", () => {
  for (const sign of [1, -1]) {
    const poses = createPoseBuffer(8);
    poses.push(sample(0), 0);
    const end = sample(8);
    end.orientation = {
      x: 0,
      y: sign * Math.SQRT1_2,
      z: 0,
      w: sign * Math.SQRT1_2,
    };
    poses.push(end, 16);
    const q = poses.at(24)?.orientation;
    if (q === undefined) throw new Error("Missing rotation");
    expect(q.y).toBeCloseTo(Math.sin(Math.PI / 8), 9);
    expect(q.w).toBeCloseTo(Math.cos(Math.PI / 8), 9);
    expect(Math.hypot(q.x, q.y, q.z, q.w)).toBeCloseTo(1, 12);
  }
});
test("old or repeated states do not move the car back in time", () => {
  const poses = buffer();
  poses.push({ ...sample(108), position: { x: 99, y: 0, z: 0 } }, 30);
  poses.push(sample(104), 31);
  expect(poses.at(1000)).toEqual(sample(108));
  expect(poses.at(24)).toEqual(sample(104));
});
test("retained samples are independent and bounded", () => {
  const poses = createPoseBuffer(8);
  const first = sample(100);
  poses.push(first, 0);
  first.position.x = 900;
  expect(poses.at(0)?.position.x).toBe(0);
  for (let tick = 101; tick <= 120; tick += 1) poses.push(sample(tick), tick);
  expect(poses.at(-1000)?.tick).toBe(105);
});
