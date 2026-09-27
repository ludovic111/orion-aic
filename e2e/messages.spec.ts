import { test, expect, goTo, newSession } from "./fixtures";

test("a received message is written to the journal and linked to its entry", async ({
  page,
}) => {
  await newSession(page, { event: "Crue du Rhône", operator: "Cpl Rochat" });
  await goTo(page, "Messages");

  // Quick capture: the form is on the page.
  await expect(
    page.getByRole("heading", { level: 2, name: "Nouveau message" }),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "Objet" }).fill("Digue fissurée");
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Fissure de 3 m sur la digue du Rhône, rive gauche, km 12.");
  await page.getByRole("button", { name: /^Enregistrer le message/ }).click();

  const received = page.getByRole("region", { name: "Messages reçus" });
  await expect(received).toContainText("Digue fissurée");

  // « Inscrire au journal »: reviewed in a dialog, then written.
  await received.getByRole("button", { name: "Inscrire au journal" }).click();
  const dialog = page.getByRole("dialog", { name: /^Inscrire au journal/ });
  await expect(dialog).toContainText("Fissure de 3 m");
  await dialog.getByRole("button", { name: /^Inscrire au journal/ }).click();
  await expect(dialog).toBeHidden();

  // The message now points to its entry, and no longer offers to write it.
  await expect(received).toContainText("#001");
  await expect(
    received.getByRole("button", { name: "Inscrire au journal" }),
  ).toHaveCount(0);

  await goTo(page, "Journal");
  await expect(
    page
      .getByRole("region", { name: "Entrées" })
      .getByRole("row")
      .filter({ hasText: "Fissure de 3 m" }),
  ).toContainText("#001");
});
