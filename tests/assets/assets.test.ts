import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  tiers,
  type AssetBudgets,
  type AssetClass,
  type Tier,
} from "../support/asset-budgets.ts";
import {
  embeddedImages,
  isKtx2,
  ktx2Info,
  readGlb,
  readModel,
  sceneBounds,
  triangleCount,
  type Glb,
} from "../support/gltf.ts";
import { repoRoot, run, type RunResult } from "../support/repo.ts";
import {
  fixtureBudgets,
  modelBytes,
  pngBytes,
  sourceTree,
  type SourceAsset,
  type SourceTree,
} from "./support/fixtures.ts";

interface LodEntry {
  file: string;
  triangles: number;
  bytes: number;
}

interface PackAsset {
  id: string;
  class?: AssetClass;
  lods?: LodEntry[];
  texture?: { file: string; width: number; height: number; bytes: number };
  bytes: number;
}

interface PackManifest {
  tier: Tier;
  assets: PackAsset[];
  bytes: number;
}

function build(args: readonly string[]): RunResult {
  return run("pnpm", ["--silent", "run", "assets:build", ...args]);
}

function buildTree(tree: SourceTree): RunResult {
  return build([
    "--source",
    tree.root,
    "--out",
    tree.out,
    "--budgets",
    tree.budgets,
  ]);
}

function writeTree(
  tree: SourceTree,
  assets: SourceAsset[],
  budgets: AssetBudgets = fixtureBudgets,
): void {
  tree.write("assets.json", JSON.stringify({ assets }));
  tree.write("budgets.json", JSON.stringify(budgets));
}

function pack(out: string, tier: Tier): PackManifest {
  return JSON.parse(
    readFileSync(path.join(out, tier, "manifest.json"), "utf8"),
  ) as PackManifest;
}

function filesUnder(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }
  return readdirSync(directory, { recursive: true, encoding: "utf8" })
    .filter((file) => statSync(path.join(directory, file)).isFile())
    .sort();
}

function expectCleanFailure(
  result: RunResult,
  tree: SourceTree,
  mentions: RegExp[],
): void {
  expect(result.code, result.output).not.toBe(0);
  expect(result.code).not.toBeNull();
  for (const pattern of mentions) {
    expect(result.output).toMatch(pattern);
  }
  expect(
    filesUnder(tree.out),
    "a failed build must not leave a partial pack",
  ).toEqual([]);
}

let tree: SourceTree;
let source: Record<
  string,
  { triangles: number; bounds: { min: number[]; max: number[] } }
>;

beforeAll(async () => {
  tree = sourceTree();
  const body = await modelBytes({ cells: 100, baseColor: 256, normal: 128 });
  const cone = await modelBytes({ cells: 50, baseColor: 64, normal: 64 });
  tree.write("models/body.glb", body);
  tree.write("models/cone.glb", cone);
  tree.write("textures/sky.png", pngBytes(256, 128, 9));
  writeTree(tree, [
    { id: "body", class: "car", model: "models/body.glb" },
    { id: "cone", class: "prop", model: "models/cone.glb" },
    { id: "sky", texture: "textures/sky.png", colorSpace: "srgb" },
  ]);
  source = {};
  for (const id of ["body", "cone"]) {
    const document = await readModel(
      path.join(tree.root, "models", `${id}.glb`),
    );
    const bounds = sceneBounds(document);
    source[id] = {
      triangles: triangleCount(document),
      bounds: { min: [...bounds.min], max: [...bounds.max] },
    };
  }
  const result = buildTree(tree);
  if (result.code !== 0) {
    throw new Error(`the fixture build failed:\n${result.output}`);
  }
});

afterAll(() => {
  tree.remove();
});

test("the repository's own content builds a pack for every tier", () => {
  const result = build([]);
  expect(result.code, result.output).toBe(0);
  for (const tier of tiers) {
    expect(pack(path.join(repoRoot, "build/assets"), tier).tier).toBe(tier);
  }
});

test("every tier gets its own pack listing every asset", () => {
  expect(readdirSync(tree.out).sort()).toEqual([...tiers].sort());
  for (const tier of tiers) {
    const manifest = pack(tree.out, tier);
    expect(manifest.tier).toBe(tier);
    expect(manifest.assets.map((asset) => asset.id).sort()).toEqual([
      "body",
      "cone",
      "sky",
    ]);
  }
});

