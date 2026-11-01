import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const directory = process.argv[2] ?? "content/tracks/cota";
const track = JSON.parse(
  readFileSync(path.join(directory, "track.json"), "utf8"),
);

const width = track.width;
const half = width / 2;
const minSideWidth = 0.5;
const kerbHeight = 0.02;
const kerbRoughness = 0.008;
const kerbWavelength = 1.13;
const kerbMaxWidening = 0.6;
const kerbRamp = 16;
const grassRoughness = 0.006;
const grassWavelength = 3;
const timeOfDay = 16.5;
const pitWallThin = 0.4;
const pitDeckRamp = 20;
const pitWallHeight = 1;
const pitWallRamp = 30;
const pit = track.pitLane;
const pitShift = pit.pitWall - half;

const points = track.centerline.map((p) => ({
  x: p.x,
  y: -p.z,
  z: p.y,
  gx: p.x,
  gz: p.z,
  width: p.width,
  camber: p.camber,
  wallLeft: p.wallLeft,
  wallRight: p.wallRight,
}));
const n = points.length;
const at = (i) => points[((i % n) + n) % n];
const spacing = track.length / n;

function kerbAt(side, distance) {
  return track.surfaces.some(
    (s) =>
      s.kind === "kerb" &&
      s.side === side &&
      (s.from <= s.to
        ? distance >= s.from && distance <= s.to
        : distance >= s.from || distance <= s.to),
  );
}

const minCircleRadius = 8;
function circleRadius(i) {
  const a = at(i - 1);
  const b = at(i);
  const c = at(i + 1);
  const ab = Math.hypot(b.x - a.x, b.y - a.y);
  const bc = Math.hypot(c.x - b.x, c.y - b.y);
  const ca = Math.hypot(a.x - c.x, a.y - c.y);
  const area =
    Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
  return area < 1e-12 ? Infinity : (ab * bc * ca) / (4 * area);
}
for (let iteration = 0; iteration < 5000; iteration++) {
  const tight = [];
  for (let i = 0; i < n; i++)
    if (circleRadius(i) < minCircleRadius) tight.push(i);
  if (tight.length === 0) break;
  const moves = new Map();
  for (const i of tight) {
    for (let k = -2; k <= 2; k++) {
      const j = (((i + k) % n) + n) % n;
      const a = at(j - 1);
      const c = at(j + 1);
      const weight = k === 0 ? 0.5 : 0.25;
      moves.set(j, {
        x: ((a.x + c.x) / 2 - at(j).x) * weight,
        y: ((a.y + c.y) / 2 - at(j).y) * weight,
      });
    }
  }
  for (const [j, move] of moves) {
    points[j].x += move.x;
    points[j].y += move.y;
  }
}
const relaxed = Math.max(
  ...points.map((p) => Math.hypot(p.x - p.gx, p.y + p.gz)),
);

const onArc = (distance, from, to) =>
  from <= to
    ? distance >= from && distance <= to
    : distance >= from || distance <= to;
const lapDistance = (distance) =>
  ((distance % track.length) + track.length) % track.length;
const smooth = (t) => t * t * (3 - 2 * t);

function shiftAt(distance) {
  if (onArc(distance, pit.wallStart, pit.wallEnd)) return pitShift;
  const before = lapDistance(pit.wallStart - distance);
  const after = lapDistance(distance - pit.wallEnd);
  const ramp = Math.max(1 - before / pitWallRamp, 1 - after / pitWallRamp, 0);
  return pitShift * smooth(ramp);
}

function pitWallThickness(distance) {
  if (!onArc(distance, pit.garageStart, pit.garageEnd)) return pitWallThin;
  const inside = Math.min(
    lapDistance(distance - pit.garageStart),
    lapDistance(pit.garageEnd - distance),
  );
  return (
    pitWallThin +
    (pit.pitWallDeck - pitWallThin) * smooth(Math.min(inside / pitDeckRamp, 1))
  );
}

function pitZoneAt(distance) {
  if (!onArc(distance, pit.entry, pit.exit)) return null;
  return onArc(distance, pit.wallStart, pit.wallEnd) ? "wall" : "mouth";
}

