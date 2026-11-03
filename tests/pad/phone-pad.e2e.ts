import { writeFileSync } from "node:fs";
import { type Browser, expect, test } from "@playwright/test";
import { ersModes } from "../../apps/client/src/game/energy.ts";
import {
  type StepResult,
  type TiltStep,
  analyseSteps,
  updatesBetween,
  frameInterval,
  shiftLog,
  spread,
} from "../support/pad-latency.ts";
import {
  Game,
  Phone,
  type PhoneOptions,
  type Sample,
  clockOffset,
  launchPhoneBrowser,
  nodeClock,
  phoneKinds,
  phoneTilt,
} from "../support/phone-pad.ts";

const level = 0.02;
const moved = 0.005;
const boostMode = ersModes.findIndex((mode) => mode.id === "boost");
const directRoute = /^(host|prflx)-(host|prflx)$/;
const sharedRunner = Boolean(process.env["CI"]);

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function timeUntil(
  since: number,
  done: () => Promise<boolean>,
): Promise<number> {
  await expect.poll(done, { intervals: [10], timeout: 3_000 }).toBe(true);
  return nodeClock() - since;
}

async function letGo(game: Game, since: number) {
  const throttleOff = await timeUntil(
    since,
    async () => (await game.controls()).throttle < level,
  );
  const straight = await timeUntil(
    since,
    async () => Math.abs((await game.controls()).steer) < level,
  );
  return { throttleOff, straight };
}

function gearLabel(gear: number): string {
  if (gear < 0) return "R";
  return gear === 0 ? "N" : String(gear);
}

async function upToSpeed(game: Game, phone: Phone, kph: number) {
  await phone.press("gas");
  await expect
    .poll(async () => (await game.controls()).speedKph, { timeout: 15_000 })
    .toBeGreaterThan(kph);
}

async function drivingLeft(game: Game, phone: Phone, left: number) {
  await phone.tilt(20);
  await phone.press("gas");
  await expect
    .poll(async () => {
      const controls = await game.controls();
      return controls.throttle > 0.3 && Math.sign(controls.steer) === left;
    })
    .toBe(true);
}

function steerStamps(log: Sample[]): [number, number][] {
  return log.map(([at, steer]) => [at, steer]);
}

interface GasPress {
  ms: number;
  frames: number;
}

function gasPress(
  pressedAt: number,
  received: Sample[],
  car: Sample[],
): GasPress {
  const arrived = received.find(([t, , value]) => t >= pressedAt && value > 0);
  const reached = car.find(
    ([t, , throttle]) => t >= pressedAt && throttle > moved,
  );
  return {
    ms: reached ? reached[0] - pressedAt : Number.NaN,
    frames: updatesBetween(
      steerStamps(car),
      arrived?.[0] ?? Number.NaN,
      reached?.[0] ?? Number.NaN,
    ),
  };
}

function gasPresses(sent: Sample[], received: Sample[], car: Sample[]) {
  const presses: GasPress[] = [];
  let pressedAt = Number.NaN;
  for (const [at, , gas] of sent) {
    if (gas > 0 && Number.isNaN(pressedAt)) pressedAt = at;
    if (gas > 0 || Number.isNaN(pressedAt)) continue;
    presses.push(gasPress(pressedAt, received, car));
    pressedAt = Number.NaN;
  }
  return presses;
}

function summary(results: StepResult[]) {
  const pick = (
    key: keyof Omit<StepResult, "degreesLeft" | "carDelta" | "carFrames">,
  ) => spread(results.map((r) => r[key]));
  return {
    phoneSends: pick("phoneSends"),
    phoneReaches90: pick("phoneReaches90"),
    network: pick("network"),
    gameUses: pick("gameUses"),
    carStarts: pick("carStarts"),
    carReaches90: pick("carReaches90"),
  };
}

