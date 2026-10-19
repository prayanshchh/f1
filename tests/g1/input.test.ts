import { describe, expect, test } from "vitest";
import type { Input } from "../../apps/client/src/contracts/index.ts";
import {
  attachKeyboard,
  connectWheel,
  createGamepadReader,
  createKeyboard,
  steeringForce,
  wheelFilters,
  wheelProfiles,
  type GamepadLike,
  type HidDeviceLike,
  type WheelProfile,
} from "../../apps/client/src/input/index.ts";
import { caughtError } from "../f1/support/sim.ts";

const FRAME = 1 / 120;

function samples(
  keyboard: ReturnType<typeof createKeyboard>,
  seconds: number,
): Input[] {
  return Array.from({ length: Math.round(seconds / FRAME) }, () =>
    keyboard.sample(FRAME),
  );
}

function timeToReach(values: number[], target: number): number {
  const index = values.findIndex((value) => value === target);
  return index < 0 ? Number.POSITIVE_INFINITY : (index + 1) * FRAME;
}

function expectValid(input: Input): void {
  expect(Object.keys(input).sort()).toEqual([
    "brake",
    "shiftDown",
    "shiftUp",
    "steer",
    "throttle",
  ]);
  expect(input.steer).toBeGreaterThanOrEqual(-1);
  expect(input.steer).toBeLessThanOrEqual(1);
  for (const pedal of [input.throttle, input.brake]) {
    expect(pedal).toBeGreaterThanOrEqual(0);
    expect(pedal).toBeLessThanOrEqual(1);
  }
}

function expectMonotonic(values: number[], direction: 1 | -1): void {
  for (let index = 1; index < values.length; index += 1) {
    expect(
      ((values[index] ?? 0) - (values[index - 1] ?? 0)) * direction,
    ).toBeGreaterThanOrEqual(0);
  }
}

