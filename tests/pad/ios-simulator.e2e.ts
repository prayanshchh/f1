import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
  type SafariPage,
  Simulator,
  simulatorReady,
} from "../support/ios-simulator.ts";
import {
  type TiltStep,
  analyseSteps,
  frameInterval,
  shiftLog,
  spread,
} from "../support/pad-latency.ts";
import {
  Game,
  type Sample,
  clockOffset,
  installPhoneProbe,
  nodeClock,
  phoneTilt,
} from "../support/phone-pad.ts";

const sideways = { width: 874, height: 402 };

interface SafariLogs {
  tilts: [number, number, number][];
  sent: Sample[];
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function holdSideways(phone: SafariPage): Promise<boolean> {
  return phone.evaluate(`(() => {
    Object.defineProperty(window, "innerWidth", { configurable: true, get: () => ${String(sideways.width)} });
    Object.defineProperty(window, "innerHeight", { configurable: true, get: () => ${String(sideways.height)} });
    window.dispatchEvent(new Event("resize"));
    (${installPhoneProbe.toString()})({ ios: true, motion: "granted" });
    return true;
  })()`);
}

function tilt(phone: SafariPage, degreesLeft: number): Promise<boolean> {
  return phone.evaluate(
    `(window.padProbe.tilt = ${JSON.stringify(phoneTilt(degreesLeft))}, true)`,
  );
}

function padText(phone: SafariPage, name: string): Promise<string> {
  return phone.evaluate(
    `document.querySelector("[data-pad=${name}]").textContent`,
  );
}

test.describe("phone pad in the iOS Simulator's Safari", () => {
  test.setTimeout(180_000);
  let game: Game;
  let simulator: Simulator;
  let left = 0;

  test.beforeAll(async ({ browser }, testInfo) => {
    testInfo.setTimeout(420_000);
    if (!(await simulatorReady()))
      throw new Error(
        "Install Xcode with an iPhone simulator and run: brew install ios-webkit-debug-proxy",
      );
    const baseURL = testInfo.project.use.baseURL;
    if (!baseURL) throw new Error("the phone-pad project needs a baseURL");
    game = await Game.open(browser, baseURL);
    simulator = await Simulator.boot();
    left = await game.leftKeySign();
  });

  test.afterAll(async () => {
    await (simulator as Simulator | undefined)?.close();
    await (game as Game | undefined)?.close();
  });

  test("real iOS Safari pairs over a direct link, steers the car within one game frame and lets go when it leaves", async () => {
    const testInfo = test.info();
    const phone = await simulator.open(await game.padUrl());
    try {
      await holdSideways(phone);
      await tilt(phone, 0);
      await phone.evaluate(
        `(document.querySelector("[data-pad=go]").click(), true)`,
      );
      await expect
        .poll(() => padText(phone, "link"), { timeout: 30_000 })
        .toBe("Live");
      await expect(game.phoneBadge()).toBeVisible();
      for (const route of await game.route())
        expect(route).toMatch(/^(host|prflx)-(host|prflx)$/);
      await pause(3_500);

      await tilt(phone, 20);
      await expect
        .poll(async () => Math.sign(await game.settledSteer()))
        .toBe(left);
      await tilt(phone, -20);
      await expect
        .poll(async () => Math.sign(await game.settledSteer()))
        .toBe(-left);

      const phoneClock = await clockOffset(() =>
        phone.evaluate<number>("performance.timeOrigin + performance.now()"),
      );
      const gameClock = await clockOffset(game.page);
      await game.clearLogs();
      await phone.evaluate(
        "(window.padProbe.tilts.length = 0, window.padProbe.sent.length = 0, true)",
      );
      await pause(200);
      const steps: TiltStep[] = [];
      for (let i = 0; i < 16; i++) {
        const degreesLeft = i % 2 === 0 ? 20 : -20;
        steps.push({
          degreesLeft,
          setAt: nodeClock(),
          reading: phoneTilt(degreesLeft).up,
        });
        await tilt(phone, degreesLeft);
        await pause(600 + Math.random() * 50);
      }
      const phoneLogs = await phone.evaluate<SafariLogs>(
        "({ tilts: window.padProbe.tilts, sent: window.padProbe.sent })",
      );
      const gameLogs = await game.logs();
      const stamps = (log: Sample[]) =>
        log.map(([at, steer]): [number, number] => [at, steer]);
      const results = analyseSteps(
        {
          tilts: shiftLog(phoneLogs.tilts, phoneClock.offset),
          sent: shiftLog(stamps(phoneLogs.sent), phoneClock.offset),
          received: shiftLog(stamps(gameLogs.received), gameClock.offset),
          handed: shiftLog(gameLogs.handed, gameClock.offset),
          car: shiftLog(stamps(gameLogs.car), gameClock.offset),
        },
        steps,
      );
      const frame = frameInterval(stamps(gameLogs.car));
      const reached = spread(results.map((result) => result.carReaches90));
      const file = testInfo.outputPath("ios-simulator-latency.json");
      writeFileSync(
        file,
        JSON.stringify(
          { frame, clockError: phoneClock.error, reached, steps: results },
          null,
          2,
        ),
      );
      await testInfo.attach("ios-simulator-latency", { path: file });
      expect(reached.samples).toBe(steps.length);
      expect(results.map((result) => result.carFrames)).toEqual(
        results.map(() => 1),
      );
      if (!process.env["CI"])
        expect(reached.p95).toBeLessThan(frame + 8 + phoneClock.error);

      const since = nodeClock();
      await phone.evaluate(`(location.replace("about:blank"), true)`);
      await expect(game.phoneBadge()).toBeHidden({ timeout: 2_000 });
      expect(nodeClock() - since).toBeLessThan(2_000);
    } finally {
      phone.close();
    }
  });
});
