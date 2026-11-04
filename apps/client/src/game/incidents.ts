import type { CarStatus } from "./mfd.ts";
import type { TyreInfo } from "./tyres.ts";

const crashJump = 0.02;
const settle = 3;
const lead = 1;
const fallback = 5;

interface Incident {
  at: number;
  crash: boolean;
}

export function hurtOf(status: CarStatus, tyres: TyreInfo): number {
  const { damage } = status;
  const parts = [
    damage.wingLeft,
    damage.wingRight,
    damage.sidepodLeft,
    damage.sidepodRight,
    damage.floor,
    damage.diffuser,
    damage.rearWing,
    ...damage.suspension,
  ];
  const wheels = tyres.wheels.map((wheel) => wheel.leak + wheel.flat);
  return [...parts, ...wheels].reduce((sum, value) => sum + value, 0);
}

export class Incidents {
  private safeAt = -Infinity;
  private safeHurt = 0;
  private lastHurt = 0;
  private open: Incident | null = null;
  private calmFrom: number | null = null;

  get crashed(): boolean {
    return this.open?.crash === true;
  }

  update(time: number, hurt: number, off: boolean, retired: boolean): void {
    const hit = retired || hurt - this.lastHurt > crashJump;
    this.lastHurt = hurt;
    if (this.open) this.follow(time, hurt, off, hit);
    else if (hit || off) {
      this.open = { at: this.safeAt, crash: hit };
      this.calmFrom = null;
    }
    if (this.open) return;
    this.safeAt = time;
    this.safeHurt = hurt;
  }

  target(now: number): number {
    return this.open ? this.open.at - lead : now - fallback;
  }

  rewound(): void {
    this.open = null;
    this.calmFrom = null;
    this.safeAt = -Infinity;
  }

  private follow(time: number, hurt: number, off: boolean, hit: boolean): void {
    const open = this.open;
    if (!open) return;
    if (hit) open.crash = true;
    const repaired = !hit && hurt <= this.safeHurt + crashJump;
    if (open.crash) {
      if (repaired) this.open = null;
      return;
    }
    this.calmFrom = off ? null : (this.calmFrom ?? time);
    if (this.calmFrom !== null && time - this.calmFrom >= settle)
      this.open = null;
  }
}
