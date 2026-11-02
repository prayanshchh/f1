import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const bayRows = 14;
const firstFreeBay = 2;

function section(name, values) {
  return `${name} ${String(values.length)}\n${values.join(" ")}\n`;
}

function kerbMask(track, side, count) {
  const step = track.length / count;
  const mask = new Array(count).fill(0);
  for (const surface of track.surfaces) {
    if (surface.kind !== "kerb" || surface.side !== side) continue;
    for (let i = 0; i < count; i++) {
      const d = i * step;
      const inside =
        surface.from <= surface.to
          ? d >= surface.from && d <= surface.to
          : d >= surface.from || d <= surface.to;
      if (inside) mask[i] = surface.width;
    }
  }
  return mask;
}

export function writeTrackData(root, target) {
  const directory = path.join(root, "content/tracks/cota");
  const read = (file) =>
    JSON.parse(readFileSync(path.join(directory, file), "utf8"));
  const track = read("track.json");
  const line = read("racing-line.json");
  const frame = read("sd-frame.json");
  const calibration = read("ai-calibration.json");
  const centre = track.centerline;
  const pit = track.pitLane;
  const span =
    ((pit.garageEnd - pit.garageStart) % track.length) + track.length;
  const wrapped = span % track.length;
  const bays = Math.floor(wrapped / bayRows);
  const spacing = wrapped / bays;
  const body = [
    section("frame", [...frame.origin, frame.heading]),
    section("line_x", line.x),
    section("line_z", line.z),
    section("line_speed", line.profile.speed),
    section(
      "centre_x",
      centre.map((c) => c.x),
    ),
    section(
      "centre_z",
      centre.map((c) => c.z),
    ),
    section(
      "centre_width",
      centre.map((c) => c.width),
    ),
    section("kerb_left", kerbMask(track, "left", centre.length)),
    section("kerb_right", kerbMask(track, "right", centre.length)),
    section(
      "pit_x",
      pit.centerline.map((c) => c.x),
    ),
    section(
      "pit_z",
      pit.centerline.map((c) => c.z),
    ),
    section("pit", [
      frame.pit.entry,
      frame.pit.wallStart,
      frame.pit.wallEnd,
      frame.pit.exit,
      frame.pit.pitWall,
      frame.pit.shift,
      frame.pit.ramp,
      frame.pit.fastLane,
      frame.pit.speedLimit,
      frame.pit.boxLateral,
      pit.garageStart,
      spacing,
      firstFreeBay,
    ]),
    section(
      "grid_distance",
      track.grid.map((g) => g.distance),
    ),
    section(
      "grid_offset",
      track.grid.map((g) => g.offset),
    ),
    section("gain", calibration.gain),
  ];
  writeFileSync(target, body.join(""));
}
