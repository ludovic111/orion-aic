import { z } from "zod";
import { fromMN95, toMN95 } from "./coordinates.ts";
import { zurichInputMs } from "./time.ts";

// Official warnings and water levels next to the forecast (Météo module).
//
// Only open data of the Confederation, free, without key, readable from the
// browser (CORS verified), fetched on request:
//
// - Flood danger map of the FOEN (OFEV / BAFU), regions, rivers and lakes
//   with their official danger level 1–5 and wording:
//   data.geo.admin.ch/ch.bafu.hydroweb-warnkarte_national (a whole-country
//   file: nothing about the place is sent).
// - Forest fire danger of the cantons and the FOEN, level 1–5:
//   api3.geo.admin.ch identify on ch.bafu.gefahren-waldbrand_warnung (the
//   coordinates of the place are sent, in MN95).
// - FOEN gauging stations and their flood danger level:
//   data.geo.admin.ch/ch.bafu.hydroweb-messstationen_gefahren (whole file).
// - Current discharge and water level of the nearest stations: LINDAS
//   (environment.ld.admin.ch), one request per station number.
//
// MeteoSwiss weather warnings (thunderstorms, rain, wind, snow, heat, frost)
// are not published as open data callable from a browser: the module links
// to the official MeteoSwiss page instead of copying them.
//
// Everything here is pure (no network, no storage of its own): the texts
// received are parsed with Zod schemas and size limits, so recorded answers
// test it. Features that do not match are dropped one by one; a file whose
// overall shape is wrong is refused.

export type Lang = "fr" | "de" | "it";
export type Level = 0 | 1 | 2 | 3 | 4 | 5;
export type Place = { name: string; lat: number; lng: number };

/** Largest answer accepted from each source, in characters. */
export const LIMITS = {
  stations: 2_000_000,
  floodMap: 6_000_000,
  fire: 200_000,
  observation: 32_000,
} as const;

/** How many stations are shown, and how far they may be. */
export const NEAREST = { count: 3, maxKm: 25 } as const;
/** Rivers and lakes of the flood map looked at around the place. */
export const FLOOD_RADIUS_KM = 5;
/** Level from which the Situation page shows an official warning. */
export const BANNER_LEVEL = 3;

export type FailureCode =
  "too-large" | "invalid" | "http" | "timeout" | "offline";
export class OfficialError extends Error {
  readonly code: FailureCode;
  constructor(code: FailureCode, message: string = code) {
    super(message);
    this.code = code;
    this.name = "OfficialError";
  }
}

/* ---------- Addresses ---------- */

export const stationsUrl = (lang: Lang) =>
  `https://data.geo.admin.ch/ch.bafu.hydroweb-messstationen_gefahren/ch.bafu.hydroweb-messstationen_gefahren_${lang}.json`;
export const floodMapUrl = (lang: Lang) =>
  `https://data.geo.admin.ch/ch.bafu.hydroweb-warnkarte_national/ch.bafu.hydroweb-warnkarte_national_${lang}.json`;
export const STATION_ID = /^\d{3,6}$/;
export const observationUrl = (s: { id: string; lake: boolean }) => {
  if (!STATION_ID.test(s.id)) throw new OfficialError("invalid");
  return `https://environment.ld.admin.ch/foen/hydro/${s.lake ? "lake" : "river"}/observation/${s.id}`;
};
/** Forest fire danger at a point: only the MN95 coordinates are sent. */
export function fireUrl(place: Pick<Place, "lat" | "lng">, lang: Lang) {
  const p = toMN95(place.lat, place.lng);
  const e = p.east.toFixed(0);
  const n = p.north.toFixed(0);
  const q = new URLSearchParams({
    geometry: `${e},${n}`,
    geometryType: "esriGeometryPoint",
    imageDisplay: "100,100,96",
    mapExtent: `${p.east - 50},${p.north - 50},${p.east + 50},${p.north + 50}`,
    tolerance: "0",
    layers: "all:ch.bafu.gefahren-waldbrand_warnung",
    sr: "2056",
    lang,
    returnGeometry: "false",
    limit: "5",
  });
  return `https://api3.geo.admin.ch/rest/services/api/MapServer/identify?${q}`;
}

