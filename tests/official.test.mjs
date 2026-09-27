import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BANNER_LEVEL,
  LIMITS,
  OFFICIAL_PAGES,
  OfficialError,
  buildSnapshot,
  fireLevel,
  fireUrl,
  floodMapUrl,
  floodWarningsAt,
  freshness,
  highlights,
  mergeHistory,
  nearestStations,
  observationUrl,
  parseFire,
  parseFloodMap,
  parseObservation,
  parseStations,
  readSnapshot,
  samePlace,
  snapshotKey,
  stationPageUrl,
  stationsUrl,
  topLevel,
  trendOf,
  writeSnapshot,
} from "../shared/official.ts";
import { current, journalSchema, newJournal } from "../shared/journal.ts";
import { upsert } from "../shared/ops.ts";
import { mergeJournal, stampJournal } from "../shared/sync.ts";
import { fromZurichInput } from "../shared/time.ts";
import {
  HYDRO_HOLD,
  alertIdFor,
  applyHydroThresholds,
  applyThresholds,
  crossings,
  entryIdFor,
  thresholdLabel,
} from "../shared/thresholds.ts";
import { thresholdSchema } from "../shared/conduct-schemas.ts";

// Answers recorded on 27.09.2026 (trimmed: a few stations, zones with
// fewer points) from the official sources, see shared/official.ts.
const fixture = (name) =>
  readFileSync(new URL(`fixtures/official/${name}`, import.meta.url), "utf8");
const STATIONS = fixture("hydro-stations-fr.json");
const FLOOD = fixture("flood-map-fr.json");
const FIRE = fixture("fire-identify-geneve.json");
const ARVE = fixture("lindas-river-2170.json");
const RHONE = fixture("lindas-river-2606.json");
const LAKE = fixture("lindas-lake-2027.json");
const LAKE_UNDEFINED = fixture("lindas-lake-2026.json");

const CAROUGE = { name: "Carouge (GE)", lat: 46.1839, lng: 6.1397 };
const Z = (wall) => Date.parse(fromZurichInput(wall));
const iso = (ms) => new Date(ms).toISOString();
const code = (fn) => {
  try {
    fn();
  } catch (err) {
    return err instanceof OfficialError ? err.code : `other: ${err}`;
  }
  return "no error";
};

// ---------- Sources ----------

test("addresses: only coordinates (MN95) or station numbers are sent", () => {
  assert.equal(
    stationsUrl("de"),
    "https://data.geo.admin.ch/ch.bafu.hydroweb-messstationen_gefahren/ch.bafu.hydroweb-messstationen_gefahren_de.json",
  );
  assert.match(floodMapUrl("it"), /hydroweb-warnkarte_national_it\.json$/);
  const url = new URL(fireUrl(CAROUGE, "fr"));
  assert.equal(url.host, "api3.geo.admin.ch");
  assert.equal(
    url.searchParams.get("layers"),
    "all:ch.bafu.gefahren-waldbrand_warnung",
  );
  assert.equal(url.searchParams.get("geometry"), "2499708,1115547");
  assert.equal(url.searchParams.get("sr"), "2056");
  // Nothing but the query of the point (no name of the place).
  assert.ok(!url.search.includes("Carouge"));
  assert.throws(() => fireUrl({ lat: 48.85, lng: 2.35 }, "fr"));
  assert.equal(
    observationUrl({ id: "2170", lake: false }),
    "https://environment.ld.admin.ch/foen/hydro/river/observation/2170",
  );
  assert.equal(
    observationUrl({ id: "2027", lake: true }),
    "https://environment.ld.admin.ch/foen/hydro/lake/observation/2027",
  );
  assert.throws(() => observationUrl({ id: "../x", lake: false }));
  assert.equal(
    stationPageUrl("2170", "it"),
    "https://www.hydrodaten.admin.ch/it/seen-und-fluesse/stationen-und-daten/2170",
  );
  for (const lang of ["fr", "de", "it"])
    assert.match(OFFICIAL_PAGES[lang].meteoswiss, /^https:\/\/www\.meteo/);
});

