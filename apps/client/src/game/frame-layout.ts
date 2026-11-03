export const frameIndex = {
  time: 0,
  posMat: 1,
  wheels: 17,
  speed: 45,
  rpm: 46,
  rpmRedLine: 47,
  gear: 48,
  laps: 49,
  curLapTime: 50,
  lastLapTime: 51,
  bestLapTime: 52,
  distFromStart: 53,
  toMiddle: 54,
  steer: 55,
  accel: 56,
  brake: 57,
  raceState: 58,
  dammage: 59,
  camera: 60,
  brakeTemp: 84,
  size: 88,
} as const;

export const carStride = 49;
export const carField = {
  speed: 40,
  steer: 41,
  brake: 42,
  rpm: 43,
  gear: 44,
  compound: 45,
  visible: 46,
  toMiddle: 47,
  distance: 48,
} as const;

export const carWheel = { from: 16, stride: 6, yaw: 5 } as const;