/** Official pages, in the language of the post. */
export const OFFICIAL_PAGES: Record<
  Lang,
  { meteoswiss: string; hazards: string }
> = {
  fr: {
    meteoswiss: "https://www.meteosuisse.admin.ch/meteo/dangers.html",
    hazards: "https://www.dangers-naturels.ch",
  },
  de: {
    meteoswiss: "https://www.meteoschweiz.admin.ch/wetter/gefahren.html",
    hazards: "https://www.naturgefahren.ch",
  },
  it: {
    meteoswiss: "https://www.meteosvizzera.admin.ch/tempo/pericoli.html",
    hazards: "https://www.pericoli-naturali.ch",
  },
};
export const stationPageUrl = (id: string, lang: Lang) =>
  STATION_ID.test(id)
    ? `https://www.hydrodaten.admin.ch/${lang}/seen-und-fluesse/stationen-und-daten/${id}`
    : OFFICIAL_PAGES[lang].hazards;

/* ---------- Helpers ---------- */

function readJson(text: unknown, max: number): unknown {
  if (typeof text !== "string") throw new OfficialError("invalid");
  if (text.length > max) throw new OfficialError("too-large");
  try {
    return JSON.parse(text);
  } catch {
    throw new OfficialError("invalid");
  }
}

/** Text of an HTML fragment of the source (never rendered as HTML). */
export const plainText = (html: string, max = 300) =>
  html
    .replace(/<(?:br|p|td|tr|li|div)\b[^>]*>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "’")
    .replace(/&quot;/g, '"')
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

const toLevel = (n: number): Level =>
  Number.isInteger(n) && n >= 0 && n <= 5 ? (n as Level) : 0;

/** "27.09.2026 08:45" or "26.08.2026" (Zurich time) → ISO, or "". */
export function swissDate(value: string): string {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})(?: (\d{2}):(\d{2}))?$/.exec(
    value.trim(),
  );
  if (!m) return "";
  const [, d, mo, y, h = "00", mi = "00"] = m;
  const at = zurichInputMs(`${y}-${mo}-${d}T${h}:${mi}`);
  return Number.isFinite(at) ? new Date(at).toISOString() : "";
}

const mn95 = z.tuple([z.number(), z.number()]).rest(z.number());

/* ---------- Gauging stations ---------- */

export type Station = {
  id: string;
  /** "Arve", then "Genève, Bout du Monde". */
  water: string;
  place: string;
  lake: boolean;
  /** Official flood danger level of the station (0: no data). */
  level: Level;
  east: number;
  north: number;
  lat: number;
  lng: number;
};

const stationFeature = z.object({
  id: z.union([z.string(), z.number()]),
  geometry: z.object({ type: z.literal("Point"), coordinates: mn95 }),
  properties: z.object({
    name: z.string().max(300),
    "quant-class": z.number().int().min(0).max(5).optional(),
    station_symbol: z.number().int().optional(),
  }),
});
const stationsFile = z.object({
  features: z.array(z.unknown()).max(5000),
});

