import { test, expect, goTo } from "./fixtures";

// Runs in the « phone » project only (Pixel 7, touch, 412 px wide): the
// situation map of the demo, its list and a tool, without sideways scroll.

test("on a phone: the map, its list of objects and a drawing tool", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Ouvrir l’exercice de démonstration" })
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Crue de l’Arve" }),
  ).toBeVisible();
  await goTo(page, "Carte");
  const map = page.getByRole("application", { name: "Carte de situation" });
  await expect(map).toBeVisible();

  // The panel starts closed on a narrow screen; « Liste » opens it.
  const panel = page.getByRole("complementary", {
    name: "Panneau de la carte",
  });
  await expect(panel).toBeHidden();
  await page
    .getByRole("button", { name: /^Liste( des objets, signes et calques)?$/ })
    .click();
  await expect(panel).toBeVisible();
  await expect(
    panel.getByRole("button", { name: /^Zone inondée Acacias / }),
  ).toBeVisible();
  await panel.getByRole("button", { name: "Fermer le panneau" }).click();
  await expect(panel).toBeHidden();

  // A tool shows its hint above the tool bar; the cross closes it.
  await page
    .getByRole("button", {
      name: /^(Ligne|Tracer une ligne ou un itinéraire)$/,
    })
    .click();
  const hint = page.locator(".map-hint");
  await expect(hint).toContainText("Cliquez pour tracer la ligne");
  await hint.getByRole("button", { name: "Fermer l’outil" }).click();
  await expect(hint).toBeHidden();

  const { scroll, width } = await page.evaluate(() => ({
    scroll: document.scrollingElement!.scrollWidth,
    width: window.innerWidth,
  }));
  expect(scroll, "page wider than the screen").toBeLessThanOrEqual(width);
});
