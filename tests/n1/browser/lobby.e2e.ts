import { expect, test, type Browser, type Page } from "@playwright/test";
import { recordProblems } from "../../support/bundle.ts";
import { regions, startLobby, type Lobby } from "../support/lobby.ts";

let lobby: Lobby;

test.beforeAll(async () => {
  lobby = await startLobby();
});

test.afterAll(async () => {
  await lobby.service.stop();
});

async function newPage(
  browser: Browser,
): Promise<{ page: Page; problems: string[] }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  return { page, problems: recordProblems(page) };
}

async function createFromHome(page: Page, region: string): Promise<string> {
  await page.goto(lobby.url);
  const select = page.getByLabel("Region");
  await expect(select.locator("option")).toHaveText(
    regions.map((entry) => entry.name),
  );
  await select.selectOption(region);
  await page.getByRole("button", { name: "Create room" }).click();
  const link = page.getByTestId("room-link");
  await expect(link).toHaveAttribute(
    "href",
    new RegExp(`^${lobby.url}/join/[a-z0-9]{10,}$`),
  );
  return (await link.getAttribute("href")) ?? "";
}

async function joinByLink(
  page: Page,
  link: string,
  name: string,
): Promise<void> {
  await page.goto(link);
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Join" }).click();
}

const playerList = (page: Page) => page.getByTestId("players").locator("li");

test("two browsers join the same room through one link and see each other", async ({
  browser,
}) => {
  const host = await newPage(browser);
  const guest = await newPage(browser);
  const link = await createFromHome(host.page, "us-east");
  await joinByLink(host.page, link, "Ana");
  await expect(host.page.getByTestId("room-region")).toHaveText("US East");
  await expect(playerList(host.page)).toHaveText(["Ana"]);
  await joinByLink(guest.page, link, "Ben");
  await expect(playerList(guest.page)).toHaveText(["Ana", "Ben"]);
  await expect(playerList(host.page)).toHaveText(["Ana", "Ben"], {
    timeout: 3000,
  });
  await guest.page.getByRole("button", { name: "Leave" }).click();
  await expect(playerList(host.page)).toHaveText(["Ana"], { timeout: 3000 });
  expect(host.problems).toEqual([]);
  expect(guest.problems).toEqual([]);
});

test("player names are shown as text, never as markup", async ({ browser }) => {
  const host = await newPage(browser);
  const link = await createFromHome(host.page, "eu-west");
  const name = "<img src=x onerror=alert(1)>";
  let alerted = false;
  host.page.on("dialog", (dialog) => {
    alerted = true;
    void dialog.dismiss();
  });
  await joinByLink(host.page, link, name);
  await expect(playerList(host.page)).toHaveText([name]);
  await expect(host.page.getByTestId("players").locator("img")).toHaveCount(0);
  expect(alerted).toBe(false);
});

test("a taken name is explained on the page", async ({ browser }) => {
  const host = await newPage(browser);
  const guest = await newPage(browser);
  const link = await createFromHome(host.page, "eu-west");
  await joinByLink(host.page, link, "Ana");
  await joinByLink(guest.page, link, "ana");
  await expect(guest.page.getByRole("alert")).toContainText(/taken/i);
  await expect(playerList(host.page)).toHaveText(["Ana"]);
});

test("an unknown link shows that the room does not exist", async ({
  browser,
}) => {
  const visitor = await newPage(browser);
  await visitor.page.goto(`${lobby.url}/join/nosuchroom00`);
  await expect(visitor.page.getByRole("alert")).toContainText(
    /does not exist/i,
  );
  await expect(visitor.page.getByRole("button", { name: "Join" })).toHaveCount(
    0,
  );
});
