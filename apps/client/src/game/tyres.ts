export const compounds = [
  { id: "soft", label: "Soft", letter: "S", colour: "#ff2d2d", detail: "C4" },
  {
    id: "medium",
    label: "Medium",
    letter: "M",
    colour: "#ffd21f",
    detail: "C3",
  },
  { id: "hard", label: "Hard", letter: "H", colour: "#f4f5f8", detail: "C1" },
  {
    id: "inter",
    label: "Intermediate",
    letter: "I",
    colour: "#2fd24a",
    detail: "Light rain",
  },
  {
    id: "wet",
    label: "Wet",
    letter: "W",
    colour: "#2d8cff",
    detail: "Heavy rain",
  },
] as const;

export function compoundIndex(id: string): number {
  return Math.max(
    0,
    compounds.findIndex((c) => c.id === id),
  );
}

export function nextCompound(current: number): number {
  return current === 2 ? 1 : 2;
}

export interface WheelTyre {
  surface: number;
  carcass: number;
  pressure: number;
  wear: number;
  lock: number;
  spin: number;
  grip: number;
  flat: number;
  leak: number;
  cut: number;
  dirt: number;
  gravel: number;
  flatAt: number;
  shred: number;
  water: number;
}

export interface TyreInfo {
  compound: number;
  age: number;
  low: number;
  high: number;
  wheels: WheelTyre[];
}

const raceLapsAtAustin = 56;
const practiceScale = 4;
const maxScale = 5;

export function wearScale(mode: string, session: string, laps: number): number {
  if (mode === "off") return 0;
  if (mode === "real") return 1;
  if (session !== "race") return practiceScale;
  return Math.max(1, Math.min(maxScale, raceLapsAtAustin / Math.max(1, laps)));
}

const coolMargin = 12;
const warmMargin = 8;
const hotMargin = 22;

export function temperatureState(
  temperature: number,
  low: number,
  high: number,
): string {
  if (temperature < low - coolMargin) return "cold";
  if (temperature < low) return "cool";
  if (temperature > high + hotMargin) return "hot";
  if (temperature > high + warmMargin) return "warm";
  return "ok";
}

const wornWear = 0.7;
const criticalWear = 0.9;

export function wearState(wear: number): string {
  if (wear >= 1) return "punctured";
  if (wear >= criticalWear) return "critical";
  return wear >= wornWear ? "worn" : "ok";
}

const lockRate = 55;
const spinRate = 24;
const minSmokeSpeed = 6;
const fullRateSpeed = 40;
const puffGrowth = 1.5;

export const puffStartSize = 0.18;

export function smokeIntensity(lock: number, spin: number): number {
  return Math.max(0, Math.min(1, Math.max(lock, spin * 0.75)));
}

export function puffsPerSecond(
  lock: number,
  spin: number,
  speed: number,
): number {
  if (speed < minSmokeSpeed) return 0;
  const speedShare = Math.min(1, speed / fullRateSpeed);
  return (lock * lockRate + spin * spinRate) * speedShare;
}

export function puffPeakSize(intensity: number): number {
  return puffStartSize + puffGrowth * intensity;
}
