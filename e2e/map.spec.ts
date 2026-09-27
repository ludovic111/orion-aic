import type { Locator, Page } from "@playwright/test";
import { test, expect, goTo } from "./fixtures";

// Situation map on a computer, with the demonstration exercise. The tiles
// and geo.admin.ch are blocked (fixtures): the objects are drawn anyway.
// The phone smoke check is in map.phone.spec.ts (phone project).

/** A blank 1×1 PNG. */
const TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

async function openDemoMap(page: Page) {
  // Blank background tiles, still offline: without them the banner « le
  // serveur du fond ne répond pas » would cover the top of the map.
  await page.route(
    (url) =>
      url.hostname.startsWith("wmts") ||
      url.hostname === "tile.openstreetmap.org",
    (route) =>
      route.fulfill({ status: 200, contentType: "image/png", body: TILE }),
  );
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
  return map;
}

const panelOf = (page: Page) =>
  page.getByRole("complementary", { name: "Panneau de la carte" });
/** The tool buttons are named by their hint (the label is hidden). */
const tool = (page: Page, name: string) =>
  page
    .getByRole("navigation", { name: "Outils de la carte" })
    .getByRole("button", { name, exact: true });
/** A row of the list of objects: its name, then layer and kind. */
const row = (page: Page, label: string) =>
  panelOf(page).getByRole("button", { name: new RegExp(`^${label} `) });
/**
 * A symbol drawn on the map: a button named after the object (a zero-sized
 * anchor, its content drawn around it).
 */
const symbol = (page: Page, label: string) =>
  page
    .getByRole("application", { name: "Carte de situation" })
    .getByRole("button", { name: label, exact: true });
const symbolBody = (page: Page, label: string) =>
  symbol(page, label).locator(".map-pin-symbol");

/** Click the map at a fraction of its size (clear of panel and controls). */
async function clickMap(map: Locator, x: number, y: number) {
  const box = (await map.boundingBox())!;
  await map.click({ position: { x: box.width * x, y: box.height * y } });
}

test("the demo objects are listed and drawn on the map", async ({ page }) => {
  await openDemoMap(page);
  const panel = panelOf(page);
  // The list of objects of « Suivi général » is open beside the map.
  await expect(
    page.getByRole("tab", { name: "Suivi général", selected: true }),
  ).toBeVisible();
  await expect(panel.getByRole("button", { name: /^Objets/ })).toContainText(
    "6",
  );
  for (const name of [
    "Zone inondée Acacias",
    "Fermeture des berges",
    "PC Carouge",
    "Passerelle de la Fontenette",
  ])
    await expect(row(page, name)).toBeVisible();

  // Every object in view: the symbols and the labels of the shapes.
  await page.getByRole("button", { name: "Voir tous les objets" }).click();
  for (const name of ["PC Carouge", "PC front", "Route de Veyrier inondée"])
    await expect(symbolBody(page, name)).toBeVisible();
  await expect(
    page.getByRole("tooltip", { name: "Zone inondée Acacias" }),
  ).toBeVisible();

  // A click in the list opens the sheet of the object.
  await row(page, "Passerelle de la Fontenette").click();
  const sheet = page.getByRole("dialog", {
    name: "Passerelle de la Fontenette",
  });
  await expect(sheet).toBeVisible();
  await expect(
    sheet.getByRole("textbox", { name: "Nom", exact: true }),
  ).toHaveValue("Passerelle de la Fontenette");
  await sheet.getByRole("button", { name: "Fermer" }).click();
  await expect(sheet).toBeHidden();

  // The other map of the operation has its own objects (and its own
  // background: the switch must not leave the old one listening).
  await expect(row(page, "Tonne-pompe SIS")).toBeHidden();
  await page.getByRole("tab", { name: "Secteur Acacias (détail)" }).click();
  await expect(
    page.getByRole("tab", { name: "Secteur Acacias (détail)", selected: true }),
  ).toBeVisible();
  await expect(row(page, "Tonne-pompe SIS")).toBeVisible();
  await expect(row(page, "Point de rassemblement Acacias")).toBeVisible();
  await page.getByRole("button", { name: "Zoom avant" }).click();
  await page.getByRole("tab", { name: "Suivi général" }).click();
  await expect(row(page, "Tonne-pompe SIS")).toBeHidden();
});

