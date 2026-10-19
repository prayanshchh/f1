export const tiers = ["ultra", "high", "medium", "low", "basic"] as const;

export type Tier = (typeof tiers)[number];

export const assetClasses = ["car", "prop"] as const;

export type AssetClass = (typeof assetClasses)[number];

export interface TierBudget {
  maxTextureSize: number;
  triangles: Record<AssetClass, number>;
  bytes: Record<AssetClass, number>;
}

export interface AssetBudgets {
  lodCount: Record<AssetClass, number>;
  tiers: Record<Tier, TierBudget>;
}

const MiB = 1024 * 1024;

export const assetBudgets: AssetBudgets = {
  lodCount: { car: 4, prop: 3 },
  tiers: {
    ultra: {
      maxTextureSize: 4096,
      triangles: { car: 200_000, prop: 20_000 },
      bytes: { car: 48 * MiB, prop: 4 * MiB },
    },
    high: {
      maxTextureSize: 2048,
      triangles: { car: 120_000, prop: 10_000 },
      bytes: { car: 24 * MiB, prop: 2 * MiB },
    },
    medium: {
      maxTextureSize: 1024,
      triangles: { car: 60_000, prop: 5_000 },
      bytes: { car: 12 * MiB, prop: MiB },
    },
    low: {
      maxTextureSize: 1024,
      triangles: { car: 30_000, prop: 2_500 },
      bytes: { car: 6 * MiB, prop: MiB / 2 },
    },
    basic: {
      maxTextureSize: 512,
      triangles: { car: 15_000, prop: 1_200 },
      bytes: { car: 3 * MiB, prop: MiB / 4 },
    },
  },
};