test("stations: names, lakes, levels and the nearest to Carouge (the Arve first)", () => {
  const stations = parseStations(STATIONS);
  assert.equal(stations.length, 7);
  const arve = stations.find((s) => s.id === "2170");
  assert.equal(arve.water, "Arve");
  assert.equal(arve.place, "Genève, Bout du Monde");
  assert.equal(arve.lake, false);
  assert.equal(arve.level, 1);
  assert.ok(Math.abs(arve.lat - 46.1803) < 0.001);
  assert.ok(Math.abs(arve.lng - 6.1593) < 0.001);
  assert.equal(stations.find((s) => s.id === "2027").lake, true);
  // A station of the file without data: level 0.
  assert.ok(stations.some((s) => s.level === 0));
  const near = nearestStations(stations, CAROUGE);
  assert.deepEqual(
    near.map((s) => [s.id, s.km]),
    [
      ["2170", 1.6],
      ["2606", 2.3],
      ["2174", 13.5],
    ],
  );
  assert.deepEqual(
    nearestStations(stations, CAROUGE, 3, 5).map((s) => s.id),
    ["2170", "2606"],
  );
  // Outside Switzerland: no station, no error.
  assert.deepEqual(nearestStations(stations, { lat: 48.85, lng: 2.35 }), []);
});

test("stations: a malformed feature is dropped, a malformed file is refused", () => {
  const file = JSON.parse(STATIONS);
  file.features.push(
    {
      id: "x",
      geometry: { type: "Point", coordinates: [1, 2] },
      properties: { name: "Bad" },
    },
    {
      id: "2999",
      geometry: { type: "Point", coordinates: [2600000, 1200000] },
      properties: { name: "<b>A</b> - B (2999)", "quant-class": 9 },
    },
    {
      id: "3000",
      geometry: { type: "Point", coordinates: [10, 10] },
      properties: { name: "Far" },
    },
  );
  const stations = parseStations(JSON.stringify(file));
  assert.equal(
    stations.length,
    7,
    "invalid id, level 9 and non-MN95 point dropped",
  );
  assert.equal(
    code(() => parseStations("{")),
    "invalid",
  );
  assert.equal(
    code(() => parseStations('{"features": 3}')),
    "invalid",
  );
  assert.equal(
    code(() => parseStations(42)),
    "invalid",
  );
  assert.equal(
    code(() => parseStations(" ".repeat(LIMITS.stations + 1))),
    "too-large",
  );
});

test("measurements (LINDAS): discharge, level, time and danger level of the station asked for", () => {
  const arve = parseObservation(ARVE, "2170");
  assert.deepEqual(arve, {
    station: "2170",
    at: Date.parse("2026-09-27T18:10:00+01:00"),
    discharge: 26.994,
    waterLevel: 378.962,
    temperature: 11.45,
    level: 1,
  });
  const rhone = parseObservation(RHONE, "2606");
  assert.equal(rhone.discharge, 117.351);
  assert.equal(rhone.waterLevel, null);
  const lake = parseObservation(LAKE, "2027");
  assert.equal(lake.discharge, null);
  assert.ok(lake.waterLevel > 300 && lake.waterLevel < 400);
  // Danger level "cube:Undefined": no level.
  assert.equal(parseObservation(LAKE_UNDEFINED, "2026").level, 0);
  // An answer about another station is refused.
  assert.equal(
    code(() => parseObservation(ARVE, "2606")),
    "invalid",
  );
  assert.equal(
    code(() => parseObservation("<html>", "2170")),
    "invalid",
  );
  assert.equal(
    code(() => parseObservation("x".repeat(LIMITS.observation + 1), "2170")),
    "too-large",
  );
  // Out of range values are ignored, not trusted.
  const odd = JSON.parse(ARVE);
  odd["https://environment.ld.admin.ch/foen/hydro/dimension/discharge"][
    "@value"
  ] = "-5";
  odd["https://environment.ld.admin.ch/foen/hydro/dimension/dangerLevel"][
    "@value"
  ] = "7";
  const parsed = parseObservation(JSON.stringify(odd), "2170");
  assert.equal(parsed.discharge, null);
  assert.equal(parsed.level, 0);
});

