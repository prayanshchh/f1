interface TyreReading {
  temperature: number;
  wear: number;
}

export interface HudFrame {
  speed: number | null;
  gear: number | null;
  rpm: number | null;
  energy: { charge: number; deploying: boolean; harvesting: boolean } | null;
  tyres: TyreReading[] | null;
  delta: number | null;
  lap: { current: number; total: number } | null;
}

const missing = "—";

function within(value: number, minimum: number, maximum: number): void {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError("HUD reading is outside its valid range");
  }
}

function integer(value: number, minimum: number, maximum: number): void {
  within(value, minimum, maximum);
  if (!Number.isInteger(value)) {
    throw new RangeError("HUD reading must be an integer");
  }
}

function whole(value: number | null, scale = 1): string {
  if (value === null) {
    return missing;
  }
  within(value, 0, Number.MAX_VALUE / scale);
  return String(Math.round(value * scale));
}

function gearText(gear: number | null): string {
  if (gear === null) {
    return missing;
  }
  integer(gear, -1, 8);
  if (gear === -1) {
    return "R";
  }
  return gear === 0 ? "N" : String(gear);
}

function energyText(energy: HudFrame["energy"]): string {
  if (energy === null) {
    return missing;
  }
  within(energy.charge, 0, 1);
  if (
    typeof energy.deploying !== "boolean" ||
    typeof energy.harvesting !== "boolean"
  ) {
    throw new RangeError("Energy modes must be booleans");
  }
  return `${whole(energy.charge, 100)}%`;
}

function tyreText(tyre: TyreReading) {
  within(tyre.temperature, -Number.MAX_VALUE, Number.MAX_VALUE);
  within(tyre.wear, 0, 1);
  const degrees = Math.round(tyre.temperature);
  const state = degrees < 80 ? "cold" : degrees > 110 ? "hot" : "optimal";
  return {
    temperature: `${String(degrees)}°C`,
    wear: `${whole(tyre.wear, 100)}%`,
    state,
  };
}

function tyresText(tyres: HudFrame["tyres"]) {
  if (tyres === null) {
    return Array.from({ length: 4 }, () => ({
      temperature: missing,
      wear: missing,
      state: "unknown",
    }));
  }
  if (tyres.length !== 4) {
    throw new RangeError("The HUD needs exactly four tyres");
  }
  return tyres.map(tyreText);
}

function deltaText(delta: number | null) {
  if (delta === null) {
    return { delta: missing, deltaTrend: "unknown" };
  }
  within(delta, -Number.MAX_VALUE, Number.MAX_VALUE);
  const rounded = Number(delta.toFixed(3));
  return {
    delta: `${rounded < 0 ? "" : "+"}${rounded.toFixed(3)}`,
    deltaTrend: rounded < 0 ? "faster" : rounded > 0 ? "slower" : "even",
  };
}

function lapText(lap: HudFrame["lap"]): string {
  if (lap === null) {
    return missing;
  }
  integer(lap.total, 1, Number.MAX_SAFE_INTEGER);
  integer(lap.current, 1, lap.total);
  return `${String(lap.current)}/${String(lap.total)}`;
}

export function formatHud(frame: HudFrame) {
  return {
    speed: whole(frame.speed, 3.6),
    gear: gearText(frame.gear),
    rpm: whole(frame.rpm),
    energy: energyText(frame.energy),
    tyres: tyresText(frame.tyres),
    ...deltaText(frame.delta),
    lap: lapText(frame.lap),
  };
}
