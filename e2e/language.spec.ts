import { test, expect } from "./fixtures";

test("the landing switches from French to German", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", /^fr/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Tenir la conduite." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Rejoindre une session" }),
  ).toBeVisible();

  const languages = page.getByRole("group", { name: /Langue/ });
  await languages.getByRole("button", { name: "DE" }).click();

  await expect(languages.getByRole("button", { name: "DE" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator("html")).toHaveAttribute("lang", /^de/);
  await expect(
    page.getByRole("button", { name: "Rejoindre une session" }),
  ).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Ouvrir l’exercice de démonstration" }),
  ).toBeHidden();
  await expect(
    page.getByRole("heading", { level: 1, name: "Die Führung sicherstellen" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Einer Sitzung beitreten" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Neue Sitzung", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Demo-Übung öffnen" }),
  ).toBeVisible();

  // And back.
  await languages.getByRole("button", { name: "FR" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", /^fr/);
  await expect(
    page.getByRole("button", { name: "Rejoindre une session" }),
  ).toBeVisible();
});
