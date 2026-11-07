const fullSpeed = 15;
const strikeSpeed = 45;
const grassShare = 0.45;
const attack = 0.04;
const release = 0.12;
const kerb = 1;
const grass = 2;
const bounceHertz = 6.5;
const bounceDamping = 0.28;
const substep = 1 / 240;
const longestStep = 0.1;
const knotHertz = 22;
const buzzHertz = 26;
const climb = { heave: 0.1, pitch: 0.065, roll: 0.07 };
const drop = 0.6;
const ride = { heave: 2.8, pitch: 2, roll: 1.6 };
const grassRide = 0.5;
const buzzYaw = 0.0004;
const buzzPitch = 0.0006;
const front = [0, 1];
const left = [1, 3];

export interface RumbleWheel {
  surface: number;
}

export interface Shake {
  amount: number;
  heave: number;
  pitch: number;
  roll: number;
  buzzYaw: number;
  buzzPitch: number;
}

export function rumbleTarget(
  wheels: RumbleWheel[],
  speed: number,
  tyreRough = 0,
): number {
  const share = (surface: number) =>
    wheels.filter((w) => w.surface === surface).length /
    Math.max(1, wheels.length);
  const onRough = Math.max(
    tyreRough,
    Math.min(
      1,
      Math.sqrt(2 * share(kerb)) + grassShare * Math.sqrt(2 * share(grass)),
    ),
  );
  return onRough * Math.min(1, Math.abs(speed) / fullSpeed);
}

function roughness(surface: number): number {
  if (surface === kerb) return 1;
  if (surface === grass) return grassRide;
  return 0;
}

function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

function noise(seed: number, t: number): number {
  const knot = Math.floor(t);
  const f = t - knot;
  const w = f * f * (3 - 2 * f);
  const a = hash(seed * 1013 + knot);
  const b = hash(seed * 1013 + knot + 1);
  return a + (b - a) * w;
}

class Spring {
  value = 0;
  private velocity = 0;

  kick(speed: number): void {
    this.velocity += speed;
  }

  step(force: number, dt: number): void {
    const omega = 2 * Math.PI * bounceHertz;
    this.velocity +=
      (force * omega * omega -
        omega * omega * this.value -
        2 * bounceDamping * omega * this.velocity) *
      dt;
    this.value += this.velocity * dt;
  }
}

export class Rumble {
  private amount = 0;
  private readonly heave = new Spring();
  private readonly pitch = new Spring();
  private readonly roll = new Spring();
  private readonly on = [0, 0, 0, 0];

  update(
    wheels: RumbleWheel[],
    speed: number,
    dt: number,
    now: number,
    tyreRough = 0,
  ): Shake {
    const target = rumbleTarget(wheels, speed, tyreRough);
    const time = target > this.amount ? attack : release;
    this.amount +=
      (target - this.amount) * (1 - Math.exp(-Math.max(0, dt) / time));
    const pace = Math.min(1, Math.abs(speed) / strikeSpeed);
    const rough = wheels.map((w) => roughness(w.surface));
    rough.forEach((r, i) => {
      const change = r - (this.on[i] ?? 0);
      this.on[i] = r;
      if (change === 0) return;
      const size = change * pace * (change > 0 ? 1 : drop);
      const sideSign = left.includes(i) ? 1 : -1;
      const endSign = front.includes(i) ? 1 : -1;
      this.heave.kick(size * climb.heave);
      this.pitch.kick(size * climb.pitch * endSign);
      this.roll.kick(size * climb.roll * sideSign);
    });
    const span = Math.min(Math.max(0, dt), longestStep);
    for (let done = 0; done < span; done += substep) {
      const h = Math.min(substep, span - done);
      const at = (now - span + done + h) * knotHertz;
      let heave = 0;
      let pitch = 0;
      let roll = 0;
      rough.forEach((r, i) => {
        if (r === 0) return;
        const bump = noise(i + 1, at) * r * pace;
        heave += bump;
        pitch += bump * (front.includes(i) ? 1 : -1);
        roll += bump * (left.includes(i) ? 1 : -1);
      });
      this.heave.step((heave * ride.heave) / 1000, h);
      this.pitch.step((pitch * ride.pitch) / 1000, h);
      this.roll.step((roll * ride.roll) / 1000, h);
    }
    const buzz = this.amount * Math.min(1, pace * 2);
    return {
      amount: this.amount,
      heave: this.heave.value,
      pitch: this.pitch.value,
      roll: this.roll.value,
      buzzYaw: buzz * buzzYaw * noise(11, now * buzzHertz),
      buzzPitch: buzz * buzzPitch * noise(13, now * buzzHertz),
    };
  }
}
