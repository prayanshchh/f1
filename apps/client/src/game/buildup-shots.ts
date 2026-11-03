export interface ShotPoint {
  distance: number;
  lateral: number;
  height: number;
}

export interface Shot {
  eyeFrom: ShotPoint;
  eyeTo: ShotPoint;
  lookFrom: ShotPoint;
  lookTo: ShotPoint;
  fov: number;
}

export type TrackPoint = (
  distance: number,
  lateral: number,
) => [number, number, number];

function at(distance: number, lateral: number, height: number): ShotPoint {
  return { distance, lateral, height };
}

export const shots = {
  title: {
    eyeFrom: at(1716, 66, 56),
    eyeTo: at(1672, 74, 66),
    lookFrom: at(1262, 0, 6),
    lookTo: at(1292, 0, 10),
    fov: 44,
  },
  weather: {
    eyeFrom: at(1420, 60, 74),
    eyeTo: at(1450, 64, 82),
    lookFrom: at(4080, 0, 8),
    lookTo: at(4110, 0, 10),
    fov: 40,
  },
  hill: {
    eyeFrom: at(322, -3, 0.8),
    eyeTo: at(352, -3, 1),
    lookFrom: at(640, 0, 30),
    lookTo: at(640, 0, 34),
    fov: 32,
  },
} satisfies Record<string, Shot>;

const gridRowGap = 8;

export interface GridSpot {
  distance: number;
  lateral: number;
}

export function gridPairShot(front: GridSpot, back: GridSpot): Shot {
  const side = Math.sign(front.lateral - back.lateral) || 1;
  const outside = front.lateral + side * 3.2;
  const across = front.lateral - side * 3.2;
  return {
    eyeFrom: at(front.distance + 12.5, outside, 2.3),
    eyeTo: at(front.distance + 11, outside - side * 0.3, 1.9),
    lookFrom: at(front.distance - 6.5, across, 0.6),
    lookTo: at(front.distance - 7.2, across, 0.6),
    fov: 26,
  };
}

export function walkShot(
  index: number,
  playerDistance: number,
  lateral: number,
  playerSlot: number,
): Shot {
  const near = (ahead: number, across: number, height: number) =>
    at(playerDistance + ahead, lateral + across, height);
  const rowGap = playerSlot > 0 ? gridRowGap : -gridRowGap;
  const mate = (ahead: number, across: number, height: number) =>
    at(playerDistance + rowGap + ahead, -lateral + across, height);
  const towardCentre = -Math.sign(lateral) || -1;
  const list: Shot[] = [
    {
      eyeFrom: near(4.6, towardCentre * 5, 0.55),
      eyeTo: near(3.6, towardCentre * 5.2, 0.62),
      lookFrom: near(0.3, 0, 0.5),
      lookTo: near(0.5, 0, 0.5),
      fov: 30,
    },
    {
      eyeFrom: mate(5, -towardCentre * 2.6, 0.62),
      eyeTo: mate(3.6, -towardCentre * 3, 0.72),
      lookFrom: mate(0.3, 0, 0.55),
      lookTo: mate(-0.2, 0, 0.55),
      fov: 32,
    },
    {
      eyeFrom: near(-7.4, -towardCentre * 1.4, 2.3),
      eyeTo: near(-5, -towardCentre * 1, 1.9),
      lookFrom: near(7, 0, 0.7),
      lookTo: near(8, 0, 0.8),
      fov: 38,
    },
  ];
  return list[index % list.length] as Shot;
}

function ease(t: number): number {
  return t * t * (3 - 2 * t);
}

function mixPoint(a: ShotPoint, b: ShotPoint, t: number): ShotPoint {
  return {
    distance: a.distance + (b.distance - a.distance) * t,
    lateral: a.lateral + (b.lateral - a.lateral) * t,
    height: a.height + (b.height - a.height) * t,
  };
}

function place(point: ShotPoint, track: TrackPoint): [number, number, number] {
  const [x, y, z] = track(point.distance, point.lateral);
  return [x, y, z + point.height];
}

export interface CameraPose {
  eye: [number, number, number];
  target: [number, number, number];
  fov: number;
}

export function poseAt(
  shot: Shot,
  progress: number,
  track: TrackPoint,
): CameraPose {
  const t = ease(Math.max(0, Math.min(1, progress)));
  return {
    eye: place(mixPoint(shot.eyeFrom, shot.eyeTo, t), track),
    target: place(mixPoint(shot.lookFrom, shot.lookTo, t), track),
    fov: shot.fov,
  };
}
