import { test, expect, goTo } from "./fixtures";

test("the demonstration exercise opens and every essential module is reachable", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Ouvrir l’exercice de démonstration" })
    .click();

  // Situation: the demo event and its figures.
  await expect(
    page.getByRole("heading", { level: 1, name: "Crue de l’Arve" }),
  ).toBeVisible();
  await expect(
    page.getByRole("list", { name: "L’engagement en chiffres" }),
  ).toBeVisible();

  await goTo(page, "Journal");
  await expect(page.getByRole("region", { name: "Entrées" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "#001" })).toBeVisible();

  await goTo(page, "Messages");
  await expect(
    page.getByRole("heading", { level: 1, name: "Messages" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Messages reçus" }),
  ).toContainText("Fermeture du pont");

  await goTo(page, "Carte");
  await expect(
    page.getByRole("heading", { level: 1, name: "Carte" }),
  ).toBeVisible();
  await expect(
    page.getByRole("application", { name: "Carte de situation" }),
  ).toBeVisible();

  await goTo(page, "Moyens");
  await expect(
    page.getByRole("heading", { level: 1, name: "Moyens" }),
  ).toBeVisible();

  await goTo(page, "Équipe");
  await expect(
    page.getByRole("heading", { level: 1, name: "Équipe" }),
  ).toBeVisible();

  // The less common modules sit under « Plus d’outils ».
  await page.getByRole("button", { name: "Plus d’outils" }).click();
  const more = page.getByRole("menu", { name: "Plus d’outils" });
  await more.getByRole("button", { name: /^Réseau radio/ }).click();
  await expect(more).toBeHidden();
  await expect(
    page.getByRole("heading", { level: 1, name: "Réseau radio" }),
  ).toBeVisible();

  // Back to Situation through the dock.
  await goTo(page, "Situation");
  await expect(
    page.getByRole("heading", { level: 1, name: "Crue de l’Arve" }),
  ).toBeVisible();
});
