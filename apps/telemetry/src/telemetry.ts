const channelNames = [
  "time",
  "speed",
  "throttle",
  "brake",
  "steer",
  "lap",
  "lapDistance",
  "x",
  "y",
  "z",
] as const;

type ChannelName = (typeof channelNames)[number];

interface CarTelemetry {
  id: number;
  channels: Record<ChannelName, number[]>;
}

export interface Telemetry {
  name: string;
  hz: number;
  cars: CarTelemetry[];
  finalHash: string;
}

export class TelemetryError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSeries(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === "number" && Number.isFinite(item))
  );
}

function parseChannels(value: unknown, id: number): CarTelemetry["channels"] {
  if (!isRecord(value)) {
    throw new TelemetryError(`car ${String(id)} has no telemetry channels`);
  }
  const channels: Partial<Record<ChannelName, number[]>> = {};
  for (const name of channelNames) {
    const series = value[name];
    if (!isSeries(series)) {
      throw new TelemetryError(
        `car ${String(id)} telemetry channel ${name} is not a list of numbers`,
      );
    }
    if (series.length !== channels.time?.length && name !== "time") {
      throw new TelemetryError(
        `car ${String(id)} telemetry channel ${name} has ${String(series.length)} samples instead of ${String(channels.time?.length)}`,
      );
    }
    channels[name] = series;
  }
  return channels as CarTelemetry["channels"];
}

function parseCar(value: unknown): CarTelemetry {
  if (!isRecord(value) || typeof value["id"] !== "number") {
    throw new TelemetryError("every telemetry car needs a numeric id");
  }
  return {
    id: value["id"],
    channels: parseChannels(value["channels"], value["id"]),
  };
}

export function parseTelemetry(text: string): Telemetry {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new TelemetryError("the telemetry file is not valid JSON");
  }
  if (!isRecord(value) || typeof value["name"] !== "string") {
    throw new TelemetryError("the telemetry has no name");
  }
  const { name, hz, cars, finalHash } = value;
  if (typeof hz !== "number" || !(hz > 0)) {
    throw new TelemetryError("the telemetry sample rate must be positive");
  }
  if (!Array.isArray(cars) || cars.length === 0) {
    throw new TelemetryError("the telemetry contains no cars");
  }
  if (typeof finalHash !== "string") {
    throw new TelemetryError("the telemetry has no final hash");
  }
  return { name, hz, cars: cars.map(parseCar), finalHash };
}