/** Stations of the FOEN (MN95 coordinates in the file). */
export function parseStations(text: unknown): Station[] {
  const file = stationsFile.safeParse(readJson(text, LIMITS.stations));
  if (!file.success) throw new OfficialError("invalid");
  const out: Station[] = [];
  for (const raw of file.data.features) {
    const f = stationFeature.safeParse(raw);
    if (!f.success) continue;
    const id = String(f.data.id);
    if (!STATION_ID.test(id)) continue;
    const [east, north] = f.data.geometry.coordinates;
    let lat: number;
    let lng: number;
    try {
      ({ lat, lng } = fromMN95(east, north));
    } catch {
      continue;
    }
    // "Arve - Genève, Bout du Monde (2170)"
    const name = plainText(f.data.properties.name, 200)
      .replace(/\s*\(\d+\)\s*$/, "")
      .trim();
    const cut = name.indexOf(" - ");
    out.push({
      id,
      water: cut > 0 ? name.slice(0, cut) : name,
      place: cut > 0 ? name.slice(cut + 3) : "",
      // 1: lake, 2: river (the only two symbols of the layer).
      lake: f.data.properties.station_symbol === 1,
      level: toLevel(f.data.properties["quant-class"] ?? 0),
      east,
      north,
      lat,
      lng,
    });
  }
  return out;
}

const km = (a: { east: number; north: number }, b: typeof a) =>
  Math.hypot(a.east - b.east, a.north - b.north) / 1000;

/** The nearest stations to the place, with their distance in km. */
export function nearestStations(
  stations: Station[],
  place: Pick<Place, "lat" | "lng">,
  count: number = NEAREST.count,
  maxKm: number = NEAREST.maxKm,
): (Station & { km: number })[] {
  let at: { east: number; north: number };
  try {
    at = toMN95(place.lat, place.lng);
  } catch {
    return [];
  }
  return stations
    .map((s) => ({ ...s, km: Math.round(km(s, at) * 10) / 10 }))
    .filter((s) => s.km <= maxKm)
    .sort((a, b) => a.km - b.km || a.id.localeCompare(b.id))
    .slice(0, count);
}

/* ---------- Current measurement (LINDAS) ---------- */

export type Measurement = {
  station: string;
  /** Time of the measurement (ms). */
  at: number;
  /** m³/s (rivers). */
  discharge: number | null;
  /** Metres above sea level. */
  waterLevel: number | null;
  /** °C. */
  temperature: number | null;
  /** Official flood danger level at the station, when defined. */
  level: Level;
};

const DIM = "https://environment.ld.admin.ch/foen/hydro/dimension/";
const literal = z.union([
  z.object({ "@value": z.string().max(64) }),
  z.object({ "@id": z.string().max(300) }),
]);
const observationSchema = z.object({
  "@id": z.string().max(300),
  [`${DIM}measurementTime`]: z.object({ "@value": z.string().max(64) }),
  [`${DIM}station`]: z.object({ "@id": z.string().max(300) }),
  [`${DIM}discharge`]: literal.optional(),
  [`${DIM}waterLevel`]: literal.optional(),
  [`${DIM}waterTemperature`]: literal.optional(),
  [`${DIM}dangerLevel`]: literal.optional(),
});

