import { nominalFuelPerLap } from "./energy.ts";
import { ParamDoc, type ParamFs } from "./params.ts";
import { teams } from "./teams.ts";

const physicsCar = "22mp1-sector-mcl36";

export const tracks = [
  {
    id: "cota",
    label: "Circuit of the Americas",
    detail: "Austin · 5.48 km",
    category: "circuit",
    length: 5528,
  },
] as const;

export const cars = teams.map((team) => ({
  id: team.id,
  label: team.name,
  detail: "2026 regulations",
  car: physicsCar,
}));

export const choices = {
  tyreWear: [
    { id: "off", label: "Off" },
    { id: "real", label: "Real Life" },
    { id: "scaled", label: "Race Length" },
  ],
  session: [
    { id: "practice", label: "Practice" },
    { id: "race", label: "Race" },
  ],
  timeOfDay: [
    { id: "dawn", label: "Dawn" },
    { id: "morning", label: "Morning" },
    { id: "noon", label: "Noon" },
    { id: "afternoon", label: "Afternoon" },
    { id: "dusk", label: "Dusk" },
    { id: "night", label: "Night" },
    { id: "now", label: "Now" },
    { id: "from track", label: "Circuit" },
    { id: "random", label: "Random" },
  ],
  clouds: [
    { id: "no cloud", label: "Clear" },
    { id: "few clouds", label: "Few" },
    { id: "scarce clouds", label: "Scarce" },
    { id: "many clouds", label: "Many" },
    { id: "full cover", label: "Overcast" },
    { id: "random", label: "Random" },
  ],
  rain: [
    { id: "none", label: "Dry" },
    { id: "little", label: "Light" },
    { id: "medium", label: "Medium" },
    { id: "heavy", label: "Heavy" },
    { id: "random", label: "Random" },
  ],
  season: [
    { id: "now", label: "Now" },
    { id: "from track", label: "Circuit" },
    { id: "spring", label: "Spring" },
    { id: "summer", label: "Summer" },
    { id: "autumn", label: "Autumn" },
    { id: "winter", label: "Winter" },
  ],
  pitExperience: [
    { id: "immersive", label: "Immersive" },
    { id: "broadcast", label: "Broadcast" },
  ],
  racingLine: [
    { id: "full", label: "Full" },
    { id: "corners", label: "Corners Only" },
    { id: "off", label: "Off" },
  ],
  transmission: [
    { id: "auto", label: "Automatic" },
    { id: "sequential", label: "Sequential (E up · Q down)" },
  ],
} as const;

type ChoiceId<K extends keyof typeof choices> =
  (typeof choices)[K][number]["id"];

export interface Settings {
  track: string;
  car: string;
  session: ChoiceId<"session">;
  buildUp: boolean;
  laps: number;
  fuel: number;
  compound: string;
  tyreWear: ChoiceId<"tyreWear">;
  ersMode: number;
  fuelMix: number;
  ersAssist: boolean;
  straightAssist: boolean;
  timeOfDay: ChoiceId<"timeOfDay">;
  clouds: ChoiceId<"clouds">;
  rain: ChoiceId<"rain">;
  season: ChoiceId<"season">;
  transmission: ChoiceId<"transmission">;
  racingLine: ChoiceId<"racingLine">;
  autoReverse: boolean;
  assist: boolean;
  antiLock: boolean;
  pitExperience: ChoiceId<"pitExperience">;
  abs: boolean;
  tc: boolean;
  steerSensitivity: number;
  steerSpeedSensitivity: number;
  steerDeadZone: number;
  setup: Record<string, Record<string, number>>;
  hud: Record<HudPart, boolean>;
}

export const hudParts = {
  delta: "Delta Time",
  sectors: "Sector Times",
  map: "Track Map",
  lights: "Start Lights",
  fuel: "Battery & Fuel",
  tyres: "Tyres (MFD)",
  inputs: "Pedal Inputs",
  help: "Button Prompts",
} as const;

export type HudPart = keyof typeof hudParts;

const practiceFuelLaps = 10;