describe("keyboard", () => {
  test("starts idle", () => {
    expect(createKeyboard().sample(FRAME)).toEqual({
      steer: 0,
      throttle: 0,
      brake: 0,
      shiftUp: false,
      shiftDown: false,
    });
  });

  test.each([
    ["ArrowLeft", 1],
    ["KeyA", 1],
    ["ArrowRight", -1],
    ["KeyD", -1],
  ] as const)(
    "%s steers smoothly to %d, left being positive",
    (code, target) => {
      const keyboard = createKeyboard();
      keyboard.keyDown(code, false);
      const pressed = samples(keyboard, 0.6).map((input) => input.steer);
      const rise = timeToReach(pressed, target);
      expect(rise).toBeGreaterThanOrEqual(0.1);
      expect(rise).toBeLessThanOrEqual(0.4);
      expectMonotonic(pressed, target);
      keyboard.keyUp(code);
      const released = samples(keyboard, 0.5).map((input) => input.steer);
      const fall = timeToReach(released, 0);
      expect(fall).toBeGreaterThanOrEqual(0.05);
      expect(fall).toBeLessThanOrEqual(0.3);
      expectMonotonic(released, target === 1 ? -1 : 1);
    },
  );

  test("swapping steering direction sweeps through the centre without a jump", () => {
    const keyboard = createKeyboard();
    keyboard.keyDown("ArrowLeft", false);
    samples(keyboard, 0.6);
    keyboard.keyUp("ArrowLeft");
    keyboard.keyDown("ArrowRight", false);
    const sweep = samples(keyboard, 0.8).map((input) => input.steer);
    expect(sweep.at(-1)).toBe(-1);
    expectMonotonic(sweep, -1);
    let previous = 1;
    for (const value of sweep) {
      expect(Math.abs(value - previous)).toBeLessThanOrEqual(
        FRAME / 0.05 + 1e-9,
      );
      previous = value;
    }
  });

  test("opposite steering keys cancel out", () => {
    const keyboard = createKeyboard();
    keyboard.keyDown("ArrowLeft", false);
    keyboard.keyDown("ArrowRight", false);
    for (const input of samples(keyboard, 0.5)) {
      expect(input.steer).toBe(0);
    }
  });

  test.each([
    ["ArrowUp", "throttle"],
    ["KeyW", "throttle"],
    ["ArrowDown", "brake"],
    ["KeyS", "brake"],
  ] as const)("%s ramps the %s quickly in both directions", (code, pedal) => {
    const keyboard = createKeyboard();
    keyboard.keyDown(code, false);
    const pressed = samples(keyboard, 0.4).map((input) => input[pedal]);
    const rise = timeToReach(pressed, 1);
    expect(rise).toBeGreaterThanOrEqual(0.03);
    expect(rise).toBeLessThanOrEqual(0.25);
    expectMonotonic(pressed, 1);
    keyboard.keyUp(code);
    const fall = timeToReach(
      samples(keyboard, 0.4).map((input) => input[pedal]),
      0,
    );
    expect(fall).toBeGreaterThanOrEqual(0.03);
    expect(fall).toBeLessThanOrEqual(0.2);
  });

  test.each([
    ["KeyE", "shiftUp"],
    ["KeyQ", "shiftDown"],
  ] as const)(
    "%s requests exactly one %s per press, ignoring key repeat",
    (code, shift) => {
      const keyboard = createKeyboard();
      keyboard.keyDown(code, false);
      expect(keyboard.sample(FRAME)[shift]).toBe(true);
      for (let repeat = 0; repeat < 10; repeat += 1) {
        keyboard.keyDown(code, true);
        expect(keyboard.sample(FRAME)[shift]).toBe(false);
      }
      keyboard.keyUp(code);
      expect(keyboard.sample(FRAME)[shift]).toBe(false);
      keyboard.keyDown(code, false);
      keyboard.keyUp(code);
      expect(
        keyboard.sample(FRAME)[shift],
        "a tap between two samples is not lost",
      ).toBe(true);
      expect(keyboard.sample(FRAME)[shift]).toBe(false);
    },
  );

  test("unknown keys change nothing", () => {
    const keyboard = createKeyboard();
    for (const code of ["Space", "KeyZ", "F5", "", "Digit1"]) {
      keyboard.keyDown(code, false);
    }
    for (const input of samples(keyboard, 0.3)) {
      expect(input).toEqual({
        steer: 0,
        throttle: 0,
        brake: 0,
        shiftUp: false,
        shiftDown: false,
      });
    }
  });

  test("every sample is a valid input even under random mashing", () => {
    const keyboard = createKeyboard();
    const codes = [
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
      "ArrowDown",
      "KeyE",
      "KeyQ",
      "KeyA",
      "KeyD",
    ];
    let seed = 17;
    for (let step = 0; step < 5000; step += 1) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      const code = codes[seed % codes.length] ?? "KeyA";
      if (seed % 3 === 0) {
        keyboard.keyUp(code);
      } else {
        keyboard.keyDown(code, seed % 5 === 0);
      }
      expectValid(keyboard.sample(((seed % 50) + 1) / 1000));
    }
  });

  test.each([0, -FRAME, Number.NaN, Number.POSITIVE_INFINITY])(
    "a time step of %d is rejected",
    (dt) => {
      expect(caughtError(() => createKeyboard().sample(dt))).toBeInstanceOf(
        RangeError,
      );
    },
  );

  test("reset releases every key", () => {
    const keyboard = createKeyboard();
    keyboard.keyDown("ArrowUp", false);
    keyboard.keyDown("ArrowLeft", false);
    samples(keyboard, 0.5);
    keyboard.reset();
    const after = samples(keyboard, 0.5).at(-1);
    expect(after).toEqual({
      steer: 0,
      throttle: 0,
      brake: 0,
      shiftUp: false,
      shiftDown: false,
    });
  });
});

function keyEvent(type: string, code: string, repeat = false): Event {
  return Object.assign(new Event(type, { cancelable: true }), { code, repeat });
}

