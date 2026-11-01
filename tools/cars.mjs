import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";

const teams = JSON.parse(readFileSync("content/cars/teams.json", "utf8"));
const size = process.argv[2] ?? "8192";
const only = process.argv.slice(3);

for (const team of teams) {
  if (only.length > 0 && !only.includes(team.id)) continue;
  const work = `build/car/${team.id}`;
  mkdirSync(`content/cars/${team.id}`, { recursive: true });
  execFileSync(
    "blender",
    [
      "-b",
      "--factory-startup",
      "-P",
      "tools/car/build.py",
      "--",
      team.id,
      work,
      size,
    ],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  execFileSync(
    "uv",
    [
      "run",
      "--project",
      "tools/cota",
      "python",
      "tools/car/livery.py",
      team.id,
      work,
    ],
    { stdio: "inherit" },
  );
}
execFileSync(
  "uv",
  ["run", "--project", "tools/cota", "python", "tools/car/art.py"],
  { stdio: "inherit" },
);
