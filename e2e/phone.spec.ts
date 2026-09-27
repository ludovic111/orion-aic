import type { Page } from "@playwright/test";
import { test, expect, dock, dockItem, goTo } from "./fixtures";

// Runs in the « phone » project only (Pixel 7, touch, 412 px wide).

/** Nothing sticks out sideways: no horizontal scrolling of the page. */
async function expectNoSidewaysScroll(page: Page) {
  const { scroll, width } = await page.evaluate(() => ({
    scroll: document.scrollingElement!.scrollWidth,
    width: window.innerWidth,
  }));
  expect(scroll, "page wider than the screen").toBeLessThanOrEqual(width);
}

const top = async (page: Page, locator: ReturnType<Page["locator"]>) =>
  (await locator.boundingBox())!.y;

test("on a phone: join form first, bottom bar, nothing wider than the screen", async ({
  page,
}) => {
  await page.goto("/");
  // The join form comes before the table of contents of the tool.
  const code = page.getByRole("textbox", { name: "Code de session" });
  await expect(code).toBeVisible();
  const contents = page.getByRole("term").first();
  expect(await top(page, code)).toBeLessThan(await top(page, contents));
  await expectNoSidewaysScroll(page);

  await page
    .getByRole("button", { name: "Ouvrir l’exercice de démonstration" })
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Crue de l’Arve" }),
  ).toBeVisible();
  await expectNoSidewaysScroll(page);

  // The bottom bar: four modules and « Plus », at the foot of the screen.
  const bar = dock(page);
  for (const name of ["Situation", "Journal", "Messages", "Carte", "Plus"])
    await expect(dockItem(page, name)).toBeVisible();
  await expect(dockItem(page, "Moyens")).toBeHidden();
  const box = (await bar.boundingBox())!;
  const height = page.viewportSize()!.height;
  expect(box.y + box.height).toBeGreaterThan(height - 40);

  await goTo(page, "Journal");
  await expect(page.getByRole("region", { name: "Entrées" })).toBeVisible();
  await expectNoSidewaysScroll(page);

  await goTo(page, "Messages");
  await expect(
    page.getByRole("heading", { level: 1, name: "Messages" }),
  ).toBeVisible();

  // On a phone the map takes the whole page, without a title.
  await goTo(page, "Carte");
  await expect(
    page.getByRole("application", { name: "Carte de situation" }),
  ).toBeVisible();

  // « Plus » opens every other module.
  await dockItem(page, "Plus").click();
  const sheet = page.getByRole("dialog", { name: "Tous les modules" });
  await sheet.getByRole("button", { name: /^Moyens/ }).click();
  await expect(sheet).toBeHidden();
  await expect(
    page.getByRole("heading", { level: 1, name: "Moyens" }),
  ).toBeVisible();
  await expect(dockItem(page, "Plus")).toHaveAttribute("aria-current", "page");

  await goTo(page, "Situation");
  await expect(
    page.getByRole("heading", { level: 1, name: "Crue de l’Arve" }),
  ).toBeVisible();
});