describe("attaching the keyboard to the page", () => {
  test("forwards key events, claims game keys and leaves other keys alone", () => {
    const target = new EventTarget();
    const keyboard = createKeyboard();
    const detach = attachKeyboard(target, keyboard);
    const up = keyEvent("keydown", "ArrowUp");
    target.dispatchEvent(up);
    expect(up.defaultPrevented).toBe(true);
    const refresh = keyEvent("keydown", "F5");
    target.dispatchEvent(refresh);
    expect(refresh.defaultPrevented).toBe(false);
    expect(samples(keyboard, 0.4).at(-1)?.throttle).toBe(1);
    target.dispatchEvent(keyEvent("keyup", "ArrowUp"));
    expect(samples(keyboard, 0.4).at(-1)?.throttle).toBe(0);
    detach();
    target.dispatchEvent(keyEvent("keydown", "ArrowUp"));
    expect(samples(keyboard, 0.4).at(-1)?.throttle).toBe(0);
  });

  test("losing focus releases held keys", () => {
    const target = new EventTarget();
    const keyboard = createKeyboard();
    attachKeyboard(target, keyboard);
    target.dispatchEvent(keyEvent("keydown", "ArrowUp"));
    samples(keyboard, 0.4);
    target.dispatchEvent(new Event("blur"));
    expect(samples(keyboard, 0.4).at(-1)?.throttle).toBe(0);
  });
});

function pad(
  change: Partial<{
    axes: number[];
    buttons: number[];
    mapping: string;
    connected: boolean;
  }>,
): GamepadLike {
  const buttons = change.buttons ?? new Array<number>(17).fill(0);
  return {
    mapping: change.mapping ?? "standard",
    connected: change.connected ?? true,
    axes: change.axes ?? [0, 0, 0, 0],
    buttons: buttons.map((value) => ({ value, pressed: value > 0.5 })),
  };
}

function withButtons(values: Record<number, number>): number[] {
  return Array.from({ length: 17 }, (_, index) => values[index] ?? 0);
}

describe("gamepad", () => {
  test("left stick steers with left positive and reaches full lock", () => {
    const reader = createGamepadReader();
    expect(reader.read(pad({ axes: [-1, 0, 0, 0] })).steer).toBe(1);
    expect(reader.read(pad({ axes: [1, 0, 0, 0] })).steer).toBe(-1);
    expect(reader.read(pad({ axes: [-0.5, 0, 0, 0] })).steer).toBeGreaterThan(
      0,
    );
  });

  test("a small dead zone hides stick drift without a step at its edge", () => {
    const reader = createGamepadReader();
    expect(reader.read(pad({ axes: [0.04, 0.9, 0, 0] })).steer).toBe(0);
    let firstLive = Number.NaN;
    for (let x = 0; x <= 0.2; x += 0.001) {
      const steer = reader.read(pad({ axes: [-x, 0, 0, 0] })).steer;
      if (steer > 0 && Number.isNaN(firstLive)) {
        firstLive = x;
        expect(steer, "no jump at the edge of the dead zone").toBeLessThan(
          0.02,
        );
      }
    }
    expect(firstLive).toBeGreaterThanOrEqual(0.05);
    expect(firstLive).toBeLessThanOrEqual(0.15);
  });

  test("triggers drive the pedals and bumpers shift once per press", () => {
    const reader = createGamepadReader();
    const full = reader.read(
      pad({ buttons: withButtons({ 7: 1, 6: 0.5, 5: 1 }) }),
    );
    expect(full.throttle).toBe(1);
    expect(full.brake).toBeGreaterThan(0.4);
    expect(full.brake).toBeLessThan(0.6);
    expect(full.shiftUp).toBe(true);
    expect(
      reader.read(pad({ buttons: withButtons({ 7: 1, 5: 1 }) })).shiftUp,
    ).toBe(false);
    expect(reader.read(pad({ buttons: withButtons({ 4: 1 }) })).shiftDown).toBe(
      true,
    );
    expect(reader.read(pad({ buttons: withButtons({}) })).throttle).toBe(0);
    expect(reader.read(pad({ buttons: withButtons({ 5: 1 }) })).shiftUp).toBe(
      true,
    );
  });

  test("a missing, disconnected or non-standard pad is idle", () => {
    const reader = createGamepadReader();
    const idle = {
      steer: 0,
      throttle: 0,
      brake: 0,
      shiftUp: false,
      shiftDown: false,
    };
    expect(reader.read(null)).toEqual(idle);
    expect(reader.read(pad({ connected: false, axes: [-1, 0, 0, 0] }))).toEqual(
      idle,
    );
    expect(reader.read(pad({ mapping: "", axes: [-1, 0, 0, 0] }))).toEqual(
      idle,
    );
  });

  test("broken readings are clamped or ignored", () => {
    const reader = createGamepadReader();
    expectValid(
      reader.read(
        pad({
          axes: [-1.3, 0, 0, 0],
          buttons: withButtons({ 7: 1.2, 6: -0.1 }),
        }),
      ),
    );
    expect(reader.read(pad({ axes: [Number.NaN, 0, 0, 0] })).steer).toBe(0);
    expect(reader.read(pad({ axes: [], buttons: [] }))).toEqual({
      steer: 0,
      throttle: 0,
      brake: 0,
      shiftUp: false,
      shiftDown: false,
    });
  });
});

