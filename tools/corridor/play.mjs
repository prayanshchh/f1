import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const say = (...parts) => process.stdout.write(`${parts.join(" ")}\n`);
const warn = (...parts) => process.stderr.write(`${parts.join(" ")}\n`);

const root = path.resolve(import.meta.dirname, "../..");
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [key, ...rest] = a.replace(/^--/, "").split("=");
    return [key, rest.join("=")];
  }),
);
const base = process.env.BASE ?? "http://127.0.0.1:5261";
const gpu = args.gpu === "1";
const width = Number(args.width ?? 1280);
const height = Number(args.height ?? 720);
const scale = Number(args.scale ?? 1.5);
const warm = Number(args.warm ?? 6);
const seconds = Number(args.seconds ?? 20);
const shots = Number(args.shots ?? 0);
const side = Number(args.side ?? 0);
const corridor = args.ultra !== "1";
const out = path.join(root, "build/corridor/report", args.name ?? "play");
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  channel: "chrome",
  headless: args.headless !== "0",
  args: [
    "--disable-renderer-backgrounding",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--autoplay-policy=no-user-gesture-required",
    ...(gpu
      ? ["--enable-gpu", "--use-angle=metal", "--enable-unsafe-webgpu"]
      : ["--disable-gpu"]),
    ...(args.uncapped === "1"
      ? ["--disable-frame-rate-limit", "--disable-gpu-vsync"]
      : []),
  ],
});
const context = await browser.newContext({
  viewport: { width, height },
  deviceScaleFactor: scale,
});
const page = await context.newPage();
page.on("pageerror", (e) => warn("PAGEERROR", e.message));
await page.route(/\/@vite\/client/, (route) =>
  route.fulfill({
    status: 200,
    contentType: "text/javascript",
    body: [
      "export const createHotContext = () => ({ accept() {}, acceptExports() {}, dispose() {}, prune() {}, invalidate() {}, decline() {}, on() {}, off() {}, send() {}, data: {} });",
      "const styles = new Map();",
      "export const updateStyle = (id, css) => { let s = styles.get(id); if (!s) { s = document.createElement('style'); document.head.appendChild(s); styles.set(id, s); } s.textContent = css; };",
      "export const removeStyle = (id) => { styles.get(id)?.remove(); styles.delete(id); };",
      "export const injectQuery = (url) => url;",
      "export class ErrorOverlay {}",
    ].join("\n"),
  }),
);
page.on("console", (m) => {
  if (m.type() === "error") warn("CONSOLE", m.text().slice(0, 300));
});
if (args.hz)
  await page.addInitScript((hz) => {
    const raw = window.requestAnimationFrame.bind(window);
    const period = 1000 / hz;
    let queue = new Map();
    let id = 0;
    let next = 0;
    let pumping = false;
    const pump = (time) => {
      if (time + 0.5 < next) {
        raw(pump);
        return;
      }
      next = time - next > period ? time + period : next + period;
      const due = queue;
      queue = new Map();
      pumping = false;
      for (const callback of due.values()) callback(time);
      if (queue.size > 0 && !pumping) {
        pumping = true;
        raw(pump);
      }
    };
    window.requestAnimationFrame = (callback) => {
      queue.set(++id, callback);
      if (!pumping) {
        pumping = true;
        raw(pump);
      }
      return id;
    };
    window.cancelAnimationFrame = (handle) => {
      queue.delete(handle);
    };
  }, Number(args.hz));
await page.addInitScript((session) => {
  localStorage.setItem(
    "revracers.settings",
    JSON.stringify({ session, laps: 5, buildUp: false }),
  );
}, args.session ?? "race");
const started = Date.now();
await page.goto(
  `${base}/?autostart=1&autopilot&debug${corridor ? "&corridor" : ""}${args.query ? `&${args.query}` : ""}`,
  { waitUntil: "commit" },
);
await page.waitForFunction(
  () => ["running", "error"].includes(document.body.dataset.driveStatus),
  null,
  { timeout: 900000 },
);
const status = await page.evaluate(() => document.body.dataset.driveStatus);
if (status !== "running") throw new Error(`drive status ${status}`);
say(`running after ${((Date.now() - started) / 1000).toFixed(1)} s`);
await page.waitForTimeout(warm * 1000);
if (args.eval)
  say(
    "eval",
    JSON.stringify(await page.evaluate((code) => eval(code), args.eval)),
  );

const sample = () =>
  page.evaluate(async (ms) => {
    const view = window.f1Corridor?.view;
    const before = view ? view.presented : 0;
    const deltas = [];
    const t0 = performance.now();
    let last = t0;
    await new Promise((done) => {
      const tick = (t) => {
        deltas.push(t - last);
        last = t;
        if (t - t0 < ms) requestAnimationFrame(tick);
        else done();
      };
      requestAnimationFrame(tick);
    });
    const secs = (performance.now() - t0) / 1000;
    const timings = view
      ? view.timings.slice(-(view.presented - before) || view.timings.length)
      : [];
    const stats = view ? view.stats() : null;
    const engine = window.f1Debug.engine;
    return {
      secs,
      deltas,
      timings,
      stats,
      distance: engine.cars()[2] ?? null,
    };
  }, 2000);

