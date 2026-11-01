export const ersModes = [
  { id: "none", label: "None" },
  { id: "medium", label: "Medium" },
  { id: "hotlap", label: "Hotlap" },
  { id: "boost", label: "Boost" },
] as const;

export const fuelMixes = [
  { id: "lean", label: "Lean" },
  { id: "standard", label: "Standard" },
  { id: "rich", label: "Rich" },
  { id: "max", label: "Max" },
] as const;

export const boostMode = 3;
export const nominalFuelPerLap = 1.35;

export interface EnergyInfo {
  battery: number;
  capacity: number;
  harvested: number;
  harvestLimit: number;
  deployed: number;
  motorPower: number;
  icePower: number;
  mode: number;
  fuelMix: number;
  overtakeActive: boolean;
  overtakeArmed: boolean;
  lastLapFuel: number;
  brakeBias: number;
  straightMode: number;
  differential: number;
  straightArmed: boolean;
}

export function nextErsMode(mode: number, previous: number): number {
  const base = mode === boostMode ? previous : mode;
  return (base + 1) % boostMode;
}

export function toggleBoost(mode: number, previous: number): number {
  return mode === boostMode ? previous : boostMode;
}

export function fuelBurnPerLap(lastLap: number): number {
  return lastLap > 0.2 ? lastLap : nominalFuelPerLap;
}

export function fuelLapsDelta(
  fuel: number,
  perLap: number,
  lapsRemaining: number,
): number {
  return fuel / Math.max(0.01, perLap) - lapsRemaining;
}

const overtakeWindow = 1;
const detectionShare = 0.94;

export function detectionPoint(length: number): number {
  return length * detectionShare;
}

export class OvertakeDetector {
  private last = 0;
  private readonly at: number;

  constructor(length: number) {
    this.at = detectionPoint(length);
  }

  crossing(distance: number, gapAhead: number | null): boolean {
    const crossed = this.last < this.at && distance >= this.at;
    this.last = distance;
    return (
      crossed && gapAhead !== null && gapAhead > 0 && gapAhead <= overtakeWindow
    );
  }
}
