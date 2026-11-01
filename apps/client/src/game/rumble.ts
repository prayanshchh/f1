const fullSpeed = 15;
const grassShare = 0.45;
const baseHertz = 17;
const secondHertz = 29;
const attack = 0.04;
const release = 0.12;
const kerb = 1;
const grass = 2;
const bodyHeave = 0.008;
const bodyRoll = 0.006;
const cameraMove = 0.006;
const cameraRoll = 0.0022;

export interface RumbleWheel {
  surface: number;
}

export interface Shake {
  amount: number;
  heave: number;
  roll: number;
  cameraX: number;
  cameraY: number;
  cameraRoll: number;
}

export function rumbleTarget(wheels: RumbleWheel[], speed: number): number {
  const share = (surface: number) =>
    wheels.filter((w) => w.surface === surface).length /
    Math.max(1, wheels.length);
  const onRough = Math.min(
    1,
    Math.sqrt(2 * share(kerb)) + grassShare * Math.sqrt(2 * share(grass)),
  );
  return onRough * Math.min(1, Math.abs(speed) / fullSpeed);
}

export class Rumble {
  private amount = 0;

  update(wheels: RumbleWheel[], speed: number, dt: number, now: number): Shake {
    const target = rumbleTarget(wheels, speed);
    const time = target > this.amount ? attack : release;
    this.amount +=
      (target - this.amount) * (1 - Math.exp(-Math.max(0, dt) / time));
    const a = Math.sin(now * 2 * Math.PI * baseHertz);
    const b = Math.sin(now * 2 * Math.PI * secondHertz + 1.3);
    const c = Math.sin(now * 2 * Math.PI * (baseHertz * 0.73) + 2.1);
    const value = this.amount;
    return {
      amount: value,
      heave: value * bodyHeave * (0.6 * a + 0.4 * b),
      roll: value * bodyRoll * (0.6 * b + 0.4 * c),
      cameraX: value * cameraMove * c,
      cameraY: value * cameraMove * (0.6 * a + 0.4 * b),
      cameraRoll: value * cameraRoll * b,
    };
  }
}