function valueOf(
  v: z.infer<typeof literal> | undefined,
  min: number,
  max: number,
): number | null {
  if (!v || !("@value" in v)) return null;
  const n = Number(v["@value"]);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

/** The last measurement of a station (JSON-LD of LINDAS). */
export function parseObservation(text: unknown, station: string): Measurement {
  const parsed = observationSchema.safeParse(
    readJson(text, LIMITS.observation),
  );
  if (!parsed.success) throw new OfficialError("invalid");
  const o = parsed.data as Record<string, z.infer<typeof literal>> &
    z.infer<typeof observationSchema>;
  // The answer must be about the station asked for.
  const about = o[`${DIM}station`]["@id"];
  if (!about.endsWith(`/station/${station}`))
    throw new OfficialError("invalid");
  const at = Date.parse(o[`${DIM}measurementTime`]["@value"]);
  if (!Number.isFinite(at)) throw new OfficialError("invalid");
  const level = valueOf(o[`${DIM}dangerLevel`], 1, 5);
  return {
    station,
    at,
    discharge: valueOf(o[`${DIM}discharge`], 0, 100_000),
    waterLevel: valueOf(o[`${DIM}waterLevel`], 0, 5000),
    temperature: valueOf(o[`${DIM}waterTemperature`], -5, 50),
    level: level === null ? 0 : toLevel(Math.round(level)),
  };
}

/* ---------- Warnings ---------- */

export type WarningKind = "region" | "river" | "lake" | "fire";

export type OfficialWarning = {
  /** Stable key: "flood:river:42", "fire:800". */
  key: string;
  source: "flood" | "fire";
  kind: WarningKind;
  level: Level;
  /** Region, river, lake or canton, as published. */
  name: string;
  /** Official wording of the level, as published. */
  text: string;
  /** Publication of the map (ISO), or "". */
  issuedAt: string;
  /** Start of validity (ISO), or "". */
  validFrom: string;
};

const floodFeature = z.object({
  geometry: z.object({
    type: z.enum(["Polygon", "MultiPolygon", "LineString", "MultiLineString"]),
    coordinates: z.array(z.unknown()).max(100_000),
  }),
  properties: z.object({
    ID: z.union([z.number(), z.string().max(40)]),
    "w-type": z.string().max(40),
    "ws-class": z.string().max(40),
    text: z.string().max(2000).optional(),
    description: z.string().max(4000).optional(),
  }),
});
const floodFile = z.object({
  features: z.array(z.unknown()).max(5000),
  creation_time: z.string().max(40).optional(),
});

type Pt = [number, number];
export type FloodZone = {
  key: string;
  kind: "region" | "river" | "lake";
  level: Level;
  name: string;
  text: string;
  /** Polygons (outer ring first) or lines, MN95. */
  polygons: Pt[][][];
  lines: Pt[][];
};
export type FloodMap = { issuedAt: string; zones: FloodZone[] };

/** A list of MN95 points, or null when any of them is not one. */
function points(value: unknown): Pt[] | null {
  if (!Array.isArray(value)) return null;
  const out: Pt[] = [];
  for (const p of value) {
    if (
      !Array.isArray(p) ||
      typeof p[0] !== "number" ||
      typeof p[1] !== "number" ||
      !Number.isFinite(p[0]) ||
      !Number.isFinite(p[1])
    )
      return null;
    out.push([p[0], p[1]]);
  }
  return out;
}
const nest = (value: unknown, depth: number): Pt[][] | null => {
  // depth 1: [[x, y]…] → one list; 2: [[[x, y]…]…] → lists.
  if (!Array.isArray(value)) return null;
  if (depth === 1) {
    const one = points(value);
    return one ? [one] : null;
  }
  const out: Pt[][] = [];
  for (const v of value) {
    const inner = nest(v, depth - 1);
    if (!inner) return null;
    out.push(...inner);
  }
  return out;
};

/** The flood danger map of the FOEN, in the language of the file. */
export function parseFloodMap(text: unknown): FloodMap {
  const file = floodFile.safeParse(readJson(text, LIMITS.floodMap));
  if (!file.success) throw new OfficialError("invalid");
  const zones: FloodZone[] = [];
  for (const raw of file.data.features) {
    const f = floodFeature.safeParse(raw);
    if (!f.success) continue;
    const p = f.data.properties;
    const type = p["w-type"].toLowerCase();
    if (type !== "region" && type !== "river" && type !== "lake") continue;
    const level = toLevel(Number(/\.(\d)$/.exec(p["ws-class"])?.[1] ?? 0));
    // "<b>Arve</b>: Degré de danger 1: …" → "Arve".
    const bold = /<b>([^<]{1,300})<\/b>/i.exec(p.description ?? "")?.[1];
    const name = plainText(bold ?? p.description?.split(":")[0] ?? "", 200);
    const { type: shape, coordinates } = f.data.geometry;
    let polygons: Pt[][][] = [];
    let lines: Pt[][] = [];
    if (shape === "Polygon") {
      const rings = nest(coordinates, 2);
      if (rings) polygons = [rings];
    } else if (shape === "MultiPolygon") {
      const all: Pt[][][] = [];
      for (const poly of coordinates) {
        const rings = nest(poly, 2);
        if (!rings) {
          all.length = 0;
          break;
        }
        all.push(rings);
      }
      polygons = all;
    } else if (shape === "LineString") lines = nest(coordinates, 1) ?? [];
    else lines = nest(coordinates, 2) ?? [];
    if (!polygons.length && !lines.length) continue;
    zones.push({
      key: `flood:${type}:${String(p.ID).slice(0, 40)}`,
      kind: type,
      level,
      name,
      text: plainText(p.text ?? "", 300),
      polygons,
      lines,
    });
  }
  return {
    issuedAt: swissDate(file.data.creation_time ?? ""),
    zones,
  };
}

function inRing([x, y]: Pt, ring: Pt[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}
const inPolygon = (p: Pt, rings: Pt[][]) =>
  rings.length > 0 &&
  inRing(p, rings[0]) &&
  !rings.slice(1).some((hole) => inRing(p, hole));

function segmentDistance([x, y]: Pt, [ax, ay]: Pt, [bx, by]: Pt) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len
    ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len))
    : 0;
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}
const lineDistance = (p: Pt, line: Pt[]) =>
  line.length === 1
    ? Math.hypot(p[0] - line[0][0], p[1] - line[0][1])
    : line
        .slice(1)
        .reduce(
          (min, b, i) => Math.min(min, segmentDistance(p, line[i], b)),
          Infinity,
        );