test("pack manifests report the real file sizes and stay inside the byte budgets", () => {
  for (const tier of tiers) {
    const manifest = pack(tree.out, tier);
    const listed = new Set<string>(["manifest.json"]);
    let total = 0;
    for (const asset of manifest.assets) {
      const files = [
        ...(asset.lods ?? []),
        ...(asset.texture === undefined ? [] : [asset.texture]),
      ];
      let bytes = 0;
      for (const entry of files) {
        listed.add(entry.file);
        expect(entry.bytes).toBe(
          statSync(path.join(tree.out, tier, entry.file)).size,
        );
        bytes += entry.bytes;
      }
      expect(asset.bytes).toBe(bytes);
      if (asset.class !== undefined) {
        expect(asset.bytes).toBeLessThanOrEqual(
          fixtureBudgets.tiers[tier].bytes[asset.class],
        );
      }
      total += bytes;
    }
    expect(manifest.bytes).toBe(total);
    expect(filesUnder(path.join(tree.out, tier)), "no unlisted files").toEqual(
      [...listed].sort(),
    );
  }
});

interface ModelAsset {
  id: string;
  assetClass: AssetClass;
  lods: LodEntry[];
}

function modelAssets(tier: Tier): ModelAsset[] {
  return pack(tree.out, tier).assets.flatMap((asset) =>
    asset.class === undefined || asset.lods === undefined
      ? []
      : [{ id: asset.id, assetClass: asset.class, lods: asset.lods }],
  );
}

type GlbDetails = Glb["json"] & { accessors?: { bufferView?: number }[] };

function expectMeshoptGeometry(json: GlbDetails, label: string): void {
  const views = json.bufferViews ?? [];
  for (const accessor of json.accessors ?? []) {
    const view = views[accessor.bufferView ?? -1];
    expect(
      view?.extensions?.["EXT_meshopt_compression"],
      `${label}: accessor data must be meshopt-compressed`,
    ).toBeDefined();
  }
}

function expectBasisTextures(json: GlbDetails, label: string): void {
  for (const texture of json.textures ?? []) {
    expect(
      texture.source,
      `${label}: no uncompressed fallback image`,
    ).toBeUndefined();
    expect(texture.extensions?.["KHR_texture_basisu"], label).toBeDefined();
  }
  for (const image of json.images ?? []) {
    expect(image.mimeType, label).toBe("image/ktx2");
  }
}

function expectMeshoptAndBasis(glb: Glb, label: string): void {
  expect(glb.json.extensionsRequired, label).toEqual(
    expect.arrayContaining(["EXT_meshopt_compression", "KHR_texture_basisu"]),
  );
  expectMeshoptGeometry(glb.json, label);
  expectBasisTextures(glb.json, label);
}

function expectMipmappedKtx2(
  bytes: Uint8Array,
  size: { width: number; height: number },
  transfer: number,
  label: string,
): void {
  expect(isKtx2(bytes), label).toBe(true);
  const info = ktx2Info(bytes);
  expect({ width: info.width, height: info.height }, label).toEqual(size);
  expect(info.levels, `${label}: full mip chain`).toBe(
    Math.log2(Math.max(size.width, size.height)) + 1,
  );
  expect([1, 2], `${label}: BasisLZ or Zstandard supercompression`).toContain(
    info.supercompression,
  );
  expect([160, 166], `${label}: ETC1S or UASTC`).toContain(info.colorModel);
  expect(info.transfer, `${label}: transfer function`).toBe(transfer);
  expect(info.vkFormat, label).toBe(0);
}

const SRGB = 2;
const LINEAR = 1;

const sourceTextureSizes: Record<string, { base: number; normal: number }> = {
  body: { base: 256, normal: 128 },
  cone: { base: 64, normal: 64 },
};

async function expectModelTextures(
  file: string,
  label: string,
  sizes: { base: number; normal: number },
): Promise<void> {
  const glb = readGlb(file);
  expectMeshoptAndBasis(glb, label);
  expect(embeddedImages(glb)).toHaveLength(2);
  const material = (await readModel(file)).getRoot().listMaterials()[0];
  const base = material?.getBaseColorTexture()?.getImage() ?? null;
  const normal = material?.getNormalTexture()?.getImage() ?? null;
  if (base === null || normal === null) {
    throw new Error(`${label}: the material lost its textures`);
  }
  expectMipmappedKtx2(
    base,
    { width: sizes.base, height: sizes.base },
    SRGB,
    `${label} base colour`,
  );
  expectMipmappedKtx2(
    normal,
    { width: sizes.normal, height: sizes.normal },
    LINEAR,
    `${label} normal`,
  );
}