const normals = points.map((_, i) => {
  const a = at(i - 1);
  const b = at(i + 1);
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  return { x: -(b.y - a.y) / length, y: (b.x - a.x) / length };
});
points.forEach((p, i) => {
  const distance = i * spacing;
  p.shift = shiftAt(distance);
  p.pitZone = pitZoneAt(distance);
  p.pitThickness = pitWallThickness(distance);
  if (p.pitZone) p.wallLeft = Math.min(p.wallLeft, pit.pitBarrier);
  p.x += normals[i].x * p.shift;
  p.y += normals[i].y * p.shift;
  p.z += p.camber * p.shift;
});

for (let i = 0; i < n; i++) {
  const prev = at(i - 1);
  const next = at(i + 1);
  const tx = next.x - prev.x;
  const ty = next.y - prev.y;
  const length = Math.hypot(tx, ty);
  points[i].tx = tx / length;
  points[i].ty = ty / length;
}

points.forEach((p, i) => {
  p.zl = p.z + p.camber * half;
  p.zr = p.z - p.camber * half;
  p.kerbLeft = kerbAt("left", i * spacing);
  p.kerbRight = kerbAt("right", i * spacing);
});

function kerbLevels(key, widthOf) {
  const reach = Math.round(kerbRamp / spacing);
  const levels = points.map((p) =>
    p[key] && widthOf(p) < kerbMaxWidening ? Infinity : 0,
  );
  for (let pass = 0; pass < 2; pass++) {
    for (let k = 0; k < 2 * n; k++) {
      const i = pass === 0 ? k % n : (2 * n - 1 - k) % n;
      const before = levels[(i + (pass === 0 ? n - 1 : 1)) % n];
      levels[i] = Math.min(levels[i], before + 1);
    }
  }
  return levels.map((level) => Math.min(level / reach, 1));
}
const widening = (p) => p.width / 2 - half;
const levelLeft = kerbLevels("kerbLeft", widening);
const levelRight = kerbLevels("kerbRight", widening);
points.forEach((p, i) => {
  p.kerbLeft = levelLeft[i];
  p.kerbRight = levelRight[i];
});

const cross = (ax, ay, bx, by) => ax * by - ay * bx;
const dot = (ax, ay, bx, by) => ax * bx + ay * by;

function arc(ax, ay, tx, ty, bx, by) {
  const cx = bx - ax;
  const cy = by - ay;
  const chord = Math.hypot(cx, cy);
  const theta = 2 * Math.atan2(cross(tx, ty, cx, cy), dot(tx, ty, cx, cy));
  if (Math.abs(theta) < 1e-7)
    return { kind: "str", length: chord, arc: 0, radius: Infinity };
  const radius = chord / (2 * Math.sin(Math.abs(theta) / 2));
  return {
    kind: theta > 0 ? "lft" : "rgt",
    length: radius * Math.abs(theta),
    arc: Math.abs(theta),
    radius,
  };
}

function biarc(p0, p1) {
  const vx = p1.x - p0.x;
  const vy = p1.y - p0.y;
  const sx = p0.tx + p1.tx;
  const sy = p0.ty + p1.ty;
  const vt = dot(vx, vy, sx, sy);
  const denominator = 2 * (1 - dot(p0.tx, p0.ty, p1.tx, p1.ty));
  let d;
  if (denominator < 1e-12) {
    const vt2 = dot(vx, vy, p1.tx, p1.ty);
    if (Math.abs(vt2) < 1e-12)
      return [arc(p0.x, p0.y, p0.tx, p0.ty, p1.x, p1.y)];
    d = dot(vx, vy, vx, vy) / (4 * vt2);
  } else {
    d =
      (-vt + Math.sqrt(vt * vt + denominator * dot(vx, vy, vx, vy))) /
      denominator;
  }
  const mx = (p0.x + p1.x + d * (p0.tx - p1.tx)) / 2;
  const my = (p0.y + p1.y + d * (p0.ty - p1.ty)) / 2;
  const first = arc(p0.x, p0.y, p0.tx, p0.ty, mx, my);
  const second = arc(p1.x, p1.y, -p1.tx, -p1.ty, mx, my);
  if (second.kind !== "str")
    second.kind = second.kind === "lft" ? "rgt" : "lft";
  return [first, second].filter((part) => part.length > 1e-6);
}