if (args.ab)
  await page.evaluate(() => {
    const view = window.f1Corridor.view;
    const render = view.render.bind(view);
    window.corridorSkip = false;
    view.render = (track, camera, cars, light) =>
      render(track, camera, window.corridorSkip ? [] : cars, light);
  });
const windows = [];
const begin = Date.now();
let shot = 0;
while (Date.now() - begin < seconds * 1000) {
  if (args.ab)
    await page.evaluate(
      (skip) => {
        window.corridorSkip = skip;
      },
      windows.length % 2 === 1,
    );
  if (args.toggle)
    await page.evaluate(
      ([code, on]) => new Function("on", code)(on),
      [args.toggle, windows.length % 2 === 0],
    );
  const w = await sample();
  windows.push(w);
  const frames = w.timings.length / w.secs;
  const sorted = w.deltas.slice(1).sort((a, b) => a - b);
  const renders = w.timings.map((t) => t.render).sort((a, b) => a - b);
  const presents = w.timings.map((t) => t.present).sort((a, b) => a - b);
  const tris = w.timings.map((t) => t.triangles).sort((a, b) => a - b);
  const rasters = w.timings.map((t) => t.raster).sort((a, b) => a - b);
  const lines = w.timings.map((t) => t.lines).sort((a, b) => a - b);
  say(
    (args.ab ? (windows.length % 2 === 0 ? "no cars  " : "cars     ") : "") +
      (args.toggle ? (windows.length % 2 === 1 ? "ON  " : "off ") : "") +
      `raf ${(w.deltas.length / w.secs).toFixed(0)}/s p95 ${sorted[Math.floor(sorted.length * 0.95)]?.toFixed(1)} ms` +
      (corridor
        ? ` | cpu frames ${frames.toFixed(0)}/s render median ${renders[renders.length >> 1]?.toFixed(2)} p95 ${renders[Math.floor(renders.length * 0.95)]?.toFixed(2)} ms raster ${rasters[rasters.length >> 1]?.toFixed(2)} present ${presents[presents.length >> 1]?.toFixed(2)} ms tris ${tris[tris.length >> 1]} lines ${lines[0]}-${lines[lines.length - 1]}`
        : ""),
  );
  if (shots > 0 && windows.length % shots === 0)
    await page.screenshot({ path: path.join(out, `shot-${shot++}.png`) });
}

for (let i = 0; i < side; i++) {
  await page.waitForTimeout(Number(args.gap ?? 8) * 1000);
  await page.evaluate(async () => {
    const renderer = window.f1Debug.renderer;
    window.__corridorLoop = renderer._animation._animationLoop;
    renderer.setAnimationLoop(null);
    document.querySelector(".hud").hidden = true;
    await new Promise((r) => setTimeout(r, 300));
    const corridor = window.f1Corridor;
    corridor.draw();
    while (!corridor.view.settled()) await new Promise((r) => setTimeout(r, 5));
  });
  await page.screenshot({ path: path.join(out, `side-${i}-cpu.png`) });
  await page.evaluate(async () => {
    const canvas = document.querySelector("canvas[data-testid=drive-canvas]");
    canvas.style.visibility = "visible";
    window.f1Corridor.view.canvas.style.visibility = "hidden";
    for (let k = 0; k < 4; k++) {
      window.f1Ultra();
      await new Promise((r) => requestAnimationFrame(r));
    }
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, `side-${i}-ultra.png`) });
  await page.evaluate(() => {
    document.querySelector(
      "canvas[data-testid=drive-canvas]",
    ).style.visibility = "hidden";
    window.f1Corridor.view.canvas.style.visibility = "visible";
    document.querySelector(".hud").hidden = false;
    window.f1Debug.renderer.setAnimationLoop(window.__corridorLoop);
  });
}

if (args.toggle)
  for (const [label, parity] of [
    ["ON ", 1],
    ["off", 0],
  ]) {
    const picked = windows.filter((_, i) => i % 2 === 1 - parity);
    const times = picked
      .flatMap((w) => w.timings.map((t) => t.render))
      .sort((a, b) => a - b);
    const frames =
      picked.reduce((n, w) => n + w.timings.length, 0) /
      picked.reduce((n, w) => n + w.secs, 0);
    say(
      `${label} cpu frames ${frames.toFixed(1)}/s render median ${times[times.length >> 1]?.toFixed(2)} p95 ${times[Math.floor(times.length * 0.95)]?.toFixed(2)} ms`,
    );
  }
const all = windows.flatMap((w) => w.timings);
const renders = all.map((t) => t.render).sort((a, b) => a - b);
const deltas = windows.flatMap((w) => w.deltas.slice(1)).sort((a, b) => a - b);
const summary = {
  gpu,
  viewport: [width, height, scale],
  rafPerSecond: deltas.length / windows.reduce((s, w) => s + w.secs, 0),
  rafP95: deltas[Math.floor(deltas.length * 0.95)],
  cpuFramesPerSecond: all.length / windows.reduce((s, w) => s + w.secs, 0),
  renderMedian: renders[renders.length >> 1],
  renderP95: renders[Math.floor(renders.length * 0.95)],
};
say(JSON.stringify(summary));
writeFileSync(path.join(out, "summary.json"), JSON.stringify(summary, null, 1));
await browser.close();
