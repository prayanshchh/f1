export interface Livery {
  id: string;
  name: string;
  primary: string;
  secondary: string;
  accent: string;
  number: number;
}

export interface LiveryMask {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

const fields = ["accent", "id", "name", "number", "primary", "secondary"];
const idPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const colourPattern = /^#[0-9a-f]{6}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== "string") {
    throw new Error(`livery ${field} must be a string`);
  }
  return value;
}

function colour(record: Record<string, unknown>, field: string): string {
  const value = text(record, field);
  if (!colourPattern.test(value)) {
    throw new Error(`livery ${field} must be a lower-case #rrggbb colour`);
  }
  return value;
}

export function parseLivery(value: unknown): Livery {
  if (!isRecord(value)) {
    throw new Error("a livery must be an object");
  }
  const keys = Object.keys(value).sort();
  if (keys.join(",") !== fields.join(",")) {
    throw new Error(
      `a livery must have exactly the fields ${fields.join(", ")}`,
    );
  }
  const id = text(value, "id");
  if (!idPattern.test(id)) {
    throw new Error("livery id must be lower-case words joined by hyphens");
  }
  const name = text(value, "name");
  if (name.trim() === "") {
    throw new Error("livery name must not be empty");
  }
  const number = value["number"];
  if (
    typeof number !== "number" ||
    !Number.isInteger(number) ||
    number < 1 ||
    number > 99
  ) {
    throw new Error("livery number must be a whole number from 1 to 99");
  }
  return {
    id,
    name,
    primary: colour(value, "primary"),
    secondary: colour(value, "secondary"),
    accent: colour(value, "accent"),
    number,
  };
}

function channels(hex: string): [number, number, number] {
  return [1, 3, 5].map((start) =>
    Number.parseInt(hex.slice(start, start + 2), 16),
  ) as [number, number, number];
}

function checkMask({ width, height, data }: LiveryMask): void {
  const sized =
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width > 0 &&
    height > 0;
  if (!sized || data.length !== width * height * 4) {
    throw new Error("mask data must hold width × height RGBA pixels");
  }
}

export function paintLivery(
  mask: LiveryMask,
  livery: Livery,
): Uint8ClampedArray {
  checkMask(mask);
  const { data } = mask;
  const [pr, pg, pb] = channels(livery.primary);
  const [sr, sg, sb] = channels(livery.secondary);
  const [ar, ag, ab] = channels(livery.accent);
  const painted = new Uint8ClampedArray(data.length);
  for (let offset = 0; offset < data.length; offset += 4) {
    const r = data[offset] ?? 0;
    const g = data[offset + 1] ?? 0;
    const b = data[offset + 2] ?? 0;
    painted[offset] = Math.round((pr * r + sr * g + ar * b) / 255);
    painted[offset + 1] = Math.round((pg * r + sg * g + ag * b) / 255);
    painted[offset + 2] = Math.round((pb * r + sb * g + ab * b) / 255);
    painted[offset + 3] = data[offset + 3] ?? 0;
  }
  return painted;
}
