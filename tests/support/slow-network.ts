import type { Page } from "@playwright/test";

export async function slowNetwork(page: Page, megabits: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 10,
    downloadThroughput: (megabits * 1e6) / 8,
    uploadThroughput: 1e6,
  });
}
