export interface WeatherInfo {
  rain: number;
  lineWater: number;
  offWater: number;
  carWater: number;
  clock: number;
  slickLimit: number;
  interLimit: number;
  forecast: number[];
}

const interIndex = 3;
const wetIndex = 4;

export function idealCompound(
  water: number,
  limits: { slickLimit: number; interLimit: number },
  dry: number,
): number {
  if (water >= limits.interLimit) return wetIndex;
  if (water >= limits.slickLimit) return interIndex;
  return dry;
}

export function waterLabel(water: number): string {
  if (water < 0.03) return "Dry";
  if (water < 0.16) return "Damp";
  if (water < 0.4) return "Wet";
  return water < 0.7 ? "Very Wet" : "Standing Water";
}

export function rainLabel(rain: number): string {
  if (rain < 0.05) return "Dry";
  if (rain < 0.45) return "Light";
  return rain < 0.8 ? "Medium" : "Heavy";
}

interface Message {
  title: string;
  detail: string;
}

function family(compound: number): number {
  return compound < 3 ? 0 : compound - 2;
}

export function weatherCall(
  weather: WeatherInfo,
  fitted: number,
): { key: string; message: Message | null } {
  const soon = weather.forecast[0] ?? 0;
  if (weather.rain < 0.05 && soon >= 0.2 && family(fitted) === 0)
    return {
      key: "rain-coming",
      message: { title: "Rain expected", detail: "Rain in about 5 minutes" },
    };
  const call = family(
    idealCompound(Math.max(weather.lineWater, soon * 0.8), weather, 0),
  );
  const now = family(fitted);
  const key = `${String(now)}>${String(call)}`;
  if (call === now) return { key, message: null };
  const messages: Record<number, Message> = {
    0: { title: "Box for slicks", detail: "The racing line is dry enough" },
    1: {
      title: "Box for intermediates",
      detail:
        now === 0 ? "Too wet for slicks now" : "The standing water is clearing",
    },
    2: { title: "Box for wets", detail: "Standing water on the racing line" },
  };
  return { key, message: messages[call] ?? null };
}
