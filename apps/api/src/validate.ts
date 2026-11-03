export class Invalid extends Error {
  constructor(
    message: string,
    readonly field: string,
  ) {
    super(message);
  }
}

export type Body = Record<string, unknown>;

const username = /^[A-Za-z0-9_.-]{3,24}$/;
const person = /^[\p{L}\p{M}][\p{L}\p{M} '.-]{0,23}$/u;
const slug = /^[a-z0-9-]{1,64}$/;
const country = /^[A-Z]{2}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const base64 = /^[A-Za-z0-9+/]+={0,2}$/;
const maxLapMs = 3_600_000;
const maxSectors = 10;
const sectorSumSlackMs = 10;
const maxTraceBytes = 400_000;
const passwordLength = { min: 8, max: 128 };

function matching(value: unknown, pattern: RegExp, field: string, why: string) {
  if (typeof value !== "string" || !pattern.test(value))
    throw new Invalid(why, field);
  return value;
}

export function checkUsername(value: unknown): string {
  return matching(
    value,
    username,
    "username",
    "Use 3 to 24 letters, numbers, dots, dashes or underscores.",
  );
}

export function checkPassword(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < passwordLength.min ||
    value.length > passwordLength.max
  )
    throw new Invalid("Use at least 8 characters.", "password");
  return value;
}

export function checkSlug(value: unknown, field: string): string {
  return matching(value, slug, field, `${field} is not valid.`);
}

export function checkId(value: unknown): string {
  return matching(value, uuid, "id", "id is not valid.").toLowerCase();
}

export function checkInteger(
  value: unknown,
  field: string,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isInteger(value))
    throw new Invalid(`${field} must be a whole number.`, field);
  if (value < min || value > max)
    throw new Invalid(
      `${field} must be between ${String(min)} and ${String(max)}.`,
      field,
    );
  return value;
}

export function checkDate(value: unknown, field: string): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value)))
    throw new Invalid(`${field} must be a date.`, field);
  return new Date(value).toISOString();
}

export interface Profile {
  firstName: string;
  lastName: string;
  nationality: string;
  number: number;
  team: string;
}

export function checkProfile(body: Body): Profile {
  const name = (value: unknown, field: string) =>
    matching(value, person, field, "Use up to 24 letters.").trim();
  return {
    firstName: name(body["firstName"], "firstName"),
    lastName: name(body["lastName"], "lastName"),
    nationality: matching(
      body["nationality"],
      country,
      "nationality",
      "Choose a country.",
    ),
    number: checkInteger(body["number"], "number", 1, 99),
    team: checkSlug(body["team"], "team"),
  };
}

export interface LapBody {
  timeMs: number;
  sectorsMs: (number | null)[];
  compound: string | null;
  valid: boolean;
}

function checkSectors(value: unknown, timeMs: number): (number | null)[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxSectors)
    throw new Invalid("sectorsMs must list each sector.", "sectorsMs");
  const sectors = value.map((sector: unknown) =>
    sector === null ? null : checkInteger(sector, "sectorsMs", 1, maxLapMs),
  );
  const known = sectors.filter((sector) => sector !== null);
  const sum = known.reduce((total, sector) => total + sector, 0);
  const complete = known.length === sectors.length;
  if (
    sum > timeMs + sectorSumSlackMs ||
    (complete && sum < timeMs - sectorSumSlackMs)
  )
    throw new Invalid("sectorsMs must add up to timeMs.", "sectorsMs");
  return sectors;
}

export function checkLap(body: Body): LapBody {
  const timeMs = checkInteger(body["timeMs"], "timeMs", 1, maxLapMs);
  const compound = body["compound"];
  const valid = body["valid"];
  if (valid !== undefined && typeof valid !== "boolean")
    throw new Invalid("valid must be true or false.", "valid");
  return {
    timeMs,
    sectorsMs: checkSectors(body["sectorsMs"], timeMs),
    compound:
      compound === undefined || compound === null
        ? null
        : checkSlug(compound, "compound"),
    valid: valid ?? true,
  };
}

export interface ReferenceBody {
  timeMs: number;
  sectorsMs: number[];
  trace: string;
}

export function checkReference(body: Body): ReferenceBody {
  const timeMs = checkInteger(body["timeMs"], "timeMs", 1, maxLapMs);
  const sectorsMs = checkSectors(body["sectorsMs"], timeMs);
  if (sectorsMs.includes(null))
    throw new Invalid("A reference needs every sector.", "sectorsMs");
  const trace = body["trace"];
  if (
    typeof trace !== "string" ||
    trace.length > maxTraceBytes ||
    !base64.test(trace)
  )
    throw new Invalid("trace is not valid.", "trace");
  return { timeMs, sectorsMs: sectorsMs as number[], trace };
}

export interface SessionBody {
  track: string;
  car: string;
  team: string;
  kind: "practice" | "race";
  plannedLaps: number | null;
  conditions: Record<string, unknown>;
  startedAt: string;
}

function checkKind(value: unknown): "practice" | "race" {
  if (value !== "practice" && value !== "race")
    throw new Invalid("kind must be practice or race.", "kind");
  return value;
}

function checkConditions(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Invalid("conditions must be an object.", "conditions");
  if (JSON.stringify(value).length > 2000)
    throw new Invalid("conditions is too large.", "conditions");
  return value as Record<string, unknown>;
}

export function checkSession(body: Body): SessionBody {
  const planned = body["plannedLaps"];
  return {
    track: checkSlug(body["track"], "track"),
    car: checkSlug(body["car"], "car"),
    team: checkSlug(body["team"], "team"),
    kind: checkKind(body["kind"]),
    plannedLaps:
      planned === undefined || planned === null
        ? null
        : checkInteger(planned, "plannedLaps", 1, 200),
    conditions: checkConditions(body["conditions"]),
    startedAt: checkDate(body["startedAt"], "startedAt"),
  };
}