describe("force feedback from the simulation", () => {
  test("scales steering torque to a clamped force with left positive", () => {
    expect(steeringForce(0, 20)).toBe(0);
    expect(steeringForce(10, 20)).toBe(0.5);
    expect(steeringForce(-10, 20)).toBe(-0.5);
    expect(steeringForce(45, 20)).toBe(1);
    expect(steeringForce(-45, 20)).toBe(-1);
    expect(steeringForce(Number.NaN, 20)).toBe(0);
  });

  test.each([0, -5, Number.NaN])(
    "a maximum torque of %d is rejected",
    (max) => {
      expect(caughtError(() => steeringForce(1, max))).toBeInstanceOf(
        RangeError,
      );
    },
  );
});

interface SentReport {
  reportId: number;
  data: number[];
}

class FakeWheel extends EventTarget implements HidDeviceLike {
  vendorId = 0x1234;
  productId = 0x5678;
  productName = "Test wheel";
  opened = false;
  sent: SentReport[] = [];
  fail = false;
  closes = 0;

  open(): Promise<void> {
    this.opened = true;
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.opened = false;
    this.closes += 1;
    return Promise.resolve();
  }

  sendReport(reportId: number, data: BufferSource): Promise<void> {
    if (this.fail) {
      return Promise.reject(new DOMException("unplugged", "NetworkError"));
    }
    const bytes =
      data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    this.sent.push({ reportId, data: [...bytes] });
    return Promise.resolve();
  }

  report(
    steer: number,
    throttle: number,
    brake: number,
    buttons: number,
  ): void {
    const data = new DataView(new ArrayBuffer(6));
    data.setInt16(
      0,
      Math.max(-32768, Math.min(32767, Math.round(steer * 30000))),
      true,
    );
    data.setUint8(2, Math.round(throttle * 255));
    data.setUint8(3, Math.round(brake * 255));
    data.setUint8(4, buttons);
    this.dispatchEvent(
      Object.assign(new Event("inputreport"), {
        reportId: 1,
        data,
        device: this,
      }),
    );
  }
}

const testProfile: WheelProfile = {
  name: "Test wheel",
  vendorId: 0x1234,
  productId: 0x5678,
  decode(data) {
    if (data.byteLength !== 6) {
      return null;
    }
    return {
      steer: data.getInt16(0, true) / 30000,
      throttle: data.getUint8(2) / 255,
      brake: data.getUint8(3) / 255,
      shiftUp: (data.getUint8(4) & 1) !== 0,
      shiftDown: (data.getUint8(4) & 2) !== 0,
    };
  },
  encodeForce(force) {
    return {
      reportId: 3,
      data: new Uint8Array([0x11, Math.round(128 + force * 127)]),
    };
  },
};

