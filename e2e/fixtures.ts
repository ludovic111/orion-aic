import {
  test as base,
  expect,
  type BrowserContext,
  type Page,
} from "@playwright/test";

/**
 * Hermetic browsing: only the app under test is reachable. Map tiles,
 * swisstopo / geo.admin.ch, open-meteo, the official warnings and any other
 * outside host get an empty 204, so the tests never touch the network and
 * give the same result offline. The WebSocket relay (/sync) is same-origin.
 */
async function hermetic(context: BrowserContext, baseURL: string) {
  const origin = new URL(baseURL).origin;
  await context.route(
    (url) => url.origin !== origin && /^https?:$/.test(url.protocol),
    (route) => route.fulfill({ status: 204, body: "" }),
  );
}

/** Uncaught errors of every page of a context, checked after each test. */
function watchErrors(context: BrowserContext, errors: string[]) {
  const watch = (page: Page) =>
    page.on("pageerror", (error) =>
      errors.push(`${page.url()}: ${error.stack ?? error.message}`),
    );
  context.pages().forEach(watch);
  context.on("page", watch);
}

export const test = base.extend<{
  /** Another post: a fresh, hermetic browser context and its page. */
  newPost: () => Promise<Page>;
  pageErrors: string[];
}>({
  pageErrors: async ({}, use) => {
    const errors: string[] = [];
    await use(errors);
    expect(errors, "uncaught errors in the page").toEqual([]);
  },
  context: async ({ context, baseURL, pageErrors }, use) => {
    await hermetic(context, baseURL!);
    watchErrors(context, pageErrors);
    await use(context);
  },
  newPost: async (
    {
      browser,
      baseURL,
      locale,
      timezoneId,
      viewport,
      serviceWorkers,
      pageErrors,
    },
    use,
  ) => {
    const opened: BrowserContext[] = [];
    await use(async () => {
      const context = await browser.newContext({
        baseURL,
        locale,
        timezoneId,
        viewport,
        serviceWorkers,
      });
      opened.push(context);
      await hermetic(context, baseURL!);
      watchErrors(context, pageErrors);
      return context.newPage();
    });
    for (const context of opened) await context.close();
  },
});

export { expect };

/** The module bar (left column on a computer, bottom bar on a phone). */
export const dock = (page: Page) =>
  page.getByRole("navigation", { name: "Modules" });

/** A recovery phrase for sessions kept (encrypted) on the test post. */
export const PHRASE = "crue arve carouge e2e";

/**
 * Landing → « Nouvelle session » → « Ouvrir le journal ». Without a phrase,
 * the session stays in memory only (no encrypted local save).
 */
export async function newSession(
  page: Page,
  {
    event,
    operator,
    phrase,
  }: { event: string; operator: string; phrase?: string },
) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Nouvelle session", exact: true })
    .click();
  await page.getByLabel("Événement").fill(event);
  await page.getByLabel("Opérateur").fill(operator);
  const keep = page.getByRole("checkbox", {
    name: "Garder la session sur cet appareil",
  });
  if (phrase) {
    await expect(keep).toBeChecked();
    await page.getByLabel("Phrase de récupération").fill(phrase);
    await page.getByLabel("Répéter la phrase").fill(phrase);
  } else {
    await keep.uncheck();
  }
  await page.getByRole("button", { name: "Ouvrir le journal" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: event }),
  ).toBeVisible();
}

/** A module button of the dock (its name may carry a count: « Journal 6 »). */
export const dockItem = (page: Page, name: string) =>
  dock(page)
    .getByRole("button", { name: new RegExp(`^${name}( \\d+\\+?)?$`) })
    .last();

/** Go to a module through the dock; its button becomes the current page. */
export async function goTo(page: Page, name: string) {
  const item = dockItem(page, name);
  await item.click();
  await expect(item).toHaveAttribute("aria-current", "page");
}
