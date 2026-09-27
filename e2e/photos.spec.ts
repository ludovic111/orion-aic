import { crc32, deflateSync } from "node:zlib";
import type { Locator, Page } from "@playwright/test";
import { test, expect, goTo, newSession, PHRASE } from "./fixtures";

/**
 * A small PNG (a colour gradient), made here: the photo a camera or a
 * gallery would hand over. orion aic reduces it to a JPEG in the browser.
 */
function png(width: number, height: number): Buffer {
  const row = width * 3 + 1;
  const raw = Buffer.alloc(row * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const at = y * row + 1 + x * 3;
      raw[at] = Math.round((x / width) * 255);
      raw[at + 1] = Math.round((y / height) * 255);
      raw[at + 2] = 140;
    }
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc32(body));
    return Buffer.concat([head, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bits per channel
  header[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const photoFile = (name: string) => ({
  name,
  mimeType: "image/png",
  buffer: png(320, 240),
});

/** « Photo » in `scope`, and the file chosen in the file chooser. */
async function addPhoto(page: Page, scope: Locator, name: string) {
  const chooser = page.waitForEvent("filechooser");
  await scope.getByRole("button", { name: "Photo", exact: true }).click();
  await (await chooser).setFiles(photoFile(name));
}

/** The picture of a thumbnail or of the viewer: a JPEG, decoded. */
async function expectPicture(image: Locator) {
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute("src", /^data:image\/jpeg;base64,\/9j\//);
  await expect
    .poll(() => image.evaluate((i: HTMLImageElement) => i.naturalWidth))
    .toBe(320);
}

/** Journal → a new entry with `text`, recorded. */
async function writeEntry(page: Page, text: string, photo?: string) {
  await goTo(page, "Journal");
  await page
    .getByRole("main")
    .getByRole("button", { name: "Nouvelle entrée" })
    .click();
  const form = page
    .getByRole("complementary")
    .filter({ hasText: "Nouvelle entrée" });
  await form.getByRole("textbox", { name: "Message" }).fill(text);
  if (photo) {
    await addPhoto(page, form, photo);
    await expectPicture(form.locator(".photo-picker img"));
  }
  await form.getByRole("button", { name: /^Consigner/ }).click();
  await expect(entryRow(page, text)).toContainText("#001");
}
const entryRow = (page: Page, text: string) =>
  page
    .getByRole("region", { name: "Entrées" })
    .getByRole("row")
    .filter({ hasText: text });
/** The photos of the entry with `text`, in its detail. */
async function openPhotos(page: Page, text: string) {
  await entryRow(page, text).getByRole("button", { name: text }).click();
  return page.getByRole("region", { name: "Photos" });
}

test("a photo attached to an entry shows as a thumbnail, opens full screen and is kept encrypted", async ({
  page,
}) => {
  await newSession(page, {
    event: "Incendie Plainpalais",
    operator: "Sgt Rochat",
    phrase: PHRASE,
  });
  const text = "Façade noircie au 3e étage, vue depuis la rue.";
  await writeEntry(page, text);

  const photos = await openPhotos(page, text);
  await addPhoto(page, photos, "facade.png");
  const thumb = photos.getByRole("button", { name: "Voir la photo 1" });
  await expectPicture(thumb.locator("img"));
  await expect(photos).toContainText("1 photo");

  // Full screen, then closed.
  await thumb.click();
  const viewer = page.getByRole("dialog", { name: "Photo 1 sur 1" });
  await expect(viewer).toBeVisible();
  await expectPicture(viewer.getByRole("img", { name: "Photo 1 sur 1" }));
  await expect(viewer).toContainText("Ajoutée par Sgt Rochat");
  await viewer.getByRole("button", { name: "Fermer la photo" }).click();
  await expect(viewer).toBeHidden();

  // Kept on this post, encrypted with the session: after a reload and the
  // recovery phrase, the photo is there again.
  await expect(
    page
      .getByRole("banner")
      .getByRole("button", { name: "Enregistré", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Reprendre" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByLabel("Phrase de récupération").fill(PHRASE);
  await page.getByRole("button", { name: "Déverrouiller" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Incendie Plainpalais" }),
  ).toBeVisible();
  await goTo(page, "Journal");
  const again = await openPhotos(page, text);
  await expectPicture(
    again.getByRole("button", { name: "Voir la photo 1" }).locator("img"),
  );
});

const CODE = /^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/;

test("photos reach a post that joins later, and the ones added afterwards", async ({
  page: a,
  newPost,
}) => {
  await newSession(a, { event: "Crue du Rhône", operator: "Poste A" });
  // A photo taken with a new entry, before any other post is there.
  const text = "Berge effondrée au pont de Sous-Terre.";
  await writeEntry(a, text, "berge.png");

  await a
    .getByRole("banner")
    .getByRole("button", { name: "Non partagé" })
    .click();
  const settings = a.getByRole("dialog", { name: "Réglages" });
  await settings
    .getByRole("button", { name: "Créer un code de session" })
    .click();
  const code = (await settings.getByText(CODE).textContent())!.trim();
  await expect(settings.getByText("Connecté", { exact: true })).toBeVisible();
  await settings.getByRole("button", { name: "Fermer" }).click();

  const b = await newPost();
  await b.goto("/");
  await b.getByRole("textbox", { name: "Code de session" }).fill(code);
  await b
    .getByRole("textbox", { name: "Votre nom ou fonction" })
    .fill("Poste B");
  await b
    .getByRole("checkbox", { name: "Garder la session sur cet appareil" })
    .uncheck();
  await b.getByRole("button", { name: "Rejoindre la session" }).click();
  await expect(
    b.getByRole("heading", { level: 1, name: "Crue du Rhône" }),
  ).toBeVisible({ timeout: 20_000 });

  // B received the photo added before it joined, picture included.
  await goTo(b, "Journal");
  await expect(entryRow(b, text)).toContainText("#001", { timeout: 20_000 });
  const onB = await openPhotos(b, text);
  const first = onB.getByRole("button", { name: "Voir la photo 1" });
  await expectPicture(first.locator("img"));

  // A adds a second photo to the same entry: it appears on B.
  const onA = await openPhotos(a, text);
  await addPhoto(a, onA, "pile.png");
  await expectPicture(
    onA.getByRole("button", { name: "Voir la photo 2" }).locator("img"),
  );
  await expect(onB).toContainText("2 photos", { timeout: 20_000 });
  await expectPicture(
    onB.getByRole("button", { name: "Voir la photo 2" }).locator("img"),
  );
});