test("flood map: the region of the place and the rivers and lakes nearby, with the official wording", () => {
  const map = parseFloodMap(FLOOD);
  assert.equal(map.issuedAt, "2026-09-27T06:45:00.000Z"); // 08:45 in Zurich
  const warnings = floodWarningsAt(map, CAROUGE);
  assert.deepEqual(
    warnings.map((w) => [w.key, w.kind, w.name, w.level]),
    [
      ["flood:lake:13", "lake", "Lac Léman", 1],
      ["flood:region:1280", "region", "Bassin lémanique", 1],
      ["flood:river:39", "river", "Rhône du lac Léman à Chancy", 1],
      ["flood:river:42", "river", "Arve", 1],
    ],
  );
  assert.equal(
    warnings[0].text,
    "Degré de danger 1: Aucun ou faible danger de crues",
  );
  assert.ok(!warnings.some((w) => w.name === "Alpstein"));
  // Level mapping: "River.3" is level 3 and comes first; "Region.0" is 0.
  const file = JSON.parse(FLOOD);
  for (const f of file.features) {
    if (f.properties.ID === 42) f.properties["ws-class"] = "River.3";
    if (f.properties.ID === 1280) f.properties["ws-class"] = "Region.0";
  }
  const raised = floodWarningsAt(parseFloodMap(JSON.stringify(file)), CAROUGE);
  assert.deepEqual(raised.map((w) => [w.name, w.level]).slice(0, 1), [
    ["Arve", 3],
  ]);
  assert.equal(raised.find((w) => w.kind === "region").level, 0);
  // Far away (Säntis): only its own region.
  assert.deepEqual(
    floodWarningsAt(map, { lat: 47.249, lng: 9.343 }).map((w) => w.name),
    ["Alpstein"],
  );
  assert.equal(
    code(() => parseFloodMap("[]")),
    "invalid",
  );
});

test("forest fire danger: level from the official title, validity and names in the language of the post", () => {
  const [fire] = parseFire(FIRE, "fr");
  assert.deepEqual(fire, {
    key: "fire:800",
    source: "fire",
    kind: "fire",
    level: 3,
    name: "Canton de Genève",
    text: "Danger marqué",
    issuedAt: "",
    validFrom: "2026-08-25T22:00:00.000Z", // 26.08.2026 in Zurich
  });
  assert.equal(parseFire(FIRE, "de")[0].text, "Erhebliche Gefahr");
  assert.equal(parseFire(FIRE, "it")[0].name, "Canton Ginevra");
  assert.deepEqual(
    [
      "No or low danger",
      "Low danger",
      "Moderate danger",
      "Considerable danger",
      "High danger",
      "Very high danger",
      "Fire ban",
    ].map(fireLevel),
    [1, 1, 2, 3, 4, 5, 0],
  );
  // Another layer in the answer is ignored.
  const other = JSON.parse(FIRE);
  other.results[0].layerBodId = "ch.other";
  assert.deepEqual(parseFire(JSON.stringify(other), "fr"), []);
  assert.equal(
    code(() => parseFire("null", "fr")),
    "invalid",
  );
});

// ---------- Snapshot, cache, trend ----------

const received = (extra = {}) => ({
  stations: STATIONS,
  flood: FLOOD,
  fire: FIRE,
  observations: { 2170: ARVE, 2606: RHONE },
  ...extra,
});
const AT = Date.parse("2026-09-27T17:30:00Z");

test("snapshot: warnings sorted by level, stations with their measurement, banner from level 3", () => {
  const s = buildSnapshot({
    place: CAROUGE,
    lang: "fr",
    at: AT,
    received: received(),
    previous: null,
  });
  assert.deepEqual(s.failed, []);
  assert.equal(s.warnings[0].key, "fire:800");
  assert.equal(s.warnings.length, 5);
  assert.deepEqual(
    s.stations.map((x) => [x.id, x.discharge, x.at !== null]),
    [
      ["2170", 26.994, true],
      ["2606", 117.351, true],
      ["2174", null, false], // no measurement received: shown without value
    ],
  );
  assert.equal(s.history["2170"].length, 1);
  assert.equal(topLevel(s), 3);
  assert.equal(BANNER_LEVEL, 3);
  const banner = highlights(s);
  assert.deepEqual(
    banner.map((h) => [h.kind, h.level]),
    [["warning", 3]],
  );
  // A station at level 4 comes first.
  const high = {
    ...s,
    stations: s.stations.map((x, i) => (i ? x : { ...x, level: 4 })),
  };
  assert.deepEqual(
    highlights(high).map((h) => [h.kind, h.level]),
    [
      ["station", 4],
      ["warning", 3],
    ],
  );
  assert.deepEqual(highlights(null), []);
});

