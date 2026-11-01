import path from "node:path";
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { readModel } from "../support/gltf.ts";
import { repoRoot } from "../support/repo.ts";

const file = path.join(repoRoot, "content/tracks/cota/crew.glb");
const header = readFileSync(file).subarray(0, 40).toString("latin1");
const lfsPointer = header.startsWith("version https://git-lfs");
const source = readFileSync(
  path.join(repoRoot, "apps/client/src/game/pit-crew.ts"),
  "utf8",
);

describe.skipIf(lfsPointer)("pit crew model", () => {
  test("has a skinned rig with a clip for every role the game plays", async () => {
    const root = (await readModel(file)).getRoot();
    expect(root.listSkins().length).toBeGreaterThan(0);
    const clips = root.listAnimations().map((a) => a.getName());
    const roles = [...source.matchAll(/\| "(\w+)"/g)].map((m) => m[1] ?? "");
    expect(roles.length).toBeGreaterThan(4);
    for (const clip of [...roles, "ready", "run"])
      expect(clips).toContain(clip);
    const joints = (root.listSkins()[0]?.listJoints() ?? []).map((j) =>
      j.getName(),
    );
    expect(joints).toEqual(expect.arrayContaining(["hand_l", "hand_r"]));
  });
});