test("place a sign, rename it, undo and redo", async ({ page }) => {
  const map = await openDemoMap(page);
  const panel = panelOf(page);

  // « Point »: the palette of signs opens and the hint says what to do.
  await tool(page, "Placer un signe").click();
  await expect(tool(page, "Placer un signe")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(panel.getByRole("button", { name: "Signes" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const hint = page.locator(".map-hint");
  await expect(hint).toContainText("Cliquez sur la carte pour placer");

  // A click on the map places it and opens its sheet.
  await clickMap(map, 0.62, 0.5);
  const sheet = page.locator(".sheet-panel");
  await expect(sheet).toBeVisible();
  await expect(tool(page, "Sélectionner et déplacer")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const name = sheet.getByRole("textbox", { name: "Nom", exact: true });
  const placed = await name.inputValue();
  expect(placed).not.toBe("");

  // Renamed from the sheet.
  await name.fill("Poste sanitaire e2e");
  await sheet.getByRole("button", { name: "Enregistrer" }).click();
  await expect(sheet).toBeHidden();
  await panel.getByRole("button", { name: /^Objets/ }).click();
  await expect(row(page, "Poste sanitaire e2e")).toBeVisible();
  await expect(symbolBody(page, "Poste sanitaire e2e")).toBeVisible();

  // Undo, until nothing is left to undo: the object is gone. (Placing and
  // renaming within 1.5 s make one step, a few seconds apart two.)
  const undo = page.getByRole("button", {
    name: "Annuler la dernière opération sur la carte",
  });
  const redo = page.getByRole("button", {
    name: "Rétablir l’opération annulée",
  });
  const objects = panel.getByRole("button", { name: /^Objets/ });
  await expect(objects).toContainText("7");
  await expect(redo).toBeDisabled();
  await undo.click();
  await expect(row(page, "Poste sanitaire e2e")).toBeHidden();
  await expect(redo).toBeEnabled();
  if (await undo.isEnabled()) await undo.click();
  await expect(undo).toBeDisabled();
  await expect(objects).toContainText("6");
  await expect(row(page, placed)).toBeHidden();
  await expect(symbol(page, placed)).not.toBeAttached();

  // Redo, until nothing is left to redo: back, renamed.
  await redo.click();
  if (await redo.isEnabled()) await redo.click();
  await expect(redo).toBeDisabled();
  await expect(row(page, "Poste sanitaire e2e")).toBeVisible();
  await expect(objects).toContainText("7");

  // The keyboard: Ctrl+Z undoes, ⇧Ctrl+Z redoes (focus outside any field).
  await undo.focus();
  await page.keyboard.press("Control+Z");
  await expect(row(page, "Poste sanitaire e2e")).toBeHidden();
  await page.keyboard.press("Control+Shift+Z");
  await expect(row(page, "Poste sanitaire e2e")).toBeVisible();

  // The sheet of the new object, from its symbol on the map.
  await symbolBody(page, "Poste sanitaire e2e").click();
  await expect(
    page.getByRole("dialog", { name: "Poste sanitaire e2e" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
});

test("draw a zone, measure, hide a layer, lock", async ({ page }) => {
  const map = await openDemoMap(page);
  const panel = panelOf(page);
  const hint = page.locator(".map-hint");

  // A zone of three corners, finished with « Terminer ».
  await tool(page, "Dessiner une zone").click();
  await expect(hint).toContainText("Cliquez les coins de la zone");
  await clickMap(map, 0.6, 0.3);
  await clickMap(map, 0.75, 0.3);
  await clickMap(map, 0.68, 0.45);
  await expect(hint.locator(".map-live")).toContainText("surface");
  await hint.getByRole("button", { name: "Terminer" }).click();
  const sheet = page.getByRole("dialog", { name: "Zone" });
  await expect(sheet).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(panel.getByRole("button", { name: /^Objets/ })).toContainText(
    "7",
  );
  await expect(row(page, "Objet sans nom")).toBeVisible();

  // Measure: a live distance, nothing written; Échap leaves the tool.
  await tool(page, "Mesurer une distance ou une surface").click();
  await clickMap(map, 0.6, 0.55);
  await clickMap(map, 0.75, 0.55);
  await expect(hint.locator(".map-live")).toContainText("m");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(tool(page, "Sélectionner et déplacer")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(hint).toBeHidden();
  await expect(panel.getByRole("button", { name: /^Objets/ })).toContainText(
    "7",
  );

  // Hide the layer « Dangers »: its symbol leaves the map, the list says so.
  const walkway = symbol(page, "Passerelle de la Fontenette");
  await expect(walkway).toBeAttached();
  await panel.getByRole("button", { name: "Calques" }).click();
  const dangers = panel.locator(".map-layer-row", { hasText: "Dangers" });
  await expect(dangers).toHaveAttribute("aria-pressed", "true");
  await dangers.click();
  await expect(dangers).toHaveAttribute("aria-pressed", "false");
  await expect(walkway).not.toBeAttached();
  await panel.getByRole("button", { name: /^Objets/ }).click();
  await expect(row(page, "Passerelle de la Fontenette")).toContainText(
    "masqué",
  );
  await panel.getByRole("button", { name: "Calques" }).click();
  await panel.getByRole("button", { name: "Tout afficher" }).click();
  await expect(dangers).toHaveAttribute("aria-pressed", "true");
  await expect(walkway).toBeAttached();

  // Lock: the objects stay in place, the button says so.
  await page.getByRole("button", { name: "Verrouiller les objets" }).click();
  const unlock = page.getByRole("button", {
    name: "Déverrouiller les objets",
  });
  await expect(unlock).toHaveAttribute("aria-pressed", "true");
  await unlock.click();
  await expect(
    page.getByRole("button", { name: "Verrouiller les objets" }),
  ).toHaveAttribute("aria-pressed", "false");
});

test("import a GeoJSON file and open the print and offline dialogs", async ({
  page,
}) => {
  await openDemoMap(page);
  const menu = page.getByRole("button", { name: "Menu de la carte" });

  await menu.click();
  await page
    .getByRole("menuitem", { name: /Importer KML \/ GeoJSON \/ GPX/ })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Importer un fichier géographique",
  });
  await expect(dialog).toBeVisible();
  await dialog.locator('input[type="file"]').setInputFiles({
    name: "berges.geojson",
    mimeType: "application/geo+json",
    buffer: Buffer.from(
      JSON.stringify({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { name: "Digue provisoire e2e" },
            geometry: {
              type: "LineString",
              coordinates: [
                [6.141, 46.193],
                [6.144, 46.194],
              ],
            },
          },
        ],
      }),
    ),
  });
  await dialog.getByRole("button", { name: "Importer 1 objet" }).click();
  await expect(dialog).toBeHidden();
  await expect(row(page, "Digue provisoire e2e")).toBeVisible();

  await menu.click();
  await page.getByRole("menuitem", { name: /Imprimer à l’échelle/ }).click();
  const print = page.getByRole("dialog", { name: "Imprimer à l’échelle" });
  await expect(print).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(print).toBeHidden();

  await menu.click();
  await page.getByRole("menuitem", { name: /Carte hors ligne/ }).click();
  const offline = page.getByRole("dialog", { name: /hors ligne/i });
  await expect(offline).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(offline).toBeHidden();
});