/**
 * Flood warnings that concern the place: the region that contains it, and
 * the rivers and lakes within `radiusKm`.
 */
export function floodWarningsAt(
  map: FloodMap,
  place: Pick<Place, "lat" | "lng">,
  radiusKm: number = FLOOD_RADIUS_KM,
): OfficialWarning[] {
  let p: Pt;
  try {
    const m = toMN95(place.lat, place.lng);
    p = [m.east, m.north];
  } catch {
    return [];
  }
  const near = radiusKm * 1000;
  const out: OfficialWarning[] = [];
  for (const z of map.zones) {
    const inside = z.polygons.some((rings) => inPolygon(p, rings));
    const close =
      z.kind !== "region" &&
      (inside ||
        z.polygons.some((rings) => lineDistance(p, rings[0]) <= near) ||
        z.lines.some((line) => lineDistance(p, line) <= near));
    if ((z.kind === "region" && inside) || close)
      out.push({
        key: z.key,
        source: "flood",
        kind: z.kind,
        level: z.level,
        name: z.name,
        text: z.text,
        issuedAt: map.issuedAt,
        validFrom: "",
      });
  }
  return sortWarnings(out);
}

const fireResult = z.object({
  layerBodId: z.literal("ch.bafu.gefahren-waldbrand_warnung"),
  id: z.union([z.number(), z.string().max(40)]),
  attributes: z.object({
    name_fr: z.string().max(200).optional(),
    name_de: z.string().max(200).optional(),
    name_it: z.string().max(200).optional(),
    title_fr: z.string().max(200).optional(),
    title_de: z.string().max(200).optional(),
    title_it: z.string().max(200).optional(),
    title_en: z.string().max(200),
    valid_from: z.string().max(40).optional(),
  }),
});

/** Level of a forest fire danger, from its English title (stable). */
export function fireLevel(titleEn: string): Level {
  const t = titleEn.toLowerCase();
  if (/very high/.test(t)) return 5;
  if (/high/.test(t)) return 4;
  if (/considerable/.test(t)) return 3;
  if (/moderate/.test(t)) return 2;
  if (/\blow\b|no danger|none/.test(t)) return 1;
  return 0;
}