export const defaults: Settings = {
  track: "cota",
  car: "vanta",
  session: "practice",
  buildUp: true,
  laps: 5,
  fuel: 0,
  compound: "medium",
  tyreWear: "scaled",
  ersMode: 1,
  fuelMix: 1,
  ersAssist: false,
  straightAssist: true,
  timeOfDay: "from track",
  clouds: "scarce clouds",
  rain: "none",
  season: "now",
  transmission: "auto",
  racingLine: "full",
  autoReverse: true,
  assist: true,
  antiLock: false,
  pitExperience: "immersive",
  abs: true,
  tc: true,
  steerSensitivity: 0.6,
  steerSpeedSensitivity: 0.7,
  steerDeadZone: 0,
  setup: {},
  hud: {
    delta: true,
    sectors: true,
    map: true,
    lights: true,
    fuel: true,
    tyres: true,
    inputs: true,
    help: true,
  },
};

const storageKey = "f1.settings";

function storedSettings(): Partial<Settings> {
  try {
    return JSON.parse(
      localStorage.getItem(storageKey) ?? "{}",
    ) as Partial<Settings>;
  } catch {
    return {};
  }
}

export function loadSettings(params: URLSearchParams): Settings {
  const stored = storedSettings();
  const settings: Settings = {
    ...defaults,
    ...stored,
    hud: { ...defaults.hud, ...stored.hud },
    setup: { ...stored.setup },
  };
  applyUrl(settings, params);
  if (!tracks.some((t) => t.id === settings.track))
    settings.track = defaults.track;
  if (!cars.some((c) => c.id === settings.car)) settings.car = defaults.car;
  return settings;
}

function applyUrl(settings: Settings, params: URLSearchParams): void {
  const track = params.get("track");
  if (track && tracks.some((t) => t.id === track)) settings.track = track;
  const team = params.get("team");
  if (team && cars.some((c) => c.id === team)) settings.car = team;
}

export function autoFuelLaps(settings: Settings): number {
  return settings.session === "race" ? settings.laps + 1 : practiceFuelLaps + 1;
}

function startFuel(settings: Settings): number {
  return settings.fuel > 0
    ? settings.fuel
    : autoFuelLaps(settings) * nominalFuelPerLap;
}

export function saveSettings(settings: Settings): void {
  localStorage.setItem(storageKey, JSON.stringify(settings));
}

export function carOf(settings: Settings): (typeof cars)[number] {
  const car = cars.find((c) => c.id === settings.car) ?? cars[0];
  if (!car) throw new Error("no teams defined");
  return car;
}

export function trackOf(settings: Settings): (typeof tracks)[number] {
  return tracks.find((t) => t.id === settings.track) ?? tracks[0];
}

interface SetupSpec {
  id: string;
  group: string;
  label: string;
  sections: string[];
  name: string;
  signs?: number[];
  step: number;
  range?: [number, number];
  scale?: number;
  unit?: string;
}

const corners = (axle: "Front" | "Rear", part: string) => [
  `${axle} Right ${part}`,
  `${axle} Left ${part}`,
];

interface AxlePart {
  key: string;
  group: string;
  label: string;
  part: "Wheel" | "Suspension" | "Anti-Roll Bar" | "Heave Spring";
  name: string;
  step: number;
  unit?: string;
  toe?: boolean;
}

