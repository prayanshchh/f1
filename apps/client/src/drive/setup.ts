import trackUrl from "../../../../content/tracks/ridgewater/track.json?url";
import type { TrackData, Vec3, WorldSetup } from "../contracts/index.ts";

function invalid(): never {
  throw new Error("The track file is not a valid track");
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
function point(value: unknown): Vec3 {
  if (
    !record(value) ||
    typeof value["x"] !== "number" ||
    typeof value["y"] !== "number" ||
    typeof value["z"] !== "number"
  )
    return invalid();
  return { x: value["x"], y: value["y"], z: value["z"] };
}
export async function loadTrack(): Promise<TrackData> {
  const response = await fetch(trackUrl);
  if (!response.ok)
    throw new Error(
      `could not load the track: HTTP ${String(response.status)}`,
    );
  const value: unknown = await response.json();
  if (
    !record(value) ||
    typeof value["name"] !== "string" ||
    typeof value["width"] !== "number" ||
    !Array.isArray(value["centerline"])
  )
    return invalid();
  const points: unknown[] = value["centerline"];
  return {
    name: value["name"],
    width: value["width"],
    centerline: points.map(point),
  };
}
export function driveSetup(query: string, track: TrackData): WorldSetup {
  const start = new URLSearchParams(query).get("start");
  const startDistance = start === null ? 0 : Number(start);
  if (
    start?.trim() === "" ||
    !Number.isFinite(startDistance) ||
    startDistance < 0
  )
    throw new Error(
      `Unknown start distance: ${String(start)}. Choose metres from 0 to the lap length.`,
    );
  return { track, cars: [{ id: 0, startDistance }] };
}