test("snapshot: a source that fails keeps its last data and is named; another place starts afresh", () => {
  const first = buildSnapshot({
    place: CAROUGE,
    lang: "fr",
    at: AT,
    received: received(),
    previous: null,
  });
  const later = AT + 30 * 60_000;
  const second = buildSnapshot({
    place: CAROUGE,
    lang: "fr",
    at: later,
    received: received({
      flood: undefined,
      fire: "<html>error</html>",
      observations: {},
    }),
    previous: first,
  });
  assert.deepEqual(second.failed, ["flood", "fire", "stations"]);
  assert.deepEqual(second.warnings, first.warnings);
  assert.equal(second.updated.flood, AT);
  assert.equal(second.updated.fire, AT);
  assert.equal(second.stations[0].discharge, 26.994, "last value kept");
  // The same place in another language, or another place: nothing kept.
  const other = buildSnapshot({
    place: { name: "Sion", lat: 46.233, lng: 7.36 },
    lang: "fr",
    at: later,
    received: { stations: STATIONS },
    previous: first,
  });
  assert.deepEqual(other.warnings, []);
  assert.deepEqual(other.failed, ["flood", "fire"]);
  assert.ok(!other.stations.some((x) => x.id === "2170"));
});

test("cache: read back, corrupt or foreign data ignored, freshness and same place", () => {
  const store = new Map();
  const storage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  };
  const s = buildSnapshot({
    place: CAROUGE,
    lang: "fr",
    at: AT,
    received: received(),
    previous: null,
  });
  assert.equal(readSnapshot(storage, "j1"), null);
  assert.ok(writeSnapshot(storage, "j1", s));
  assert.deepEqual(readSnapshot(storage, "j1"), s);
  assert.equal(readSnapshot(storage, "j2"), null, "per journal");
  store.set(snapshotKey("j1"), "{not json");
  assert.equal(readSnapshot(storage, "j1"), null);
  store.set(snapshotKey("j1"), JSON.stringify({ ...s, version: 2 }));
  assert.equal(readSnapshot(storage, "j1"), null);
  store.set(
    snapshotKey("j1"),
    JSON.stringify({ ...s, warnings: [{ ...s.warnings[0], level: 9 }] }),
  );
  assert.equal(readSnapshot(storage, "j1"), null);
  // Storage refusing: no crash.
  const full = {
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("full");
    },
  };
  assert.equal(readSnapshot(full, "j1"), null);
  assert.equal(writeSnapshot(full, "j1", s), false);
  assert.equal(readSnapshot(null, "j1"), null);

  assert.deepEqual(freshness(AT, AT + 10 * 60_000), {
    minutes: 10,
    state: "fresh",
  });
  assert.deepEqual(freshness(AT, AT + 90 * 60_000), {
    minutes: 90,
    state: "aging",
  });
  assert.deepEqual(freshness(AT, AT + 5 * 3_600_000), {
    minutes: 300,
    state: "stale",
  });
  assert.deepEqual(freshness(AT, AT - 60_000), { minutes: 0, state: "fresh" });
  assert.ok(samePlace(CAROUGE, { lat: 46.18395, lng: 6.13975 }));
  assert.ok(!samePlace(CAROUGE, { lat: 46.2, lng: 6.14 }));
  assert.ok(!samePlace(CAROUGE, null));
});

