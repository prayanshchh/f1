export const PHYSICS_HZ = 500;
export const SNAPSHOT_INTERVAL_TICKS = 8;
export const MAX_CARS = 22;
export type Vec3 = { x: number; y: number; z: number };
export type Quat = { x: number; y: number; z: number; w: number };
export type Input = {
  steer: number;
  throttle: number;
  brake: number;
  shiftUp: boolean;
  shiftDown: boolean;
};
export type WheelState = {
  spin: number;
  slipRatio: number;
  slipAngle: number;
  load: number;
};
export type CarState = {
  id: number;
  position: Vec3;
  orientation: Quat;
  velocity: Vec3;
  angularVelocity: Vec3;
  lap: number;
  lapDistance: number;
  gear: number;
  engineRpm: number;
  batteryEnergy: number;
  ersPower: number;
  straightMode: number;
  steerAngle: number;
  wheels: [WheelState, WheelState, WheelState, WheelState];
};
export type Snapshot = { tick: number; cars: Array<CarState> };
export type TrackData = {
  name: string;
  width: number;
  centerline: Array<Vec3>;
};
export type CarSetup = { id: number; startDistance: number };
export type WorldSetup = { track: TrackData; cars: Array<CarSetup> };
export type ClientMessage =
  | { type: "join"; name: string }
  | { type: "input"; tick: number; input: Input }
  | { type: "ping"; clientTime: number };
export type ServerMessage =
  | { type: "welcome"; carId: number; setup: WorldSetup; tick: number }
  | { type: "snapshot"; snapshot: Snapshot; lastInputTick: number }
  | { type: "pong"; clientTime: number; serverTick: number }
  | { type: "rejected"; reason: string };