function boundsDrift(
  bounds: { min: ArrayLike<number>; max: ArrayLike<number> },
  original: { min: number[]; max: number[] },
): number {
  return Math.max(
    ...[0, 1, 2].flatMap((axis) => [
      Math.abs((bounds.min[axis] ?? 0) - (original.min[axis] ?? 0)),
      Math.abs((bounds.max[axis] ?? 0) - (original.max[axis] ?? 0)),
    ]),
  );
}

function sourceOf(id: string) {
  const entry = source[id];
  if (entry === undefined) {
    throw new Error(`no source facts for ${id}`);
  }
  return entry;
}

describe("models", () => {
  test("are meshopt-compressed GLBs with Basis Universal KTX2 textures sized for the tier", async () => {
    for (const tier of tiers) {
      const limit = fixtureBudgets.tiers[tier].maxTextureSize;
      for (const asset of modelAssets(tier)) {
        const sizes = sourceTextureSizes[asset.id] ?? { base: 0, normal: 0 };
        for (const lod of asset.lods) {
          await expectModelTextures(
            path.join(tree.out, tier, lod.file),
            `${tier}/${lod.file}`,
            {
              base: Math.min(sizes.base, limit),
              normal: Math.min(sizes.normal, limit),
            },
          );
        }
      }
    }
  });

  test("have the class's number of detail levels, each at most half the previous", async () => {
    for (const tier of tiers) {
      for (const asset of modelAssets(tier)) {
        const { lods } = asset;
        expect(lods.map((lod) => lod.file)).toEqual(
          lods.map((_, level) => `${asset.id}.lod${String(level)}.glb`),
        );
        expect(lods).toHaveLength(fixtureBudgets.lodCount[asset.assetClass]);
        let limit = fixtureBudgets.tiers[tier].triangles[asset.assetClass];
        for (const lod of lods) {
          const counted = triangleCount(
            await readModel(path.join(tree.out, tier, lod.file)),
          );
          expect(lod.triangles, `${tier}/${lod.file}`).toBe(counted);
          expect(counted).toBeGreaterThan(0);
          expect(counted, `${tier}/${lod.file}`).toBeLessThanOrEqual(limit);
          limit = counted * 0.5;
        }
      }
    }
  });

  test("keep full detail when it fits and are not over-simplified when it does not", () => {
    for (const tier of tiers) {
      for (const asset of modelAssets(tier)) {
        const original = sourceOf(asset.id).triangles;
        const budget = fixtureBudgets.tiers[tier].triangles[asset.assetClass];
        const first = asset.lods[0]?.triangles;
        const label = `${tier}/${asset.id}`;
        if (original <= budget) {
          expect(first, label).toBe(original);
        } else {
          expect(first, label).toBeGreaterThanOrEqual(budget * 0.4);
        }
      }
    }
  });

  test("keep their shape at every detail level", async () => {
    for (const tier of tiers) {
      for (const asset of modelAssets(tier)) {
        const original = sourceOf(asset.id).bounds;
        const diagonal = Math.hypot(
          ...original.max.map(
            (value, axis) => value - (original.min[axis] ?? 0),
          ),
        );
        for (const lod of asset.lods) {
          const bounds = sceneBounds(
            await readModel(path.join(tree.out, tier, lod.file)),
          );
          expect(
            boundsDrift(bounds, original),
            `${tier}/${lod.file}`,
          ).toBeLessThanOrEqual(diagonal * 0.1);
        }
      }
    }
  });
});

test("standalone textures become mipmapped KTX2 files no larger than the tier allows", () => {
  for (const tier of tiers) {
    const sky = pack(tree.out, tier).assets.find((asset) => asset.id === "sky");
    const limit = fixtureBudgets.tiers[tier].maxTextureSize;
    const width = Math.min(256, limit);
    const height = width / 2;
    expect(sky?.texture).toMatchObject({ file: "sky.ktx2", width, height });
    expectMipmappedKtx2(
      readFileSync(path.join(tree.out, tier, "sky.ktx2")),
      { width, height },
      SRGB,
      `${tier}/sky`,
    );
  }
});

test("building the same sources twice gives byte-identical packs", () => {
  const again = sourceTree();
  try {
    for (const file of filesUnder(tree.root).filter(
      (name) => !name.startsWith("out/"),
    )) {
      again.write(file, readFileSync(path.join(tree.root, file)));
    }
    const result = buildTree(again);
    expect(result.code, result.output).toBe(0);
    const files = filesUnder(tree.out);
    expect(filesUnder(again.out)).toEqual(files);
    for (const file of files) {
      expect(
        readFileSync(path.join(again.out, file)).equals(
          readFileSync(path.join(tree.out, file)),
        ),
        file,
      ).toBe(true);
    }
  } finally {
    again.remove();
  }
});

