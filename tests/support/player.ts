import { randomBytes } from "node:crypto";
import type { BrowserContext } from "@playwright/test";

export const playerKeyName = "revracers.player";

export const asha = {
  firstName: "Asha",
  lastName: "Rao",
  nationality: "IN",
  number: 44,
  team: "corvus",
};

export async function seedPlayer(
  context: BrowserContext,
  profile: typeof asha = asha,
): Promise<{ authorization: string }> {
  const key = randomBytes(32).toString("base64url");
  const headers = { authorization: `Bearer ${key}` };
  const joined = await context.request.post("/api/players", { data: { key } });
  if (!joined.ok())
    throw new Error(`could not make a player: ${await joined.text()}`);
  const saved = await context.request.put("/api/me", {
    data: profile,
    headers,
  });
  if (!saved.ok())
    throw new Error(`could not save the profile: ${await saved.text()}`);
  await context.addInitScript(
    ([name, value]) => {
      localStorage.setItem(name, value);
    },
    [playerKeyName, key] as const,
  );
  return headers;
}
