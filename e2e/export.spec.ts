import { readFile } from "node:fs/promises";
import { test, expect, newSession, PHRASE } from "./fixtures";

test("the export centre downloads an encrypted .orionaic archive", async ({
  page,
}) => {
  await newSession(page, { event: "Incendie Lancy", operator: "Lt Favre" });
  await page
    .getByRole("region", { name: "Par où commencer ?" })
    .getByRole("button", { name: "Exporter" })
    .click();

  const dialog = page.getByRole("dialog", { name: "Exporter" });
  await dialog
    .getByRole("button", { name: /^Archive orion aic chiffrée/ })
    .click();
  await dialog.getByLabel("Phrase secrète").fill(PHRASE);
  await dialog.getByLabel("Répéter la phrase").fill(PHRASE);

  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Télécharger" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.orionaic$/);

  // An encrypted envelope: the event name is not readable in the file.
  const content = await readFile((await file.path())!, "utf8");
  expect(content.length).toBeGreaterThan(100);
  expect(content).not.toContain("Incendie Lancy");

  // The export is written to the register.
  await expect(dialog.getByText(/Inscrit au registre/)).toBeVisible();
});
