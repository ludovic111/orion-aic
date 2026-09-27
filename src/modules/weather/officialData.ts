import { getLang } from "../../../shared/i18n/core.ts";
import {
  LIMITS,
  OfficialError,
  buildSnapshot,
  fireUrl,
  floodMapUrl,
  nearestStations,
  observationUrl,
  parseStations,
  readSnapshot,
  stationsUrl,
  writeSnapshot,
  type Lang,
  type Place,
  type Received,
  type Snapshot,
} from "../../../shared/official.ts";

// Network side of the official warnings (shared/official.ts parses). Only
// on request: the coordinates of the place go to api3.geo.admin.ch (forest
// fire danger), station numbers to environment.ld.admin.ch (LINDAS); the
// flood map and the list of stations are whole-country files of
// data.geo.admin.ch. No cookie, no referrer.

const TIMEOUT = 15_000;

const storage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export const readOfficial = (journalId: string) =>
  readSnapshot(storage(), journalId);

/** Text of an answer, refused when larger than `max` characters. */
async function get(
  url: string,
  max: number,
  accept = "application/json",
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      referrerPolicy: "no-referrer",
      credentials: "omit",
      headers: { Accept: accept },
    });
    if (!res.ok) throw new OfficialError("http", `HTTP ${res.status}`);
    const length = Number(res.headers.get("content-length"));
    if (Number.isFinite(length) && length > max) {
      controller.abort();
      throw new OfficialError("too-large");
    }
    const text = await res.text();
    if (text.length > max) throw new OfficialError("too-large");
    return text;
  } catch (err) {
    if (err instanceof OfficialError) throw err;
    if ((err as Error).name === "AbortError")
      throw new OfficialError("timeout");
    throw new OfficialError(navigator.onLine ? "http" : "offline");
  } finally {
    clearTimeout(timer);
  }
}

const settle = async (p: Promise<string>) => {
  try {
    return await p;
  } catch {
    return undefined;
  }
};

/**
 * Load the official warnings and the nearest stations for the place, keep
 * the result on this device and return it. A source that fails keeps its
 * previous data; when all fail the error is thrown (the last data stays).
 */
export async function fetchOfficial(
  journalId: string,
  place: Place,
): Promise<Snapshot> {
  if (!navigator.onLine) throw new OfficialError("offline");
  const lang = getLang() as Lang;
  const previous = readOfficial(journalId);
  let fire: Promise<string> | undefined;
  try {
    fire = get(fireUrl(place, lang), LIMITS.fire);
  } catch {
    // Outside Switzerland: no forest fire danger.
  }
  const [stations, flood, fireText] = await Promise.all([
    settle(get(stationsUrl(lang), LIMITS.stations)),
    settle(get(floodMapUrl(lang), LIMITS.floodMap)),
    fire ? settle(fire) : Promise.resolve(undefined),
  ]);
  const observations: Record<string, string | undefined> = {};
  if (stations !== undefined) {
    let near: ReturnType<typeof nearestStations> = [];
    try {
      near = nearestStations(parseStations(stations), place);
    } catch {
      near = [];
    }
    const texts = await Promise.all(
      near.map((s) =>
        settle(
          get(observationUrl(s), LIMITS.observation, "application/ld+json"),
        ),
      ),
    );
    near.forEach((s, i) => (observations[s.id] = texts[i]));
  }
  if (stations === undefined && flood === undefined && fireText === undefined)
    throw new OfficialError(navigator.onLine ? "http" : "offline");
  const received: Received = { stations, flood, fire: fireText, observations };
  const snapshot = buildSnapshot({
    place,
    lang,
    at: Date.now(),
    received,
    previous,
  });
  writeSnapshot(storage(), journalId, snapshot);
  return snapshot;
}