const axleParts: AxlePart[] = [
  {
    key: "camber",
    group: "Suspension Geometry",
    label: "Camber",
    part: "Wheel",
    name: "camber",
    step: 0.1,
    unit: "deg",
  },
  {
    key: "toe",
    group: "Suspension Geometry",
    label: "Toe",
    part: "Wheel",
    name: "toe",
    step: 0.05,
    toe: true,
  },
  {
    key: "spring",
    group: "Suspension",
    label: "Suspension",
    part: "Suspension",
    name: "spring",
    step: 1,
  },
  {
    key: "arb",
    group: "Suspension",
    label: "Anti-Roll Bar",
    part: "Anti-Roll Bar",
    name: "spring",
    step: 0.5,
  },
  {
    key: "heave",
    group: "Suspension",
    label: "Heave Spring",
    part: "Heave Spring",
    name: "spring",
    step: 5,
  },
  {
    key: "height",
    group: "Suspension",
    label: "Ride Height",
    part: "Wheel",
    name: "ride height",
    step: 1,
  },
  {
    key: "packers",
    group: "Suspension",
    label: "Packers",
    part: "Suspension",
    name: "packers",
    step: 0.5,
  },
  {
    key: "slow-bump",
    group: "Suspension",
    label: "Slow Bump",
    part: "Suspension",
    name: "slow bump",
    step: 0.25,
  },
  {
    key: "slow-rebound",
    group: "Suspension",
    label: "Slow Rebound",
    part: "Suspension",
    name: "slow rebound",
    step: 0.25,
  },
  {
    key: "fast-bump",
    group: "Suspension",
    label: "Fast Bump",
    part: "Suspension",
    name: "fast bump",
    step: 0.25,
  },
  {
    key: "fast-rebound",
    group: "Suspension",
    label: "Fast Rebound",
    part: "Suspension",
    name: "fast rebound",
    step: 0.25,
  },
  {
    key: "pressure",
    group: "Tyres",
    label: "Tyre Pressure",
    part: "Wheel",
    name: "pressure",
    step: 0.5,
  },
];

const axleSpecs: SetupSpec[] = axleParts.flatMap((part) =>
  (["Front", "Rear"] as const).map((axle) => {
    const key = axle.toLowerCase();
    const single =
      part.part === "Anti-Roll Bar" || part.part === "Heave Spring";
    return {
      id: `${key}-${part.key}`,
      group: part.group,
      label: `${axle} ${part.label}`,
      sections: single ? [`${axle} ${part.part}`] : corners(axle, part.part),
      name: part.name,
      step: part.step,
      ...(part.unit ? { unit: part.unit } : {}),
      ...(part.toe ? { signs: axle === "Front" ? [1, -1] : [1, 1] } : {}),
    };
  }),
);

const setupSpecs: SetupSpec[] = [
  {
    id: "front-wing",
    group: "Aerodynamics",
    label: "Front Wing Aero",
    sections: ["Front Wing"],
    name: "angle",
    step: 0.5,
  },
  {
    id: "rear-wing",
    group: "Aerodynamics",
    label: "Rear Wing Aero",
    sections: ["Rear Wing"],
    name: "angle",
    step: 0.5,
  },
  {
    id: "final-drive",
    group: "Transmission",
    label: "Final Drive",
    sections: ["Rear Differential"],
    name: "ratio",
    step: 0.01,
    range: [2.5, 5.5],
  },
  ...[1, 2, 3, 4, 5, 6, 7].map((gear) => ({
    id: `gear-${String(gear)}`,
    group: "Transmission",
    label: `Gear ${String(gear)}`,
    sections: [`Gearbox/gears/${String(gear)}`],
    name: "ratio",
    step: 0.01,
    range: [0.5, 4.5] as [number, number],
  })),
  ...axleSpecs,
  {
    id: "brake-pressure",
    group: "Brakes",
    label: "Brake Pressure",
    sections: ["Brake System"],
    name: "max pressure",
    step: 500,
    range: [10000, 60000],
  },
  {
    id: "brake-bias",
    group: "Brakes",
    label: "Front Brake Bias",
    sections: ["Brake System"],
    name: "front-rear brake repartition",
    step: 0.005,
    scale: 100,
    unit: "%",
  },
  {
    id: "steer-lock",
    group: "Suspension Geometry",
    label: "Steering Lock",
    sections: ["Steer"],
    name: "steer lock",
    step: 0.5,
  },
  {
    id: "steer-speed",
    group: "Suspension Geometry",
    label: "Max Steering Speed",
    sections: ["Steer"],
    name: "max steer speed",
    step: 5,
    range: [60, 360],
  },
];

export interface SetupItem {
  id: string;
  group: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  scale: number;
  base: number;
  write: (doc: ParamDoc, value: number) => void;
}

function setupPath(car: string): string {
  return `/sd/local/drivers/human/cars/${car}/default.xml`;
}