/** Forest fire danger at the place (identify answer of geo.admin.ch). */
export function parseFire(text: unknown, lang: Lang): OfficialWarning[] {
  const file = z
    .object({ results: z.array(z.unknown()).max(50) })
    .safeParse(readJson(text, LIMITS.fire));
  if (!file.success) throw new OfficialError("invalid");
  const out: OfficialWarning[] = [];
  for (const raw of file.data.results) {
    const r = fireResult.safeParse(raw);
    if (!r.success) continue;
    const a = r.data.attributes;
    const level = fireLevel(a.title_en);
    if (!level) continue;
    out.push({
      key: `fire:${String(r.data.id).slice(0, 40)}`,
      source: "fire",
      kind: "fire",
      level,
      name: plainText(a[`name_${lang}`] ?? a.name_fr ?? "", 200),
      text: plainText(a[`title_${lang}`] ?? a.title_en, 200),
      issuedAt: "",
      validFrom: swissDate(a.valid_from ?? ""),
    });
  }
  return sortWarnings(out);
}

export const sortWarnings = (list: OfficialWarning[]) =>
  [...list].sort((a, b) => b.level - a.level || a.key.localeCompare(b.key));

/* ---------- Snapshot kept on this device ---------- */

const level = z.number().int().min(0).max(5) as unknown as z.ZodType<Level>;
const warningSchema = z
  .object({
    key: z.string().max(80),
    source: z.enum(["flood", "fire"]),
    kind: z.enum(["region", "river", "lake", "fire"]),
    level,
    name: z.string().max(300),
    text: z.string().max(300),
    issuedAt: z.string().max(40),
    validFrom: z.string().max(40),
  })
  .strict();
const readingSchema = z
  .object({
    id: z.string().regex(STATION_ID),
    water: z.string().max(200),
    place: z.string().max(200),
    lake: z.boolean(),
    km: z.number().min(0).max(1000),
    level,
    at: z.number().nullable(),
    discharge: z.number().nullable(),
    waterLevel: z.number().nullable(),
    temperature: z.number().nullable(),
  })
  .strict();
export type StationReading = z.infer<typeof readingSchema>;
const pointSchema = z
  .object({
    at: z.number(),
    discharge: z.number().nullable(),
    waterLevel: z.number().nullable(),
  })
  .strict();
export type HistoryPoint = z.infer<typeof pointSchema>;
export const SOURCES = ["flood", "fire", "stations"] as const;
/** History of the measurements loaded here: 12 h, at most 96 points. */
const HISTORY_POINTS = 96;
const HISTORY_MS = 12 * 3_600_000;
export type Source = (typeof SOURCES)[number];

export const snapshotSchema = z
  .object({
    version: z.literal(1),
    place: z
      .object({
        name: z.string().max(200),
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
      })
      .strict(),
    lang: z.enum(["fr", "de", "it"]),
    /** Last attempt (ms). */
    fetchedAt: z.number(),
    /** Last success of each source (ms). */
    updated: z
      .object({
        flood: z.number().optional(),
        fire: z.number().optional(),
        stations: z.number().optional(),
      })
      .strict(),
    /** Sources that failed at the last attempt (their last data is kept). */
    failed: z.array(z.enum(SOURCES)).max(3),
    warnings: z.array(warningSchema).max(60),
    stations: z.array(readingSchema).max(10),
    /** Readings of this device, to show a trend: per station, 12 h. */
    history: z.record(
      z.string().regex(STATION_ID),
      z.array(pointSchema).max(HISTORY_POINTS),
    ),
  })
  .strict();
export type Snapshot = z.infer<typeof snapshotSchema>;

export const snapshotKey = (journalId: string) =>
  `orion-aic:official:${journalId}`;

type Store = Pick<Storage, "getItem" | "setItem">;

