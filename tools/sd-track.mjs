import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const directory = process.argv[2] ?? "content/tracks/cota";
const track = JSON.parse(
  readFileSync(path.join(directory, "track.json"), "utf8"),
);

const width = track.width;
const half = width / 2;
const minSideWidth = 0.5;
const kerbHeight = 0.05;
const kerbMaxWidening = 0.6;

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
      kerbLeft: p0.kerbLeft || p1.kerbLeft,
      kerbRight: p0.kerbRight || p1.kerbRight,
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

function side(name, s, isLeft) {
  const widening = s.width / 2 - half;
  const kerb =
    (isLeft ? s.kerbLeft : s.kerbRight) && widening < kerbMaxWidening;
  const letter = isLeft ? "l" : "r";
  const borderWidth =
    Math.max(widening, 0) + (kerb ? track.surfaces[0].width : track.runoff);
  const border = kerb
    ? [
        num("width", borderWidth, "m"),
        num("height", kerbHeight, "m"),
        str("surface", `curb-5cm-${letter}`),
        str("style", "curb"),
      ]
    : [
        num("width", borderWidth, "m"),
        num("height", 0, "m"),
        str("surface", "asphalt-lines"),
        str("style", "plan"),
      ];
  const wallStart = isLeft ? s.wallLeftStart : s.wallRightStart;
  const wallEnd = isLeft ? s.wallLeftEnd : s.wallRightEnd;
  const sideWidth = (wall) => Math.max(wall - half - borderWidth, minSideWidth);
  return [
    `<section name="${name} Border">${border.join("")}</section>`,
    `<section name="${name} Side">${num("start width", sideWidth(wallStart), "m")}${num("end width", sideWidth(wallEnd), "m")}${str("surface", "grass")}</section>`,
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
</section>
<section name="Header">
${str("name", track.name)}
${str("category", "circuit")}
${num("version", 4)}
${str("author", "generated from content/tracks/cota/track.json")}
</section>
<section name="Local Info">
${str("station", "KAUS")}
${num("time of day", 14, "hour")}
${num("latitude", 30.1328)}
${num("longitude", -97.6411)}
${num("altitude", 170, "m")}
${num("climat", 10)}
${num("precipitation", 860)}
</section>
<section name="Graphic">
${str("3d description", `${track.id}.glb`)}
</section>
<section name="Main Track">
${num("width", width, "m")}
${str("surface", "asphalt-lines")}
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
};
writeFileSync(
  path.join(directory, "sd-frame.json"),
  `${JSON.stringify(frame, null, 2)}\n`,
);
process.stdout.write(
  `relaxed ${relaxed.toFixed(3)} m, ${segments.length} segments, ${segments.reduce((sum, s) => sum + s.length, 0).toFixed(3)} m, min radius ${minRadius.toFixed(2)} m, kerb segments ${segments.filter((s) => s.kerbLeft || s.kerbRight).length}, widest ${Math.max(...segments.map((s) => s.width)).toFixed(1)} m\n`,
);
