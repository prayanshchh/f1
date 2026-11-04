import { type HudPart, hudParts, type Settings } from "./settings.ts";

export type TutorialStatus = "done" | "skipped";

const statusKey = "revracers.tutorial";
const runKey = "revracers.tutorialRun";

export function tutorialStatus(
  store: Storage = localStorage,
): TutorialStatus | null {
  const value = store.getItem(statusKey);
  return value === "done" || value === "skipped" ? value : null;
}

export function rememberTutorial(
  status: TutorialStatus,
  store: Storage = localStorage,
): void {
  if (tutorialStatus(store) === "done") return;
  store.setItem(statusKey, status);
}

export function armTutorial(): void {
  sessionStorage.setItem(runKey, "1");
}

export function consumeTutorial(params: URLSearchParams): boolean {
  const armed = sessionStorage.getItem(runKey) === "1";
  sessionStorage.removeItem(runKey);
  return armed || params.has("tutorial");
}

export function tutorialSettings(base: Settings): Settings {
  const parts = Object.keys(hudParts) as HudPart[];
  return {
    ...base,
    session: "practice",
    buildUp: false,
    racingLine: "full",
    transmission: "auto",
    ersAssist: false,
    antiLock: true,
    rain: "none",
    clouds: "few clouds",
    timeOfDay: "noon",
    tyreWear: "real",
    fuel: 0,
    hud: Object.fromEntries(parts.map((part) => [part, true])) as Record<
      HudPart,
      boolean
    >,
    setup: { ...base.setup },
  };
}

export function keptChanges(
  real: Settings,
  start: Settings,
  now: Settings,
): Settings {
  const kept: Settings = { ...real, hud: { ...real.hud } };
  for (const key of Object.keys(now) as (keyof Settings)[])
    if (
      key !== "hud" &&
      JSON.stringify(now[key]) !== JSON.stringify(start[key])
    )
      Object.assign(kept, { [key]: now[key] });
  for (const part of Object.keys(now.hud) as HudPart[])
    if (now.hud[part] !== start.hud[part]) kept.hud[part] = now.hud[part];
  return kept;
}