/** The last snapshot of this device for the journal, or null. */
export function readSnapshot(
  storage: Store | null | undefined,
  journalId: string,
): Snapshot | null {
  try {
    const raw = storage?.getItem(snapshotKey(journalId));
    if (!raw || raw.length > 400_000) return null;
    const parsed = snapshotSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
export function writeSnapshot(
  storage: Store | null | undefined,
  journalId: string,
  snapshot: Snapshot,
) {
  try {
    storage?.setItem(snapshotKey(journalId), JSON.stringify(snapshot));
    return true;
  } catch {
    // Storage full or disabled: shown anyway, not kept.
    return false;
  }
}

/** Same place (to 100 m): a snapshot of another place is not shown. */
export const samePlace = (
  a: Pick<Place, "lat" | "lng"> | null | undefined,
  b: Pick<Place, "lat" | "lng"> | null | undefined,
) =>
  !!a &&
  !!b &&
  Math.abs(a.lat - b.lat) < 0.001 &&
  Math.abs(a.lng - b.lng) < 0.001;

export type Freshness = "fresh" | "aging" | "stale";
/** How old the data is: fresh under 45 min, stale after 3 h. */
export function freshness(
  at: number,
  now: number,
): {
  minutes: number;
  state: Freshness;
} {
  const minutes = Math.max(0, Math.floor((now - at) / 60_000));
  return {
    minutes,
    state: minutes < 45 ? "fresh" : minutes < 180 ? "aging" : "stale",
  };
}

/** Adds the readings to the history (12 h, one point per measurement). */
export function mergeHistory(
  history: Snapshot["history"],
  readings: Measurement[],
  now: number,
): Snapshot["history"] {
  const out: Snapshot["history"] = {};
  const ids = new Set([
    ...Object.keys(history),
    ...readings.map((r) => r.station),
  ]);
  for (const id of ids) {
    const points = [...(history[id] ?? [])];
    for (const r of readings)
      if (r.station === id && !points.some((p) => p.at === r.at))
        points.push({
          at: r.at,
          discharge: r.discharge,
          waterLevel: r.waterLevel,
        });
    const kept = points
      .filter((p) => p.at > now - HISTORY_MS && p.at <= now + 3_600_000)
      .sort((a, b) => a.at - b.at)
      .slice(-HISTORY_POINTS);
    if (kept.length) out[id] = kept;
  }
  return out;
}

export type Trend = {
  direction: "up" | "down" | "steady";
  /** Change since the reference measurement, in the unit of the value. */
  delta: number;
  minutes: number;
};

/**
 * Trend of a station: the latest measurement against the one closest to an
 * hour before (between 30 min and 3 h before). Null without such a point:
 * the trend is computed from the measurements this device has loaded.
 */
export function trendOf(
  points: HistoryPoint[] | undefined,
  metric: "discharge" | "waterLevel",
): Trend | null {
  if (!points?.length) return null;
  const sorted = [...points].sort((a, b) => a.at - b.at);
  const last = sorted[sorted.length - 1];
  const now = last[metric];
  if (now === null) return null;
  const candidates = sorted.filter(
    (p) =>
      p[metric] !== null &&
      p.at <= last.at - 30 * 60_000 &&
      p.at >= last.at - 3 * 3_600_000,
  );
  if (!candidates.length) return null;
  const ref = candidates.reduce((best, p) =>
    Math.abs(last.at - p.at - 3_600_000) <
    Math.abs(last.at - best.at - 3_600_000)
      ? p
      : best,
  );
  const delta = now - (ref[metric] as number);
  // Below the noise: 2 % of the discharge (at least 0.5 m³/s), 2 cm.
  const noise =
    metric === "discharge" ? Math.max(0.5, Math.abs(now) * 0.02) : 0.02;
  return {
    direction: Math.abs(delta) < noise ? "steady" : delta > 0 ? "up" : "down",
    delta: Math.round(delta * 100) / 100,
    minutes: Math.round((last.at - ref.at) / 60_000),
  };
}

export type Received = {
  /** Texts received, undefined when that request failed. */
  stations?: string;
  flood?: string;
  fire?: string;
  /** Measurement texts per station number. */
  observations?: Record<string, string | undefined>;
};

/**
 * The snapshot built from the answers received. A source that fails keeps
 * its previous data (same place and language) and is listed in `failed`.
 */
export function buildSnapshot(input: {
  place: Place;
  lang: Lang;
  at: number;
  received: Received;
  previous: Snapshot | null;
}): Snapshot {
  const { place, lang, at, received } = input;
  const previous =
    input.previous &&
    samePlace(input.previous.place, place) &&
    input.previous.lang === lang
      ? input.previous
      : null;
  const failed: Source[] = [];
  const updated: Snapshot["updated"] = { ...(previous?.updated ?? {}) };
  const keep = (source: "flood" | "fire") =>
    previous?.warnings.filter((w) => w.source === source) ?? [];

  let flood: OfficialWarning[];
  try {
    if (received.flood === undefined) throw new OfficialError("http");
    flood = floodWarningsAt(parseFloodMap(received.flood), place);
    updated.flood = at;
  } catch {
    failed.push("flood");
    flood = keep("flood");
  }
  let fire: OfficialWarning[];
  try {
    if (received.fire === undefined) throw new OfficialError("http");
    fire = parseFire(received.fire, lang);
    updated.fire = at;
  } catch {
    failed.push("fire");
    fire = keep("fire");
  }

  let stations: StationReading[] = previous?.stations ?? [];
  let history = previous?.history ?? {};
  try {
    if (received.stations === undefined) throw new OfficialError("http");
    const near = nearestStations(parseStations(received.stations), place);
    const measured: Measurement[] = [];
    stations = near.map((s) => {
      let m: Measurement | null = null;
      try {
        const text = received.observations?.[s.id];
        if (text !== undefined) m = parseObservation(text, s.id);
      } catch {
        m = null;
      }
      const before = previous?.stations.find((p) => p.id === s.id);
      if (m) measured.push(m);
      return {
        id: s.id,
        water: s.water,
        place: s.place,
        lake: s.lake,
        km: s.km,
        level: m?.level || s.level,
        at: m?.at ?? before?.at ?? null,
        discharge: m ? m.discharge : (before?.discharge ?? null),
        waterLevel: m ? m.waterLevel : (before?.waterLevel ?? null),
        temperature: m ? m.temperature : (before?.temperature ?? null),
      };
    });
    history = mergeHistory(
      Object.fromEntries(
        Object.entries(history).filter(([id]) =>
          stations.some((s) => s.id === id),
        ),
      ),
      measured,
      at,
    );
    // Every measurement asked for failed: counted as a failure.
    if (near.length && !measured.length) failed.push("stations");
    else updated.stations = at;
  } catch {
    failed.push("stations");
  }

  return snapshotSchema.parse({
    version: 1,
    place: {
      name: place.name.slice(0, 200),
      lat: place.lat,
      lng: place.lng,
    },
    lang,
    fetchedAt: at,
    updated,
    failed,
    warnings: sortWarnings([...fire, ...flood]).slice(0, 60),
    stations,
    history,
  });
}

/** Station readings as warnings of their own when a level is published. */
export type Highlight =
  | { kind: "warning"; level: Level; warning: OfficialWarning }
  | { kind: "station"; level: Level; station: StationReading };

/** What the Situation page shows: official levels from `min` up. */
export function highlights(
  snapshot: Snapshot | null,
  min: number = BANNER_LEVEL,
): Highlight[] {
  if (!snapshot) return [];
  const out: Highlight[] = [
    ...snapshot.warnings
      .filter((w) => w.level >= min)
      .map((w) => ({ kind: "warning" as const, level: w.level, warning: w })),
    ...snapshot.stations
      .filter((s) => s.level >= min)
      .map((s) => ({ kind: "station" as const, level: s.level, station: s })),
  ];
  return out.sort((a, b) => b.level - a.level);
}

/** Highest official level of the snapshot (0: none). */
export const topLevel = (snapshot: Snapshot | null): Level =>
  toLevel(
    Math.max(
      0,
      ...(snapshot?.warnings.map((w) => w.level) ?? []),
      ...(snapshot?.stations.map((s) => s.level) ?? []),
    ),
  );