test("trend: against the measurement about an hour before, from this device's history", () => {
  const H = 3_600_000;
  const reading = (at, discharge, waterLevel = null) => ({
    station: "2170",
    at,
    discharge,
    waterLevel,
    temperature: null,
    level: 1,
  });
  let history = mergeHistory({}, [reading(AT - 2 * H, 20)], AT);
  history = mergeHistory(history, [reading(AT - H, 22)], AT);
  history = mergeHistory(history, [reading(AT - 10 * 60_000, 23)], AT);
  history = mergeHistory(history, [reading(AT, 30)], AT);
  // Duplicate measurement (same time): kept once.
  history = mergeHistory(history, [reading(AT, 30)], AT);
  assert.equal(history["2170"].length, 4);
  assert.deepEqual(trendOf(history["2170"], "discharge"), {
    direction: "up",
    delta: 8,
    minutes: 60,
  });
  const down = mergeHistory({}, [reading(AT - H, 30), reading(AT, 25)], AT);
  assert.equal(trendOf(down["2170"], "discharge").direction, "down");
  const steady = mergeHistory({}, [reading(AT - H, 100), reading(AT, 101)], AT);
  assert.equal(trendOf(steady["2170"], "discharge").direction, "steady");
  // Only a measurement 10 minutes before: no trend yet.
  const short = mergeHistory(
    {},
    [reading(AT - 10 * 60_000, 1), reading(AT, 9)],
    AT,
  );
  assert.equal(trendOf(short["2170"], "discharge"), null);
  assert.equal(trendOf(undefined, "discharge"), null);
  // Water level of a lake: 2 cm is the noise.
  const lake = mergeHistory(
    {},
    [reading(AT - H, null, 372.1), reading(AT, null, 372.15)],
    AT,
  );
  assert.equal(trendOf(lake["2170"], "waterLevel").direction, "up");
  // Older than 12 hours: forgotten.
  const old = mergeHistory({}, [reading(AT - 13 * H, 5), reading(AT, 6)], AT);
  assert.equal(old["2170"].length, 1);
});

// ---------- Discharge thresholds ----------

const TH = "33333333-3333-4333-8333-333333333333";
const withHydro = (extra = {}) => {
  const j = newJournal("Crue");
  return journalSchema.parse({
    ...j,
    ops: upsert(
      j.ops,
      "thresholds",
      {
        id: TH,
        metric: "discharge",
        value: 250,
        level: "4",
        label: "",
        region: "",
        active: true,
        followUp: true,
        station: "2170",
        stationName: "Arve · Genève, Bout du Monde",
        ...extra,
      },
      "PC",
    ),
  });
};
const arveAt = (at, discharge) => ({
  station: "2170",
  name: "Arve · Genève, Bout du Monde",
  at,
  discharge,
  waterLevel: 380.1,
});

test("discharge threshold: crossed by the measurement, one alert and one entry, extended while above", () => {
  const at = Z("2026-09-27T16:10");
  const j = withHydro();
  const th = j.ops.thresholds[0];
  assert.equal(
    thresholdLabel(th),
    "Débit mesuré ≥ 250 m³/s · Arve · Genève, Bout du Monde",
  );
  // Below: nothing.
  const below = applyHydroThresholds(j, [arveAt(at, 180)], "PC", at);
  assert.equal(below.journal, j);
  assert.equal(below.created.length, 0);
  // Another station: nothing.
  assert.equal(
    applyHydroThresholds(j, [{ ...arveAt(at, 400), station: "2606" }], "PC", at)
      .created.length,
    0,
  );
  // A measurement older than 6 hours is not compared.
  assert.equal(
    applyHydroThresholds(j, [arveAt(at - 7 * 3_600_000, 400)], "PC", at).created
      .length,
    0,
  );
  const once = applyHydroThresholds(j, [arveAt(at, 312.5)], "PC", at + 60_000);
  assert.equal(once.created.length, 1);
  const alert = once.journal.ops.alerts.find(
    (a) => a.id === alertIdFor(th.id, "2026-09-27"),
  );
  assert.ok(alert);
  assert.equal(alert.level, "4");
  assert.equal(alert.from, iso(at));
  assert.equal(alert.to, iso(at + HYDRO_HOLD));
  assert.match(alert.notes, /312\.5 m³\/s à 16:10/);
  assert.match(alert.source, /station 2170/);
  const entry = once.journal.entries.find(
    (e) => e.id === entryIdFor(th.id, "2026-09-27"),
  );
  assert.equal(current(entry).status, "À traiter");
  assert.deepEqual(current(entry).tags, ["crue", "seuil"]);
  // Same measurement again: nothing new.
  const again = applyHydroThresholds(
    once.journal,
    [arveAt(at, 312.5)],
    "PC",
    at + 120_000,
  );
  assert.equal(again.journal, once.journal);
  // Still above 30 minutes later: the end moves, no second alert.
  const later = at + 30 * 60_000;
  const still = applyHydroThresholds(
    once.journal,
    [arveAt(later, 330)],
    "PC",
    later,
  );
  assert.equal(still.created.length, 0);
  assert.equal(still.extended, 1);
  assert.equal(
    still.journal.ops.alerts.find((a) => a.id === alert.id).to,
    iso(later + HYDRO_HOLD),
  );
  assert.equal(still.journal.ops.alerts.length, 1);
  // Removed by an operator: not recreated.
  const removed = {
    ...once.journal,
    ops: { ...once.journal.ops, alerts: [] },
    sync: { ...once.journal.sync, removed: { [alert.id]: iso(at + 5000) } },
  };
  assert.equal(
    applyHydroThresholds(removed, [arveAt(later, 330)], "PC", later).created
      .length,
    0,
  );
  // Inactive, or without station: never.
  assert.equal(
    applyHydroThresholds(
      withHydro({ active: false }),
      [arveAt(at, 999)],
      "PC",
      at,
    ).created.length,
    0,
  );
  assert.equal(
    applyHydroThresholds(
      withHydro({ station: "" }),
      [arveAt(at, 999)],
      "PC",
      at,
    ).created.length,
    0,
  );
});

