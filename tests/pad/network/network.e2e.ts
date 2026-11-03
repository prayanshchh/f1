import { writeFileSync } from "node:fs";
import { type Browser, expect, test } from "@playwright/test";
import { Lab, NetworkGame, dockerReady } from "../../support/pad-network.ts";
import { shiftLog, spread } from "../../support/pad-latency.ts";
import {
  Phone,
  type Sample,
  clockOffset,
  nodeClock,
  phoneKinds,
} from "../../support/phone-pad.ts";

const android = phoneKinds.find((kind) => kind.name === "Android");
const directRoute = /^(host|prflx)-(host|prflx)$/;
const netemDelay = 10;
const netemJitter = 5;

interface Players {
  game: NetworkGame;
  phone: Phone;
}

async function players(
  gameBrowser: Browser,
  phoneBrowser: Browser,
  site: string,
): Promise<Players> {
  if (!android) throw new Error("no Android phone kind");
  const game = await NetworkGame.open(gameBrowser, site);
  const phone = await Phone.open(phoneBrowser, android, await game.padUrl());
  return { game, phone };
}

async function pairAndSteer({ game, phone }: Players) {
  await phone.startAndCalibrate();
  const paired = await game.badge().isVisible();
  const routes = await game.routes();
  const pairing = phone.requests().length;
  await phone.tilt(20);
  await expect.poll(() => game.steer()).toBeGreaterThan(0.1);
  await phone.tilt(-20);
  await expect.poll(() => game.steer()).toBeLessThan(-0.1);
  return { paired, routes, laterRequests: phone.requests().slice(pairing) };
}

async function blockedPairing({ game, phone }: Players) {
  await phone.start();
  const notice = phone.page.locator("[data-pad=notice]");
  await expect(notice).toBeVisible({ timeout: 30_000 });
  return {
    notice: (await notice.textContent()) ?? "",
    paired: await game.badge().isVisible(),
    steer: await game.steer(),
  };
}

function expectDirect(result: Awaited<ReturnType<typeof pairAndSteer>>) {
  expect(result.paired).toBe(true);
  expect(result.routes.length).toBeGreaterThan(0);
  for (const route of result.routes) expect(route).toMatch(directRoute);
  expect(result.laterRequests).toEqual([]);
}

function expectHotspotAdvice(
  result: Awaited<ReturnType<typeof blockedPairing>>,
) {
  expect(result.notice).toContain("hotspot");
  expect(result.paired).toBe(false);
  expect(result.steer).toBeNull();
}

function arrivals(sent: Sample[], received: Sample[], since: number): number[] {
  const changes = sent.filter(
    (sample, i) =>
      i > 0 && sample[0] >= since && sample[1] !== sent[i - 1]?.[1],
  );
  return changes.map(([at, steer]) => {
    const arrived = received.find(
      ([when, value]) => when >= at - 1 && value === steer,
    );
    return arrived ? arrived[0] - at : Number.NaN;
  });
}

test.describe("phone pad on simulated networks", () => {
  test.setTimeout(240_000);
  let lab: Lab;

  test.beforeAll(async () => {
    if (!(await dockerReady()))
      throw new Error("Start Docker: these tests build networks in containers");
    test.info().setTimeout(600_000);
    lab = await Lab.open();
  });

  test.afterEach(async () => {
    await lab.reset();
  });

  test.afterAll(async () => {
    await lab.close();
  });

  test("same Wi-Fi: the phone pairs and drives the game directly", async () => {
    const wifi = await lab.network("wifi");
    const site = await lab.site();
    const game = await lab.browser("game", [wifi]);
    const phone = await lab.browser("phone", [wifi]);
    expectDirect(await pairAndSteer(await players(game, phone, site)));
  });

  test("computer on the phone's hotspot: the phone pairs through its own hotspot", async () => {
    const cell = await lab.network("cell");
    const hotspot = await lab.network("hotspot");
    const site = await lab.site();
    const phone = await lab.browser(
      "phone",
      [cell, hotspot],
      ["--sysctl", "net.ipv4.ip_forward=1"],
    );
    const game = await lab.browser("game", [hotspot]);
    const phoneOnCell = await lab.ip("phone", cell);
    const phoneOnHotspot = await lab.ip("phone", hotspot);
    await lab.inside(
      "phone",
      `uplink=$(ip -o -4 addr show | awk '$4 ~ /^${phoneOnCell}\\// {print $2}')
       iptables -t nat -A POSTROUTING -o "$uplink" -j MASQUERADE`,
    );
    await lab.inside("game", `ip route replace default via ${phoneOnHotspot}`);
    expectDirect(await pairAndSteer(await players(game, phone, site)));
  });

  test("Wi-Fi that keeps devices apart: the phone suggests the hotspot and nothing connects", async () => {
    const roomA = await lab.network("wifi-a");
    const roomB = await lab.network("wifi-b");
    const site = await lab.site();
    const game = await lab.browser("game", [roomA]);
    const phone = await lab.browser("phone", [roomB]);
    expectHotspotAdvice(await blockedPairing(await players(game, phone, site)));
  });

  test("Wi-Fi that blocks local name lookups: the phone suggests the hotspot", async () => {
    const wifi = await lab.network("wifi");
    const site = await lab.site();
    const game = await lab.browser("game", [wifi]);
    const phone = await lab.browser("phone", [wifi]);
    for (const device of ["game", "phone"])
      await lab.inside(
        device,
        `iptables -A INPUT -p udp --dport 5353 -j DROP
         iptables -A OUTPUT -p udp --dport 5353 -j DROP`,
      );
    expectHotspotAdvice(await blockedPairing(await players(game, phone, site)));
  });

  test("lossy, jittery Wi-Fi: every tilt still reaches the game quickly", async () => {
    const wifi = await lab.network("wifi");
    const site = await lab.site();
    const game = await lab.browser("game", [wifi]);
    const phone = await lab.browser("phone", [wifi]);
    const both = await players(game, phone, site);
    await both.phone.startAndCalibrate();
    await lab.inside(
      "phone",
      `tc qdisc add dev eth0 root netem delay ${String(netemDelay)}ms ${String(netemJitter)}ms loss 5%`,
    );
    const phoneClock = await clockOffset(both.phone.page);
    const gameClock = await clockOffset(both.game.page);
    const since = nodeClock();
    let stale = 0;
    for (let i = 0; i < 30; i++) {
      await both.phone.tilt(i % 2 === 0 ? 15 + i : -15 - i);
      for (let check = 0; check < 4; check++) {
        if ((await both.game.steer()) === null) stale += 1;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    const sent = shiftLog((await both.phone.logs()).sent, phoneClock.offset);
    const received = shiftLog(await both.game.received(), gameClock.offset);
    const delays = arrivals(sent, received, since);
    const reached = spread(delays);
    const file = test.info().outputPath("lossy-wifi-latency.json");
    writeFileSync(file, JSON.stringify({ stale, reached, delays }, null, 2));
    await test.info().attach("lossy-wifi-latency", { path: file });
    expect(delays).toHaveLength(30);
    expect(stale).toBe(0);
    expect(reached.samples).toBe(delays.length);
    expect(reached.p95).toBeLessThan(netemDelay + netemJitter * 2 + 20);
  });
});