describe("a build fails without writing anything when", () => {
  let broken: SourceTree;

  beforeAll(async () => {
    broken = sourceTree();
    broken.write(
      "models/big.glb",
      await modelBytes({ cells: 101, baseColor: 64, normal: 64 }),
    );
    broken.write(
      "models/small.glb",
      await modelBytes({ cells: 10, baseColor: 64, normal: 64 }),
    );
    broken.write(
      "models/odd.glb",
      await modelBytes({ cells: 10, baseColor: 96, normal: 64 }),
    );
    broken.write("textures/huge.png", pngBytes(512, 512, 3));
    broken.write("textures/odd.png", pngBytes(200, 128, 4));
  });

  afterAll(() => {
    broken.remove();
  });

  const cases: [string, SourceAsset[], AssetBudgets | undefined, RegExp[]][] = [
    [
      "a model has more triangles than the ultra budget",
      [{ id: "big", class: "car", model: "models/big.glb" }],
      undefined,
      [/big/, /20,?402/, /20,?000/],
    ],
    [
      "a texture is larger than the ultra limit",
      [{ id: "huge", texture: "textures/huge.png", colorSpace: "srgb" }],
      undefined,
      [/huge/, /512/, /256/],
    ],
    [
      "a texture is not a power of two",
      [{ id: "odd", texture: "textures/odd.png", colorSpace: "linear" }],
      undefined,
      [/odd/, /power of two/i],
    ],
    [
      "a model texture is not a power of two",
      [{ id: "odd-model", class: "prop", model: "models/odd.glb" }],
      undefined,
      [/odd-model/, /power of two/i],
    ],
    [
      "a pack is over its byte budget",
      [{ id: "small", class: "prop", model: "models/small.glb" }],
      {
        ...fixtureBudgets,
        tiers: {
          ...fixtureBudgets.tiers,
          low: {
            ...fixtureBudgets.tiers.low,
            bytes: { car: 600_000, prop: 10 },
          },
        },
      },
      [/small/, /low/, /bytes/i],
    ],
    [
      "a source file is missing",
      [{ id: "ghost", class: "prop", model: "models/ghost.glb" }],
      undefined,
      [/ghost/],
    ],
    [
      "two assets share an id",
      [
        { id: "small", class: "prop", model: "models/small.glb" },
        { id: "small", texture: "textures/huge.png", colorSpace: "srgb" },
      ],
      undefined,
      [/small/, /duplicate/i],
    ],
    [
      "an asset has an unknown class",
      [{ id: "small", class: "boat", model: "models/small.glb" }],
      undefined,
      [/boat/],
    ],
    [
      "a texture has no colour space",
      [{ id: "plain", texture: "textures/odd.png" }],
      undefined,
      [/plain/, /colou?r ?space/i],
    ],
    [
      "an id is not kebab-case",
      [{ id: "Small Cone", class: "prop", model: "models/small.glb" }],
      undefined,
      [/Small Cone/],
    ],
    [
      "the budgets miss a tier",
      [{ id: "small", class: "prop", model: "models/small.glb" }],
      {
        ...fixtureBudgets,
        tiers: {
          ...fixtureBudgets.tiers,
          basic: undefined,
        } as unknown as AssetBudgets["tiers"],
      },
      [/basic/],
    ],
  ];

  test.each(cases)("%s", (_label, assets, budgets, mentions) => {
    rmOut(broken);
    writeTree(broken, assets, budgets);
    expectCleanFailure(buildTree(broken), broken, mentions);
  });

  test("the manifest is not valid JSON", () => {
    rmOut(broken);
    broken.write("assets.json", "{ assets: ");
    broken.write("budgets.json", JSON.stringify(fixtureBudgets));
    expectCleanFailure(buildTree(broken), broken, [/assets\.json/]);
  });

  test("the manifest has unknown fields", () => {
    rmOut(broken);
    broken.write("assets.json", JSON.stringify({ assets: [], extra: true }));
    broken.write("budgets.json", JSON.stringify(fixtureBudgets));
    expectCleanFailure(buildTree(broken), broken, [/extra/]);
  });
});

function rmOut(target: SourceTree): void {
  rmSync(target.out, { recursive: true, force: true });
}

test("a successful build replaces stale files from an earlier build", () => {
  const stale = path.join(tree.out, "high", "old.lod0.glb");
  tree.write(path.relative(tree.root, stale), "stale");
  const result = buildTree(tree);
  expect(result.code, result.output).toBe(0);
  expect(existsSync(stale)).toBe(false);
});
