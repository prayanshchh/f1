import { readFileSync, writeFileSync } from "node:fs";

const half = 7;
const surfaces = {
  road: { texture: "ja-asphalt.png", along: 38.7 },
  border: { texture: "ja-asphalt-grass.png", along: 5 },
  curb: { texture: "cota-curb.png", along: 2, across: 2 },
  grass: { texture: "ja-grass.png", along: 9, across: 5.8 },
  barrier: { texture: "tr-barrier.png", along: 10.4 },
};

function attr(block, name) {
  const match = new RegExp(`name="${name}"[^>]*val="([^"]*)"`).exec(block);
  return match ? match[1] : undefined;
}

function sideOf(block, side) {
  const section = (name) =>
    new RegExp(`<section name="${side} ${name}">(.*?)</section>`).exec(
      block,
    )?.[1] ?? "";
  const border = section("Border");
  const barrier = section("Barrier");
  return {
    border: Number(attr(border, "width") ?? 0),
    curb: (attr(border, "surface") ?? "").startsWith("curb"),
    side: Number(attr(section("Side"), "width") ?? 0),
    wall: Number(attr(barrier, "width") ?? 0),
    wallHeight: Number(attr(barrier, "height") ?? 0),
  };
}

function parseSegments(xml) {
  const segments = [];
  let start = 0;
  for (const match of xml.matchAll(
    /<section name="s\d+">(.*?)<\/section>\n/g,
  )) {
    const block = match[1] ?? "";
    const type = attr(block, "type");
    const length =
      type === "str"
        ? Number(attr(block, "lg"))
        : (Number(attr(block, "radius")) *
            Number(attr(block, "arc")) *
            Math.PI) /
          180;
    segments.push({
      start,
      length,
      left: sideOf(block, "Left"),
      right: sideOf(block, "Right"),
    });
    start += length;
  }
  return segments;
}

class Strip {
  constructor(flags = "0x10") {
    this.flags = flags;
  }

  vertices = [];
  faces = [];

  quad(a, b, c, d) {
    const base = this.vertices.length;
    this.vertices.push(a, b, c, d);
    this.faces.push([base, base + 1, base + 2], [base, base + 2, base + 3]);
  }
}

function acObject(name, texture, strip) {
  const lines = [
    `OBJECT poly`,
    `name "${name}"`,
    `texture "${texture}"`,
    `crease 45.000000`,
    `numvert ${String(strip.vertices.length)}`,
  ];
  for (const v of strip.vertices)
    lines.push(`${v.x.toFixed(3)} ${v.z.toFixed(3)} ${(-v.y).toFixed(3)}`);
  lines.push(`numsurf ${String(strip.faces.length)}`);
  for (const face of strip.faces) {
    lines.push(`SURF ${strip.flags}`, "mat 0", "refs 3");
    for (const i of face) {
      const v = strip.vertices[i];
      lines.push(`${String(i)} ${v.u.toFixed(4)} ${v.v.toFixed(4)}`);
    }
  }
  lines.push("kids 0");
  return lines.join("\n");
}

