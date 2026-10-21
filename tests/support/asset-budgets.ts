import { readFileSync } from "node:fs";
import path from "node:path";
import { repoRoot } from "./repo.ts";

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

export const assetBudgets = JSON.parse(
  readFileSync(path.join(repoRoot, "content/budgets.json"), "utf8"),
) as AssetBudgets;