for (const kind of phoneKinds) {
  test.describe(`phone pad on ${kind.name}`, () => {
    test.setTimeout(120_000);
    let game: Game;
    let phones: Browser;
    let left = 0;
    const opened: Phone[] = [];

    const openPhone = async (options?: PhoneOptions, host = game) => {
      const phone = await Phone.open(
        phones,
        kind,
        await host.padUrl(),
        options,
      );
      opened.push(phone);
      return phone;
    };

    test.beforeAll(async ({ browser }, testInfo) => {
      testInfo.setTimeout(240_000);
      const baseURL = testInfo.project.use.baseURL;
      if (!baseURL) throw new Error("the phone-pad project needs a baseURL");
      game = await Game.open(browser, baseURL);
      phones = await launchPhoneBrowser(kind);
      left = await game.leftKeySign();
    });

    test.afterEach(async () => {
      for (const phone of opened.splice(0)) await phone.close();
      await expect(game.phoneBadge()).toBeHidden({ timeout: 10_000 });
    });

    test.afterAll(async () => {
      await phones.close();
      await game.close();
    });

    test("pairs from the link in the game's QR code", async () => {
      await expect(game.page.locator("[data-pad=pad-qr] svg")).toBeAttached();
      const phone = await openPhone();
      await expect(game.phoneBadge()).toBeHidden();
      await phone.startAndCalibrate();
      await expect(game.phoneBadge()).toBeVisible();
    });

    test("pairing needs no certificate: the code opens the game's own site", async () => {
      await game.showPairing();
      await expect(game.page.locator("[data-pad=panel]")).not.toContainText(
        /certificate/i,
      );
      expect(new URL(await game.padUrl()).origin).toBe(
        new URL(game.page.url()).origin,
      );
      const phone = await openPhone({ strictCertificates: true });
      await phone.startAndCalibrate();
      await expect(game.phoneBadge()).toBeVisible();
      await game.page.keyboard.press("p");
    });

    test("once paired, input goes straight from phone to game with no server in between", async () => {
      const phone = await openPhone();
      await phone.startAndCalibrate();
      const pairing = phone.requests().length;
      await phone.tilt(15);
      await phone.press("gas");
      await expect
        .poll(async () => (await game.controls()).throttle)
        .toBeGreaterThan(0.1);
      await phone.tilt(-15);
      await phone.release("gas");
      await pause(1_500);
      expect(phone.requests().slice(pairing)).toEqual([]);
      const routes = await game.route();
      expect(routes.length).toBeGreaterThan(0);
      for (const route of routes) expect(route).toMatch(directRoute);
    });

    test("a phone only drives the game whose QR code it scanned", async ({
      browser,
    }, testInfo) => {
      test.setTimeout(360_000);
      const baseURL = testInfo.project.use.baseURL ?? "";
      const other = await Game.open(browser, baseURL);
      try {
        const phone = await openPhone({}, game);
        await phone.startAndCalibrate();
        await phone.tilt(25);
        await expect
          .poll(async () => Math.sign(await game.settledSteer()))
          .toBe(left);
        expect(Math.abs((await other.controls()).steer)).toBeLessThan(level);
        await expect(other.phoneBadge()).toBeHidden();
      } finally {
        await other.close();
      }
    });

    test("a second phone takes over and the first is told it is no longer driving", async () => {
      const first = await openPhone();
      await first.startAndCalibrate();
      await first.tilt(25);
      await expect
        .poll(async () => Math.sign(await game.settledSteer()))
        .toBe(left);

      const second = await openPhone();
      await second.startAndCalibrate();
      await second.tilt(-25);
      await expect(first.page.locator("[data-pad=notice]")).toContainText(
        "Another phone is driving",
      );
      await expect
        .poll(async () => Math.sign(await game.settledSteer()))
        .toBe(-left);
      await pause(3_000);
      expect(Math.sign(await game.settledSteer())).toBe(-left);
      await expect(first.page.locator("[data-pad=link]")).toHaveText(
        "Not driving",
      );

      await first.tap("retry");
      await expect(first.page.locator("[data-pad=link]")).toHaveText("Live");
      await expect
        .poll(async () => Math.sign(await game.settledSteer()))
        .toBe(left);
      await expect(second.page.locator("[data-pad=notice]")).toBeVisible();
    });

    test("a network that keeps phone and computer apart suggests the hotspot, then connects once they can reach each other", async () => {
      const phone = await openPhone();
      await phone.keepApart();
      await phone.start();
      const notice = phone.page.locator("[data-pad=notice]");
      await expect(notice).toBeVisible({ timeout: 20_000 });
      await expect(notice).toContainText("hotspot");
      await expect(game.phoneBadge()).toBeHidden();

      await phone.bringTogether();
      await expect(phone.page.locator("[data-pad=link]")).toHaveText("Live", {
        timeout: 20_000,
      });
      await expect(notice).toBeHidden();
      await expect(game.phoneBadge()).toBeVisible();
    });

    test("turning the phone left steers like the Left key, harder turns steer more, and level drives straight", async () => {
      const phone = await openPhone();
      await phone.startAndCalibrate();
      expect(Math.abs(await game.settledSteer())).toBeLessThan(level);

      await phone.tilt(10);
      const gentle = await game.settledSteer();
      await phone.tilt(25);
      const hard = await game.settledSteer();
      await phone.tilt(-25);
      const hardRight = await game.settledSteer();
      await phone.tilt(0);
      const straight = await game.settledSteer();

      expect(Math.sign(gentle)).toBe(left);
      expect(Math.abs(gentle)).toBeGreaterThan(level);
      expect(Math.abs(hard)).toBeGreaterThan(Math.abs(gentle) + 0.05);
      expect(Math.sign(hardRight)).toBe(-left);
      expect(Math.abs(hardRight)).toBeCloseTo(Math.abs(hard), 1);
      expect(Math.abs(straight)).toBeLessThan(level);
    });

    test("gas and brake zones drive the throttle and brake, and holding both keeps gas under the finger", async () => {
      const phone = await openPhone();
      await phone.startAndCalibrate();

      await upToSpeed(game, phone, 40);
      await phone.press("brake");
      await expect
        .poll(async () => (await game.controls()).brake)
        .toBeGreaterThan(0.3);
      await phone.release("brake");
      await expect
        .poll(async () => {
          const controls = await game.controls();
          return controls.brake < level && controls.throttle > 0.3;
        })
        .toBe(true);
      await phone.release("gas");
      await expect
        .poll(async () => (await game.controls()).throttle)
        .toBeLessThan(level);
    });

    test("ERS and boost change the car once per tap and the phone shows the mode", async () => {
      const phone = await openPhone();
      await phone.startAndCalibrate();
      const start = await game.ersMode();

      await phone.tap("ers");
      await expect.poll(() => game.ersMode()).not.toBe(start);
      const cycled = await game.ersMode();
      await pause(500);
      expect(await game.ersMode()).toBe(cycled);
      await expect
        .poll(() => phone.text("ers-mode"))
        .toBe(ersModes[cycled]?.label);

      await phone.tap("boost");
      await expect.poll(() => game.ersMode()).toBe(boostMode);
      await phone.tap("boost");
      await expect.poll(() => game.ersMode()).toBe(cycled);
    });

    test("the phone shows the car's speed and gear", async () => {
      const phone = await openPhone();
      await phone.startAndCalibrate();
      await upToSpeed(game, phone, 25);
      await phone.release("gas");

      await expect
        .poll(async () => {
          const controls = await game.controls();
          const shown = Number(await phone.text("speed"));
          const gear = await phone.text("gear");
          return (
            Math.abs(shown - controls.speedKph) <= 5 &&
            gear === gearLabel(controls.gear)
          );
        })
        .toBe(true);
    });

    test("a phone that goes silent lets go of the throttle within a second", async () => {
      const phone = await openPhone();
      await phone.startAndCalibrate();
      await drivingLeft(game, phone, left);

      const since = nodeClock();
      await phone.goSilent();
      const released = await letGo(game, since);
      expect(released.throttleOff).toBeLessThan(1_000);
      expect(released.straight).toBeLessThan(1_500);
    });

    test("a phone that closes lets go of the throttle at once and the game shows it left", async () => {
      const phone = await openPhone();
      await phone.startAndCalibrate();
      await drivingLeft(game, phone, left);

      const since = nodeClock();
      await phone.close();
      const released = await letGo(game, since);
      expect(released.throttleOff).toBeLessThan(300);
      expect(released.straight).toBeLessThan(1_000);
      await expect(game.phoneBadge()).toBeHidden();
    });

    test("a phone that reconnects does not press ERS or boost by itself", async () => {
      const first = await openPhone();
      await first.startAndCalibrate();
      const start = await game.ersMode();
      await first.tap("ers");
      await expect.poll(() => game.ersMode()).not.toBe(start);
      await first.tap("ers");
      await pause(500);
      await first.close();
      await expect(game.phoneBadge()).toBeHidden();
      const before = await game.ersMode();

      const second = await openPhone();
      await second.startAndCalibrate();
      await pause(1_000);
      expect(await game.ersMode()).toBe(before);
    });

    test("a tilt reaches the car's steering within one game frame", async () => {
      const testInfo = test.info();
      const phone = await openPhone();
      await phone.startAndCalibrate();
      const phoneClock = await clockOffset(phone.page);
      const gameClock = await clockOffset(game.page);
      await game.clearLogs();
      await pause(200);

      const steps: TiltStep[] = [];
      for (let i = 0; i < 24; i++) {
        const degreesLeft = i % 2 === 0 ? 20 : -20;
        const { up } = phoneTilt(degreesLeft);
        steps.push({ degreesLeft, setAt: nodeClock(), reading: up });
        await phone.tilt(degreesLeft);
        await pause(250 + Math.random() * 50);
      }

      const phoneLogs = await phone.logs();
      const gameLogs = await game.logs();
      const results = analyseSteps(
        {
          tilts: shiftLog(phoneLogs.tilts, phoneClock.offset),
          sent: shiftLog(steerStamps(phoneLogs.sent), phoneClock.offset),
          received: shiftLog(steerStamps(gameLogs.received), gameClock.offset),
          handed: shiftLog(gameLogs.handed, gameClock.offset),
          car: shiftLog(steerStamps(gameLogs.car), gameClock.offset),
        },
        steps,
      );
      const frame = frameInterval(steerStamps(gameLogs.car));
      const milliseconds = summary(results);
      const report = {
        phone: kind.name,
        clockError: phoneClock.error + gameClock.error,
        gameFrame: frame,
        milliseconds,
        steps: results,
      };
      const file = testInfo.outputPath("steering-latency.json");
      writeFileSync(file, JSON.stringify(report, null, 2));
      await testInfo.attach("steering-latency", { path: file });

      for (const result of results) {
        expect(Number.isFinite(result.carReaches90)).toBe(true);
        expect(Math.sign(result.carDelta)).toBe(
          Math.sign(result.degreesLeft) * left,
        );
      }
      expect(results.map((result) => result.carFrames)).toEqual(
        results.map(() => 1),
      );
      expect(milliseconds.phoneSends.p95).toBeLessThan(3);
      expect(milliseconds.phoneReaches90.p95).toBeLessThan(3);
      if (!sharedRunner) {
        expect(milliseconds.network.p50).toBeLessThan(5);
        expect(milliseconds.network.p95).toBeLessThan(8);
        expect(milliseconds.carReaches90.p95).toBeLessThan(frame + 8);
      }
    });

    test("pressing gas reaches the car's throttle within one game frame", async () => {
      const testInfo = test.info();
      const phone = await openPhone();
      await phone.startAndCalibrate();
      const phoneClock = await clockOffset(phone.page);
      const gameClock = await clockOffset(game.page);
      await game.clearLogs();
      for (let i = 0; i < 8; i++) {
        await phone.press("gas");
        await pause(150 + Math.random() * 50);
        await phone.release("gas");
        await pause(450 + Math.random() * 50);
      }
      const phoneLogs = await phone.logs();
      const gameLogs = await game.logs();
      const presses = gasPresses(
        shiftLog(phoneLogs.sent, phoneClock.offset),
        shiftLog(gameLogs.received, gameClock.offset),
        shiftLog(gameLogs.car, gameClock.offset),
      );
      const frame = frameInterval(steerStamps(gameLogs.car));
      const reached = spread(presses.map((press) => press.ms));
      const file = testInfo.outputPath("gas-latency.json");
      writeFileSync(file, JSON.stringify({ frame, reached, presses }, null, 2));
      await testInfo.attach("gas-latency", { path: file });

      expect(presses.map((press) => press.frames)).toEqual(
        presses.map(() => 1),
      );
      expect(reached.samples).toBe(8);
      if (!sharedRunner) expect(reached.p95).toBeLessThan(frame + 8);
    });

    if (kind.ios) {
      test("refusing motion access explains how to allow it and does not connect", async () => {
        const phone = await openPhone({ motion: "denied" });
        await phone.start();
        await expect(phone.page.locator("[data-pad=error]")).toContainText(
          "Motion access was not allowed",
        );
        await pause(1_000);
        await expect(game.phoneBadge()).toBeHidden();
      });

      test("holding the phone upright asks to turn it sideways", async () => {
        const phone = await openPhone({ portrait: true });
        await expect(
          phone.page.getByText("Turn your phone sideways"),
        ).toBeVisible();
      });
    }
  });
}
