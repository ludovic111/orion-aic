import { test, expect, goTo, newSession, PHRASE } from "./fixtures";

test("a new session, kept encrypted on the post, numbers its journal entries", async ({
  page,
}) => {
  await newSession(page, {
    event: "Glissement de terrain Veyrier",
    operator: "Sgt Muller",
    phrase: PHRASE,
  });
  // Kept on this post, encrypted: the top-bar chip says so.
  await expect(
    page
      .getByRole("banner")
      .getByRole("button", { name: "Enregistré", exact: true }),
  ).toBeVisible();

  await goTo(page, "Journal");
  await expect(page.getByText("Journal vide.")).toBeVisible();

  await page
    .getByRole("main")
    .getByRole("button", { name: "Nouvelle entrée" })
    .click();
  // The form stays open, emptied, ready for the next entry.
  const form = page.getByRole("complementary").filter({
    hasText: "Nouvelle entrée",
  });
  const message = form.getByRole("textbox", { name: "Message" });
  const entries = page.getByRole("region", { name: "Entrées" });
  for (const text of [
    "Coulée de boue sur la route de Veyrier, circulation interrompue.",
    "Reconnaissance engagée : groupe Alpha, retour prévu 21:00.",
  ]) {
    await message.fill(text);
    await form.getByRole("button", { name: /^Consigner/ }).click();
    await expect(message).toHaveValue("");
    await expect(
      entries.getByRole("row").filter({ hasText: text }),
    ).toBeVisible();
  }

  await expect(
    entries.getByRole("row").filter({ hasText: "Coulée de boue" }),
  ).toContainText("#001");
  await expect(
    entries.getByRole("row").filter({ hasText: "Reconnaissance engagée" }),
  ).toContainText("#002");
  await expect(entries.getByText("2 entrées")).toBeVisible();
});