const segments = [];
for (let i = 0; i < n; i++) {
  const p0 = at(i);
  const p1 = at(i + 1);
  const parts = biarc(p0, p1);
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  let travelled = 0;
  for (const part of parts) {
    const s = travelled / total;
    const e = (travelled + part.length) / total;
    travelled += part.length;
    const lerp = (a, b, t) => a + (b - a) * t;
    segments.push({
      ...part,
      zsl: lerp(p0.zl, p1.zl, s),
      zsr: lerp(p0.zr, p1.zr, s),
      zel: lerp(p0.zl, p1.zl, e),
      zer: lerp(p0.zr, p1.zr, e),
      width: lerp(p0.width, p1.width, (s + e) / 2),
      wallLeftStart: lerp(p0.wallLeft, p1.wallLeft, s),
      wallLeftEnd: lerp(p0.wallLeft, p1.wallLeft, e),
      wallRightStart: lerp(p0.wallRight, p1.wallRight, s),
      wallRightEnd: lerp(p0.wallRight, p1.wallRight, e),
      kerbLeft: Math.min(p0.kerbLeft, p1.kerbLeft),
      kerbRight: Math.min(p0.kerbRight, p1.kerbRight),
      shift: lerp(p0.shift, p1.shift, (s + e) / 2),
      pitZone: p0.pitZone === p1.pitZone ? p0.pitZone : "mouth",
      pitThickness: lerp(p0.pitThickness, p1.pitThickness, (s + e) / 2),
    });
  }
}

const minRadius = Math.min(
  ...segments.filter((s) => s.kind !== "str").map((s) => s.radius),
);
if (minRadius <= half) {
  throw new Error(
    `biarc radius ${minRadius.toFixed(2)} m is tighter than half the track width`,
  );
}

const f = (v) => Number(v.toFixed(6)).toString();
const num = (name, value, unit) =>
  `<attnum name="${name}"${unit ? ` unit="${unit}"` : ""} val="${f(value)}"/>`;
const str = (name, value) => `<attstr name="${name}" val="${value}"/>`;

function kerbSurface(letter) {
  return `<section name="cota-kerb-${letter}">${[
    str("texture name", `tr-curb-${letter}.png`),
    str("texture type", "continuous"),
    num("texture size", 2, "m"),
    num("friction", 1.1),
    num("rolling resistance", 0.02),
    num("roughness", kerbRoughness),
    num("roughness wavelength", kerbWavelength),
  ].join("")}</section>`;
}

function grassSurface() {
  return `<section name="cota-grass">${[
    str("texture name", "tr-grass.png"),
    str("texture type", "continuous"),
    num("texture size", 2, "m"),
    num("friction", 0.4),
    num("rolling resistance", 0.08),
    num("roughness", grassRoughness),
    num("roughness wavelength", grassWavelength),
  ].join("")}</section>`;
}

function sideOf(s, isLeft) {
  return isLeft
    ? {
        kerb: s.kerbLeft,
        wallStart: s.wallLeftStart,
        wallEnd: s.wallLeftEnd,
        letter: "l",
        extra: s.width / 2 - half - s.shift,
        reach: s.shift,
        pitZone: s.pitZone,
        pitThickness: s.pitThickness,
      }
    : {
        kerb: s.kerbRight,
        wallStart: s.wallRightStart,
        wallEnd: s.wallRightEnd,
        letter: "r",
        extra: s.width / 2 - half + s.shift,
        reach: -s.shift,
        pitZone: null,
      };
}

function borderOf(edge) {
  if (edge.pitZone === "wall")
    return {
      width: edge.pitThickness,
      xml: [
        num("width", edge.pitThickness, "m"),
        num("height", pitWallHeight, "m"),
        str("surface", "barrier"),
        str("style", "wall"),
      ].join(""),
    };
  const { extra } = edge;
  const kerb = edge.kerb > 0;
  const width = Math.min(
    Math.max(extra, 0) + (kerb ? track.surfaces[0].width : track.runoff),
    Math.min(edge.wallStart, edge.wallEnd) - edge.reach - half - minSideWidth,
  );
  const style = kerb
    ? [
        num("height", kerbHeight * edge.kerb, "m"),
        str("surface", `cota-kerb-${edge.letter}`),
        str("style", "curb"),
      ]
    : [
        num("height", 0, "m"),
        str("surface", "asphalt-lines"),
        str("style", "plan"),
      ];
  return { width, xml: [num("width", width, "m"), ...style].join("") };
}