export interface SetupSource {
  fs: ParamFs;
  limits(
    car: string,
    path: string,
    key: string,
    unit: string,
  ): { value: number; min: number; max: number } | null;
}

export function readSetup(source: SetupSource, car: string): SetupItem[] {
  const model = ParamDoc.read(
    source.fs,
    `/sd/data/cars/models/${car}/${car}.xml`,
  );
  if (!model) return [];
  const local = ParamDoc.read(source.fs, setupPath(car));
  return setupSpecs.flatMap((spec) => {
    const first = spec.sections[0] ?? "";
    const unit = model.num(first, spec.name)?.unit ?? "";
    const merged = source.limits(car, first, spec.name, unit);
    if (!merged || merged.min >= merged.max) return [];
    return [setupItem(spec, unit, merged, local?.num(first, spec.name)?.value)];
  });
}

function setupItem(
  spec: SetupSpec,
  unit: string,
  merged: { value: number; min: number; max: number },
  local: number | undefined,
): SetupItem {
  const sign = spec.signs?.[0] ?? 1;
  const low = Math.min(merged.min * sign, merged.max * sign);
  const high = Math.max(merged.min * sign, merged.max * sign);
  const base = Math.max(low, Math.min(high, (local ?? merged.value) * sign));
  return {
    id: spec.id,
    group: spec.group,
    label: spec.label,
    unit: spec.unit ?? unit,
    min: Math.max(low, spec.range?.[0] ?? low),
    max: Math.min(high, spec.range?.[1] ?? high),
    step: spec.step,
    scale: spec.scale ?? 1,
    base,
    write: (doc, v) => {
      spec.sections.forEach((section, i) => {
        doc.setNum(section, spec.name, v * (spec.signs?.[i] ?? 1), unit);
      });
    },
  };
}

const prefsPath = "/sd/local/drivers/human/preferences.xml";
const racePath = "/sd/local/config/raceman/quickrace.xml";

export function applySettings(source: SetupSource, settings: Settings): void {
  const fs = source.fs;
  const car = carOf(settings).car;

  const race = ParamDoc.read(fs, racePath);
  if (!race) throw new Error("quickrace.xml is missing");
  race.setNum(
    "Quick Race",
    "laps",
    settings.session === "race" ? settings.laps : practiceFuelLaps,
  );
  race.setStr("Quick Race", "time of day", settings.timeOfDay);
  race.setStr("Quick Race", "clouds", settings.clouds);
  race.setStr("Quick Race", "rain", settings.rain);
  race.setStr("Quick Race", "season", settings.season);
  race.setStr("Quick Race", "weather", "config");
  race.write(fs, racePath);

  const prefs = ParamDoc.read(fs, prefsPath);
  if (!prefs) throw new Error("preferences.xml is missing");
  const driver = "Preferences/Drivers/1";
  const yes = (on: boolean) => (on ? "yes" : "no");
  prefs.setStr(driver, "transmission", settings.transmission);
  prefs.setStr(driver, "auto reverse", yes(settings.autoReverse));
  prefs.setStr(driver, "ABS on", yes(settings.abs));
  prefs.setStr(driver, "ASR on", yes(settings.tc));
  prefs.setStr(driver, "up shift", "e");
  prefs.setStr(driver, "down shift", "q");
  prefs.setNum(driver, "steer sensitivity", settings.steerSensitivity);
  prefs.setNum(
    driver,
    "steer speed sensitivity",
    settings.steerSpeedSensitivity,
  );
  prefs.setNum(driver, "steer dead zone", settings.steerDeadZone);
  prefs.write(fs, prefsPath);

  const setup = ParamDoc.read(fs, setupPath(car)) ?? ParamDoc.empty(car);
  const chosen = settings.setup[car] ?? {};
  for (const item of readSetup(source, car)) {
    const value = chosen[item.id];
    if (value !== undefined) item.write(setup, value);
  }
  setup.setNum("Car", "initial fuel", startFuel(settings), "l");
  setup.write(fs, setupPath(car));
}