export async function buildCotaMesh(modulePath, trackXml, outFile) {
  globalThis.navigator ??= { getGamepads: () => [] };
  const { default: create } = await import(modulePath);
  const module = await create({
    print: () => undefined,
    printErr: () => undefined,
  });
  const init = module.cwrap("sdInit", "number", [
    "string",
    "string",
    "string",
    "string",
    "number",
  ]);
  if (init("circuit", "cota", "config/raceman/quickrace.xml", "", 0) !== 0)
    throw new Error("COTA failed to load");
  const out = module._malloc(12);
  const point = (distance, toMiddle, lift = 0) => {
    module._sdTrackLocal2Global(distance, toMiddle, out);
    const p = new Float32Array(module.HEAPF32.buffer, out, 3);
    return { x: p[0] ?? 0, y: p[1] ?? 0, z: (p[2] ?? 0) + lift };
  };
  const segments = parseSegments(readFileSync(trackXml, "utf8"));
  const strips = {
    road: new Strip(),
    border: new Strip(),
    curb: new Strip(),
    grass: new Strip(),
    barrier: new Strip("0x30"),
  };
  const uv = (p, u, v) => ({ ...p, u, v });

  for (const seg of segments) {
    const s0 = seg.start + 1e-3;
    const s1 = seg.start + seg.length - 1e-3;
    const band = (strip, surface, inner, outer, sign, vInner, vOuter) => {
      const a0 = point(s0, sign * inner);
      const b0 = point(s0, sign * outer);
      const a1 = point(s1, sign * inner);
      const b1 = point(s1, sign * outer);
      const u0 = seg.start / surface.along;
      const u1 = (seg.start + seg.length) / surface.along;
      const quad = [
        uv(a0, u0, vInner),
        uv(b0, u0, vOuter),
        uv(b1, u1, vOuter),
        uv(a1, u1, vInner),
      ];
      strip.quad(...(sign > 0 ? [quad[0], quad[3], quad[2], quad[1]] : quad));
    };
    const r0 = point(s0, -half);
    const l0 = point(s0, half);
    const r1 = point(s1, -half);
    const l1 = point(s1, half);
    const u0 = seg.start / surfaces.road.along;
    const u1 = (seg.start + seg.length) / surfaces.road.along;
    strips.road.quad(
      uv(r0, u0, 0),
      uv(r1, u1, 0),
      uv(l1, u1, 1),
      uv(l0, u0, 1),
    );

    for (const [sign, side] of [
      [1, seg.left],
      [-1, seg.right],
    ]) {
      const borderOuter = half + side.border;
      if (side.curb)
        band(
          strips.curb,
          surfaces.curb,
          half,
          borderOuter,
          sign,
          0,
          side.border / surfaces.curb.across,
        );
      else band(strips.border, surfaces.border, half, borderOuter, sign, 0, 1);
      const grassOuter = borderOuter + side.side;
      band(
        strips.grass,
        surfaces.grass,
        borderOuter,
        grassOuter,
        sign,
        0,
        side.side / surfaces.grass.across,
      );
      if (side.wall > 0 && side.wallHeight > 0) {
        const wallOuter = grassOuter + side.wall;
        const ua = seg.start / surfaces.barrier.along;
        const ub = (seg.start + seg.length) / surfaces.barrier.along;
        const face = (inner, outer, innerLift, outerLift, vInner, vOuter) => {
          const a0 = point(s0, sign * inner, innerLift);
          const b0 = point(s0, sign * outer, outerLift);
          const a1 = point(s1, sign * inner, innerLift);
          const b1 = point(s1, sign * outer, outerLift);
          const quad = [
            uv(a0, ua, vInner),
            uv(b0, ua, vOuter),
            uv(b1, ub, vOuter),
            uv(a1, ub, vInner),
          ];
          strips.barrier.quad(
            ...(sign > 0 ? quad : [quad[0], quad[3], quad[2], quad[1]]),
          );
        };
        face(grassOuter, grassOuter, 0, side.wallHeight, 0, 1);
        face(grassOuter, wallOuter, side.wallHeight, side.wallHeight, 1, 1);
        face(wallOuter, wallOuter, side.wallHeight, 0, 1, 0);
      }
    }
  }

  const objects = Object.entries(strips)
    .filter(([, strip]) => strip.faces.length > 0)
    .map(([name, strip]) => acObject(name, surfaces[name].texture, strip));
  const header = [
    "AC3Db",
    'MATERIAL "track" rgb 1 1 1  amb 1 1 1  emis 0 0 0  spec 0 0 0  shi 0  trans 0',
    "OBJECT world",
    `kids ${String(objects.length)}`,
  ];
  writeFileSync(outFile, `${header.join("\n")}\n${objects.join("\n")}\n`);
  return {
    segments: segments.length,
    length: segments.at(-1).start + segments.at(-1).length,
    trackLength: module._sdTrackLength(),
  };
}
