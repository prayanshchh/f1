import { expect, test } from "@playwright/test";
import { seedPlayer } from "../support/player.ts";

function race(): void {
  if (localStorage.getItem("revracers.settings")) return;
  localStorage.setItem(
    "revracers.settings",
    JSON.stringify({ session: "race", laps: 3, buildUp: false }),
  );
}

function softwareGraphicsCard(): void {
  Object.defineProperty(GPUAdapter.prototype, "info", {
    get: () => ({
      vendor: "google",
      architecture: "swiftshader",
      description: "SwiftShader",
      isFallbackAdapter: false,
    }),
  });
}

test("the main menu switches graphics between Ultra and Low and remembers it", async ({
  page,
  context,
}) => {
  await seedPlayer(context);
  await page.goto("/");
  await page.mouse.move(1, 1);
  const graphics = page.getByRole("button", { name: /^Graphics/ });
  await expect(graphics).toContainText(/Ultra|Low/, { timeout: 60_000 });
  const first = (await graphics.textContent())?.includes("Ultra ·")
    ? "Ultra"
    : "Low";
  const other = first === "Ultra" ? "Low" : "Ultra";
  await graphics.click();
  await expect(graphics).toContainText(`${other} ·`);
  await page.reload();
  await expect(page.getByRole("button", { name: /^Graphics/ })).toContainText(
    `${other} ·`,
    { timeout: 60_000 },
  );
});

if (process.platform !== "linux") {
  test("without a usable graphics card the race starts in Low, says why once, and G brings Ultra back", async ({
    page,
  }) => {
    test.setTimeout(420_000);
    await page.addInitScript(softwareGraphicsCard);
    await page.addInitScript(race);
    await page.goto("/?autostart=1", { waitUntil: "commit" });
    await page.waitForFunction(
      () => document.body.dataset["driveStatus"] === "running",
      null,
      { timeout: 360_000 },
    );
    const note = page.locator("[data-graphics=note]");
    await expect(page.getByTestId("corridor-canvas")).toBeVisible();
    await expect(note).toBeVisible();
    await expect(note).toContainText("No graphics card was found.");
    await expect(note).toContainText("Same FPS");

    await page.keyboard.press("g");
    await expect(note).toBeHidden();
    await expect(page.getByTestId("drive-canvas")).toBeVisible({
      timeout: 60_000,
    });

    await page.reload({ waitUntil: "commit" });
    await page.waitForFunction(
      () => document.body.dataset["driveStatus"] === "running",
      null,
      { timeout: 360_000 },
    );
    await expect(page.getByTestId("drive-canvas")).toBeVisible();
    await expect(note).toBeHidden();
  });
}
