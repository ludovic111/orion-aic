import { test, expect, goTo, newSession } from "./fixtures";

const CODE = /^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/;

test("two posts share a session through a session code", async ({
  page: a,
  newPost,
}) => {
  // Post A opens the session and creates a session code.
  await newSession(a, { event: "Tempête Genève", operator: "Poste A" });
  await a
    .getByRole("banner")
    .getByRole("button", { name: "Non partagé" })
    .click();
  const settingsA = a.getByRole("dialog", { name: "Réglages" });
  await expect(
    settingsA.getByRole("button", { name: "Synchronisation" }),
  ).toHaveAttribute("aria-pressed", "true");
  await settingsA
    .getByRole("button", { name: "Créer un code de session" })
    .click();
  const code = (await settingsA.getByText(CODE).textContent())!.trim();
  await expect(settingsA.getByText("Connecté", { exact: true })).toBeVisible();
  await settingsA.getByRole("button", { name: "Fermer" }).click();

  // Post B joins from the landing with that code.
  const b = await newPost();
  await b.goto("/");
  await expect(
    b.getByRole("button", { name: "Rejoindre une session" }),
  ).toHaveAttribute("aria-pressed", "true");
  await b.getByRole("textbox", { name: "Code de session" }).fill(code);
  await b
    .getByRole("textbox", { name: "Votre nom ou fonction" })
    .fill("Poste B");
  await b
    .getByRole("checkbox", { name: "Garder la session sur cet appareil" })
    .uncheck();
  await b.getByRole("button", { name: "Rejoindre la session" }).click();
  await expect(
    b.getByRole("heading", { level: 1, name: "Tempête Genève" }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(
    b.getByRole("banner").getByRole("button", { name: /^2 postes/ }),
  ).toBeVisible();

  // An entry written on A appears on B.
  await goTo(a, "Journal");
  await a
    .getByRole("main")
    .getByRole("button", { name: "Nouvelle entrée" })
    .click();
  const text = "Arbre tombé sur la voie du tram 12, ligne coupée.";
  await a
    .getByRole("complementary")
    .getByRole("textbox", { name: "Message" })
    .fill(text);
  await a
    .getByRole("complementary")
    .getByRole("button", { name: /^Consigner/ })
    .click();
  await expect(
    a
      .getByRole("region", { name: "Entrées" })
      .getByRole("row")
      .filter({ hasText: text }),
  ).toContainText("#001");

  await goTo(b, "Journal");
  await expect(
    b
      .getByRole("region", { name: "Entrées" })
      .getByRole("row")
      .filter({ hasText: text }),
  ).toContainText("#001", { timeout: 20_000 });

  // A sees B among the connected posts, online.
  await a
    .getByRole("banner")
    .getByRole("button", { name: /^2 postes/ })
    .click();
  const posts = a
    .getByRole("dialog", { name: "Réglages" })
    .getByRole("listitem");
  await expect(posts.filter({ hasText: "Poste A" })).toContainText("En ligne");
  await expect(posts.filter({ hasText: "Poste B" })).toContainText("En ligne", {
    timeout: 20_000,
  });
});