describe("WebHID wheel", () => {
  test("built-in profiles include a Logitech wheel and become requestDevice filters", () => {
    expect(wheelProfiles.some((profile) => profile.vendorId === 0x046d)).toBe(
      true,
    );
    expect(wheelFilters()).toEqual(
      wheelProfiles.map((profile) => ({
        vendorId: profile.vendorId,
        productId: profile.productId,
      })),
    );
    for (const profile of wheelProfiles) {
      const centre = profile.encodeForce(0);
      const left = profile.encodeForce(1);
      const right = profile.encodeForce(-1);
      expect([...left.data]).not.toEqual([...centre.data]);
      expect([...right.data]).not.toEqual([...left.data]);
      expect([...profile.encodeForce(0.25).data]).toEqual([
        ...profile.encodeForce(0.25).data,
      ]);
    }
  });

  test("opens the device and turns its reports into game input", async () => {
    const device = new FakeWheel();
    const wheel = await connectWheel(device, testProfile);
    expect(device.opened).toBe(true);
    expect(wheel.read()).toEqual({
      steer: 0,
      throttle: 0,
      brake: 0,
      shiftUp: false,
      shiftDown: false,
    });
    device.report(0.5, 1, 0, 0);
    const input = wheel.read();
    expect(input.steer).toBeCloseTo(0.5, 4);
    expect(input.throttle).toBe(1);
    expect(input.brake).toBe(0);
    device.report(-1.2, 0, 1, 0);
    expectValid(wheel.read());
    expect(wheel.read().steer).toBe(-1);
  });

  test("paddles shift once per pull even across many reports", async () => {
    const device = new FakeWheel();
    const wheel = await connectWheel(device, testProfile);
    device.report(0, 0, 0, 1);
    device.report(0, 0, 0, 1);
    expect(wheel.read().shiftUp).toBe(true);
    device.report(0, 0, 0, 1);
    expect(wheel.read().shiftUp).toBe(false);
    device.report(0, 0, 0, 0);
    device.report(0, 0, 0, 2);
    device.report(0, 0, 0, 0);
    expect(wheel.read().shiftDown, "a pull between two reads is not lost").toBe(
      true,
    );
    expect(wheel.read().shiftDown).toBe(false);
  });

  test("reports the profile cannot decode are ignored", async () => {
    const device = new FakeWheel();
    const wheel = await connectWheel(device, testProfile);
    device.report(0.25, 0.5, 0, 0);
    device.dispatchEvent(
      Object.assign(new Event("inputreport"), {
        reportId: 1,
        data: new DataView(new ArrayBuffer(2)),
        device,
      }),
    );
    expect(wheel.read().throttle).toBeCloseTo(0.5, 2);
  });

  test("sends clamped forces and skips repeats", async () => {
    const device = new FakeWheel();
    const wheel = await connectWheel(device, testProfile);
    await wheel.setForce(0.5);
    await wheel.setForce(0.5);
    await wheel.setForce(3);
    await wheel.setForce(Number.NaN);
    expect(device.sent).toEqual([
      { reportId: 3, data: [0x11, 192] },
      { reportId: 3, data: [0x11, 255] },
      { reportId: 3, data: [0x11, 128] },
    ]);
  });

  test("a failed force report rejects but input keeps working", async () => {
    const device = new FakeWheel();
    const wheel = await connectWheel(device, testProfile);
    device.fail = true;
    await expect(wheel.setForce(0.3)).rejects.toBeInstanceOf(Error);
    device.report(0, 1, 0, 0);
    expect(wheel.read().throttle).toBe(1);
  });

  test("closing centres the force, stops listening and closes the device", async () => {
    const device = new FakeWheel();
    const wheel = await connectWheel(device, testProfile);
    await wheel.setForce(-0.75);
    await wheel.close();
    expect(device.sent.at(-1)).toEqual({ reportId: 3, data: [0x11, 128] });
    expect(device.closes).toBe(1);
    device.report(1, 1, 0, 1);
    expect(wheel.read()).toEqual({
      steer: 0,
      throttle: 0,
      brake: 0,
      shiftUp: false,
      shiftDown: false,
    });
    const count = device.sent.length;
    await wheel.setForce(1);
    expect(device.sent).toHaveLength(count);
  });

  test("an already opened device is not opened twice", async () => {
    const device = new FakeWheel();
    device.opened = true;
    let opens = 0;
    device.open = () => {
      opens += 1;
      return Promise.resolve();
    };
    await connectWheel(device, testProfile);
    expect(opens).toBe(0);
  });
});