function side(name, s, isLeft) {
  const edge = sideOf(s, isLeft);
  const border = borderOf(edge);
  const sideWidth = (wall) =>
    Math.max(wall - edge.reach - half - border.width, minSideWidth);
  const surface = edge.pitZone ? "asphalt-lines" : "cota-grass";
  return [
    `<section name="${name} Border">${border.xml}</section>`,
    `<section name="${name} Side">${num("start width", sideWidth(edge.wallStart), "m")}${num("end width", sideWidth(edge.wallEnd), "m")}${str("surface", surface)}</section>`,
    `<section name="${name} Barrier">${num("width", 0.5, "m")}${num("height", 1, "m")}${str("surface", "barrier")}${str("style", "wall")}</section>`,
  ].join("");
}

const body = segments
  .map((s, index) => {
    const geometry =
      s.kind === "str"
        ? [str("type", "str"), num("lg", s.length, "m")]
        : [
            str("type", s.kind),
            num("radius", s.radius, "m"),
            num("arc", (s.arc * 180) / Math.PI, "deg"),
          ];
    return [
      `<section name="s${String(index).padStart(5, "0")}">`,
      ...geometry,
      num("z start left", s.zsl, "m"),
      num("z start right", s.zsr, "m"),
      num("z end left", s.zel, "m"),
      num("z end right", s.zer, "m"),
      str("profil", "linear"),
      side("Left", s, true),
      side("Right", s, false),
      "</section>",
    ].join("");
  })
  .join("\n");

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE params SYSTEM "../../../src/libs/tgf/params.dtd" [
<!ENTITY default-surfaces SYSTEM "../../../data/tracks/surfaces.xml">
]>
<params name="${track.id}" type="param" mode="mw">
<section name="Surfaces">
&default-surfaces;
${["l", "r"].map(kerbSurface).join("\n")}
${grassSurface()}
</section>
<section name="Header">
${str("name", track.name)}
${str("category", "circuit")}
${num("version", 4)}
${str("author", "generated from content/tracks/cota/track.json")}
</section>
<section name="Local Info">
${str("station", "KAUS")}
${num("time of day", timeOfDay, "hour")}
${num("latitude", 30.1328)}
${num("longitude", -97.6411)}
${num("altitude", 170, "m")}
${num("climat", 10)}
${num("precipitation", 860)}
</section>
<section name="Graphic">
${str("3d description", "road.glb")}
</section>
<section name="Main Track">
${num("width", width, "m")}
${str("surface", "asphalt-lines")}
<section name="Left Side">${str("banking type", "tangent")}</section>
<section name="Right Side">${str("banking type", "tangent")}</section>
${str("profil", "linear")}
<section name="Track Segments">
${body}
</section>
</section>
</params>
`;

writeFileSync(path.join(directory, `${track.id}.xml`), xml);

const start = at(0);
const frame = {
  origin: [start.x, start.z, -start.y],
  heading: Math.atan2(start.ty, start.tx),
  width,
  segments: segments.length,
  pit: {
    length: segments.reduce((sum, s) => sum + s.length, 0),
    entry: pit.entry,
    wallStart: pit.wallStart,
    wallEnd: pit.wallEnd,
    exit: pit.exit,
    pitWall: pit.pitWall,
    shift: pitShift,
    ramp: pitWallRamp,
    fastLane: pit.fastLane,
    speedLimit: pit.speedLimit,
    boxDistance: pit.boxDistance,
    boxLateral: pit.boxLateral,
  },
};
writeFileSync(
  path.join(directory, "sd-frame.json"),
  `${JSON.stringify(frame, null, 2)}\n`,
);
process.stdout.write(
  `relaxed ${relaxed.toFixed(3)} m, ${segments.length} segments, ${segments.reduce((sum, s) => sum + s.length, 0).toFixed(3)} m, min radius ${minRadius.toFixed(2)} m, kerb segments ${segments.filter((s) => s.kerbLeft || s.kerbRight).length}, widest ${Math.max(...segments.map((s) => s.width)).toFixed(1)} m\n`,
);