test("water level threshold, and the forecast never evaluates a measured quantity", () => {
  const at = Z("2026-09-27T16:10");
  const j = withHydro({ metric: "waterLevel", value: 380, followUp: false });
  const r = applyHydroThresholds(j, [arveAt(at, 10)], "PC", at);
  assert.equal(r.created.length, 1);
  assert.equal(r.journal.entries.length, 0, "no entry asked");
  // The forecast has no discharge: no crossing, no alert.
  const forecast = {
    id: "44444444-4444-4444-8444-444444444444",
    createdAt: iso(at),
    updatedAt: iso(at),
    by: "B",
    fetchedAt: iso(at),
    place: "Carouge (GE)",
    lat: 46.18,
    lng: 6.14,
    data: {
      model: "Test",
      current: {
        at,
        temperature: 500,
        humidity: 80,
        precipitation: 0,
        code: 3,
        wind: 10,
        direction: 200,
        gusts: 20,
      },
      hours: [
        {
          at: at + 3_600_000,
          temperature: 500,
          precipitation: 500,
          probability: 50,
          code: 63,
          wind: 500,
          gusts: 500,
        },
      ],
      days: [],
    },
  };
  assert.deepEqual(
    crossings({ metric: "discharge", value: 1 }, forecast.data, at),
    [],
  );
  assert.equal(applyThresholds(j, forecast, "PC", at).created.length, 0);
});

test("threshold schema: station number and values up to 10 000 accepted, nonsense refused", () => {
  const base = withHydro().ops.thresholds[0];
  assert.ok(thresholdSchema.safeParse({ ...base, value: 5000 }).success);
  assert.ok(
    thresholdSchema.safeParse({ ...base, value: 10001 }).success === false,
  );
  assert.ok(
    thresholdSchema.safeParse({ ...base, station: "abc" }).success === false,
  );
  assert.ok(thresholdSchema.safeParse({ ...base, station: "" }).success);
  const { station, stationName, ...older } = base;
  assert.ok(
    thresholdSchema.safeParse(older).success,
    "older thresholds stay valid",
  );
  assert.ok(station && stationName);
});

test("two posts loading the same measurement create one alert and one entry after merging", () => {
  const at = Z("2026-09-27T16:10");
  let base = withHydro();
  base = stampJournal(undefined, base, iso(at), "PC");
  const a = stampJournal(
    base,
    applyHydroThresholds(base, [arveAt(at, 300)], "A", at).journal,
    iso(at + 1000),
    "A",
  );
  const b = stampJournal(
    base,
    applyHydroThresholds(base, [arveAt(at, 300)], "B", at + 5000).journal,
    iso(at + 2000),
    "B",
  );
  for (const m of [mergeJournal(a, b), mergeJournal(b, a)]) {
    assert.equal(m.ops.alerts.length, 1);
    assert.equal(m.entries.length, 1);
    assert.equal(m.ops.links.length, 1);
  }
});
