import { writeFileSync } from "node:fs";
import path from "node:path";

const api = "https://api.openf1.org/v1";
const root = path.resolve(import.meta.dirname, "../..");
const qualifyingKey = 11392;
const raceKey = 11396;
const qualifyingStart = Date.parse("2026-10-24T21:00:00Z") / 1000;
const segmentWindows = [
  [0, 18 * 60],
  [25 * 60, 40 * 60],
  [47 * 60, 60 * 60],
];
const teamOrder = [
  "McLaren",
  "Ferrari",
  "Red Bull Racing",
  "Mercedes",
  "Aston Martin",
  "Alpine",
  "Haas F1 Team",
  "Racing Bulls",
  "Williams",
  "Audi",
  "Cadillac",
];
const compoundIndex = { SOFT: 0, MEDIUM: 1, HARD: 2 };
const shortStint = 3;

async function get(endpoint) {
  const response = await fetch(`${api}/${endpoint}`);
  if (!response.ok) throw new Error(`${endpoint}: ${String(response.status)}`);
  await new Promise((done) => setTimeout(done, 500));
  return response.json();
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
}

function qualifyingGap(result) {
  const gaps = result.gap_to_leader
    .filter((gap) => typeof gap === "number")
    .sort((a, b) => a - b);
  const used = gaps.slice(0, 2);
  return used.reduce((sum, gap) => sum + gap, 0) / used.length;
}

function runPlans(laps) {
  const plans = {};
  for (const lap of laps) {
    if (!lap.date_start || !lap.is_pit_out_lap) continue;
    const at = Date.parse(lap.date_start) / 1000 - qualifyingStart;
    segmentWindows.forEach(([from, to], segment) => {
      if (at < from - 60 || at > to) return;
      const plan = (plans[lap.driver_number] ??= [[], [], []]);
      plan[segment].push(Math.max(1, Math.round(at - from)));
    });
  }
  for (const plan of Object.values(plans))
    plan.forEach((runs) => runs.sort((a, b) => a - b));
  return plans;
}

function firstRuns(laps, plans) {
  for (const lap of laps) {
    if (lap.date_start || lap.lap_number !== 1) continue;
    const plan = (plans[lap.driver_number] ??= [[], [], []]);
    const next = laps.find(
      (other) =>
        other.driver_number === lap.driver_number && other.lap_number === 2,
    );
    if (!next?.date_start) continue;
    const at = Date.parse(next.date_start) / 1000 - qualifyingStart;
    if (at < 18 * 60) plan[0].unshift(Math.max(1, Math.round(at - 120)));
  }
}

function raceStints(stints, driver, raceLaps) {
  const own = stints
    .filter((s) => s.driver_number === driver)
    .sort((a, b) => a.stint_number - b.stint_number);
  const usable = own.filter(
    (s, i) => s.lap_end - s.lap_start + 1 >= shortStint || i === own.length - 1,
  );
  return usable.map((s, i) => ({
    compound: compoundIndex[s.compound] ?? 1,
    from: i === 0 ? 0 : Number(((s.lap_start - 1) / raceLaps).toFixed(3)),
  }));
}

const [drivers, qualifying, race, qLaps, rLaps, rStints, rPit] =
  await Promise.all(
    [
      `drivers?session_key=${String(qualifyingKey)}`,
      `session_result?session_key=${String(qualifyingKey)}`,
      `session_result?session_key=${String(raceKey)}`,
      `laps?session_key=${String(qualifyingKey)}`,
      `laps?session_key=${String(raceKey)}`,
      `stints?session_key=${String(raceKey)}`,
      `pit?session_key=${String(raceKey)}`,
    ].map((endpoint, i) =>
      new Promise((done) => setTimeout(done, i * 700)).then(() =>
        get(endpoint),
      ),
    ),
  );

const raceLaps = Math.max(...race.map((r) => r.number_of_laps));
const median_laps = Object.fromEntries(
  drivers.map((d) => [
    d.driver_number,
    median(
      rLaps
        .filter(
          (l) =>
            l.driver_number === d.driver_number &&
            l.lap_duration &&
            !l.is_pit_out_lap,
        )
        .map((l) => l.lap_duration),
    ),
  ]),
);
const bestRace = Math.min(...Object.values(median_laps));
const plans = runPlans(qLaps);
firstRuns(qLaps, plans);
const pole = qualifying[0].duration.at(-1);
const seats = {};
const grid = [...drivers]
  .sort(
    (a, b) =>
      teamOrder.indexOf(a.team_name) - teamOrder.indexOf(b.team_name) ||
      a.driver_number - b.driver_number,
  )
  .map((d) => {
    const result = qualifying.find((r) => r.driver_number === d.driver_number);
    seats[d.team_name] = (seats[d.team_name] ?? -1) + 1;
    return {
      number: d.driver_number,
      code: d.name_acronym,
      name: d.broadcast_name,
      team: d.team_name,
      teamIndex: teamOrder.indexOf(d.team_name),
      seat: seats[d.team_name],
      colour: `#${d.team_colour}`,
      qualifyingGap: Number(((qualifyingGap(result) / pole) * 100).toFixed(3)),
      raceGap: Number(
        (((median_laps[d.driver_number] - bestRace) / bestRace) * 100).toFixed(
          3,
        ),
      ),
      realGrid: result.position,
      runs: plans[d.driver_number] ?? [[], [], []],
      stints: raceStints(rStints, d.driver_number, raceLaps),
    };
  });

const output = {
  source: "OpenF1 sessions 11392 and 11396, 2026 United States Grand Prix",
  raceLaps,
  raceDistanceKm: 308.405,
  poleTime: pole,
  pitLaneLoss: median(rPit.map((p) => p.pit_duration).filter(Boolean)),
  stopTime: median(rPit.map((p) => p.stop_duration).filter(Boolean)),
  overtakes: (await get(`overtakes?session_key=${String(raceKey)}`)).length,
  qualifying: {
    segments: [
      { name: "Q1", minutes: 18, knockedOut: 6 },
      { name: "Q2", minutes: 15, knockedOut: 6 },
      { name: "Q3", minutes: 13, knockedOut: 0 },
    ],
  },
  grid,
};
writeFileSync(
  path.join(root, "content/season/austin-2026.json"),
  `${JSON.stringify(output, null, 1)}\n`,
);
process.stdout.write(`wrote ${String(grid.length)} drivers\n`);
