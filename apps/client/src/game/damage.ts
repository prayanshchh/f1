import type { CarStatus } from "./mfd.ts";
import type { TyreInfo } from "./tyres.ts";

export interface DamageAlert {
  title: string;
  detail: string;
}

const retirements = [
  "",
  "Accident damage",
  "Suspension failure",
  "Engine failure",
  "Out of fuel",
];

export function retirementLabel(reason: number): string {
  return retirements[reason] ?? "";
}

const autoWingDamage = 0.2;

export function wingRequested(
  choice: boolean | null,
  status: CarStatus,
): boolean {
  const { wingLeft, wingRight } = status.damage;
  return choice ?? Math.max(wingLeft, wingRight) >= autoWingDamage;
}

const stageSteps = [0.2, 0.45, 0.7];

function stage(value: number): number {
  return stageSteps.filter((step) => value >= step).length;
}

const wheelNames = ["front right", "front left", "rear right", "rear left"];
const leakAlert = 0.03;
const flatAlert = 0.6;
const flatSpotAlert = 0.1;
const flatSpotSevere = 0.5;

function partAlerts(
  status: CarStatus,
): { key: string; level: number; alert: DamageAlert }[] {
  const { damage } = status;
  const parts: [string, number, string, string][] = [
    [
      "wing",
      Math.max(damage.wingLeft, damage.wingRight),
      "Front wing damage",
      "Understeer at speed - box for a new wing",
    ],
    [
      "rear-wing",
      damage.rearWing,
      "Rear wing damage",
      "The rear will snap away in fast corners",
    ],
    ["floor", damage.floor, "Floor damage", "Large loss of downforce"],
    [
      "diffuser",
      damage.diffuser,
      "Diffuser damage",
      "The rear is unstable at speed",
    ],
    [
      "sidepod",
      Math.max(damage.sidepodLeft, damage.sidepodRight),
      "Sidepod damage",
      "More drag, and the engine runs hot",
    ],
    [
      "suspension",
      Math.max(...damage.suspension),
      "Suspension damage",
      "The car pulls and scrubs its tyres",
    ],
  ];
  return parts.map(([key, value, title, detail]) => ({
    key,
    level: stage(value),
    alert: { title, detail },
  }));
}

function tyreAlerts(tyres: TyreInfo) {
  return tyres.wheels.flatMap((wheel, i) => {
    const name = wheelNames[i] ?? "";
    const leaking = wheel.leak >= leakAlert;
    const flat = wheel.leak >= flatAlert;
    const spotted = wheel.flat >= flatSpotAlert;
    return [
      {
        key: `leak-${String(i)}`,
        level: flat ? 2 : leaking ? 1 : 0,
        alert: flat
          ? {
              title: "Puncture",
              detail: `The ${name} tyre has gone - nurse it back to the pits`,
            }
          : {
              title: "Slow puncture",
              detail: `The ${name} tyre is losing air - box now`,
            },
      },
      {
        key: `spot-${String(i)}`,
        level: wheel.flat >= flatSpotSevere ? 2 : spotted ? 1 : 0,
        alert: {
          title: "Flat spot",
          detail: `Vibration from the ${name} tyre - less grip and more wear`,
        },
      },
    ];
  });
}

export class DamageMonitor {
  private readonly levels = new Map<string, number>();

  update(status: CarStatus, tyres: TyreInfo): DamageAlert | null {
    let raised: DamageAlert | null = null;
    for (const { key, level, alert } of [
      ...partAlerts(status),
      ...tyreAlerts(tyres),
    ]) {
      const known = this.levels.get(key) ?? 0;
      if (level > known) raised = alert;
      this.levels.set(key, level);
    }
    return raised;
  }
}

export function tyreRoughness(tyres: TyreInfo): number {
  return Math.min(
    1,
    Math.max(...tyres.wheels.map((w) => Math.max(w.leak, w.flat * 1.5))),
  );
}
