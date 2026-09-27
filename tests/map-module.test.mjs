import test from "node:test";
import assert from "node:assert/strict";
import {
  isRecord,
  isView,
  readStore,
  writeStore,
} from "../src/modules/map/browser.ts";
import {
  DRAWING,
  boxOf,
  dropRepeats,
  isPlume,
  round6,
  sketchOf,
} from "../src/modules/map/tools.ts";
import {
  citedPositions,
  fileSlug,
  keepStable,
  latestWind,
  layerForKind,
  shiftBy,
  standardLayers,
  symbolForKind,
} from "../src/modules/map/places.ts";
import { circlePoints, lengthOf } from "../src/modules/map/geo.ts";
import { addEntry, emptyFields, newJournal } from "../shared/journal.ts";

// Pure parts of the situation map module (MapModule.tsx and its hooks):
// preferences of the browser, sketch of the drawing tools, map objects.

/** A localStorage of the test, restored afterwards. */
function withStorage(run) {
  const data = new Map();
  const fake = {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
  const before = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    value: fake,
    configurable: true,
    writable: true,
  });
  try {
    return run(data);
  } finally {
    if (before) Object.defineProperty(globalThis, "localStorage", before);
    else delete globalThis.localStorage;
  }
}

test("preferences of the map: read back, validated, never throwing", () => {
  withStorage((data) => {
    const isBool = (v) => typeof v === "boolean";
    assert.equal(readStore("orion.map.grid", false, isBool), false);
    writeStore("orion.map.grid", true);
    assert.equal(data.get("orion.map.grid"), "true");
    assert.equal(readStore("orion.map.grid", false, isBool), true);
    // Another type, or broken JSON: the default.
    data.set("orion.map.grid", '"yes"');
    assert.equal(readStore("orion.map.grid", false, isBool), false);
    data.set("orion.map.grid", "{broken");
    assert.equal(readStore("orion.map.grid", false, isBool), false);
    const view = { lat: 46.2, lng: 6.14, zoom: 15 };
    writeStore("orion.map.view.j", view);
    assert.deepEqual(readStore("orion.map.view.j", null, isView), view);
  });
  // No storage at all (private mode): defaults, no exception.
  withStorage(() => {
    Object.defineProperty(globalThis, "localStorage", {
      get() {
        throw new Error("denied");
      },
      configurable: true,
    });
    assert.equal(
      readStore("x", 7, () => true),
      7,
    );
    assert.doesNotThrow(() => writeStore("x", 1));
  });
  assert.equal(isView({ lat: 1, lng: 2, zoom: 3 }), true);
  assert.equal(isView({ lat: 1, lng: 2 }), false);
  assert.equal(isView({ lat: 1, lng: Infinity, zoom: 3 }), false);
  assert.equal(isView(null), false);
  assert.equal(isRecord({}), true);
  assert.equal(isRecord([]), false);
  assert.equal(isRecord(null), false);
});

test("drawing tools: constants, plume, offline box, repeated clicks", () => {
  assert.deepEqual(DRAWING, [
    "line",
    "area",
    "circle",
    "sector",
    "measure",
    "box",
  ]);
  assert.equal(round6(6.123456789), 6.123457);
  assert.equal(isPlume({ bearing: 45, angle: 45, length: 1000 }), true);
  assert.equal(isPlume({ bearing: 45, angle: 45 }), false);
  assert.equal(isPlume([45, 45, 1000]), false);
  // Two opposite corners, in any order: south-west then north-east.
  assert.deepEqual(boxOf([46.3, 6.1], [46.2, 6.2]), [
    [46.2, 6.1],
    [46.3, 6.2],
  ]);
  // A double click adds the same vertex twice: dropped (5 px here).
  const px = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  assert.deepEqual(
    dropRepeats(
      [
        [0, 0],
        [0, 3],
        [0, 20],
        [0, 20],
      ],
      px,
    ),
    [
      [0, 0],
      [0, 20],
    ],
  );
  assert.deepEqual(dropRepeats([], px), []);
});

test("sketch while drawing: line, zone, measure and nothing to show", () => {
  const plume = { bearing: 45, angle: 45, length: 1000 };
  const a = [46.2, 6.14];
  const b = [46.201, 6.14];
  const cursor = [46.201, 6.141];
  // No tool drawing, or no point yet: everything cleared.
  for (const [tool, pts] of [
    ["select", [a]],
    ["point", [a]],
    ["line", []],
  ])
    assert.deepEqual(sketchOf(tool, pts, cursor, false, plume), {
      line: [],
      poly: [],
      rubber: [],
      text: "",
    });
  // A line: its points, a rubber band to the cursor, the length so far.
  const line = sketchOf("line", [a, b], cursor, false, plume);
  assert.deepEqual(line.line, [a, b]);
  assert.deepEqual(line.poly, []);
  assert.deepEqual(line.rubber, [b, cursor]);
  assert.match(line.text, /m$/);
  assert.doesNotMatch(line.text, /surface/);
  // A zone: the polygon follows the cursor, the band closes it.
  const zone = sketchOf("area", [a, b], cursor, false, plume);
  assert.deepEqual(zone.line, []);
  assert.deepEqual(zone.poly, [a, b, cursor]);
  assert.deepEqual(zone.rubber, [b, cursor, a]);
  assert.match(zone.text, /^périmètre .* · surface /);
  // A measure done: no cursor any more, the surface of three points.
  const done = sketchOf("measure", [a, b, cursor], cursor, true, plume);
  assert.deepEqual(done.poly, [a, b, cursor]);
  assert.deepEqual(done.rubber, []);
  assert.match(done.text, / · surface /);
});

test("sketch of a perimeter, a plume and an offline sector", () => {
  const plume = { bearing: 90, angle: 60, length: 500 };
  const center = [46.2, 6.14];
  const edge = [46.2009, 6.14];
  const circle = sketchOf("circle", [center], edge, false, plume);
  const r = lengthOf([center, edge]);
  assert.deepEqual(circle.poly, circlePoints(center, r));
  assert.deepEqual(circle.rubber, [center, edge]);
  assert.match(circle.text, /^rayon .* · surface /);
  // Centre only, cursor off the map: nothing drawn yet.
  assert.deepEqual(sketchOf("circle", [center], null, false, plume), {
    line: [],
    poly: [],
    rubber: [],
    text: "",
  });
  // Plume without cursor: the direction and length typed.
  const typed = sketchOf("sector", [center], null, false, plume);
  assert.equal(typed.rubber.length, 0);
  assert.ok(typed.poly.length > 3);
  assert.match(typed.text, /90° · 500 m$/);
  // With the cursor: towards it, at least 10 m.
  const pointed = sketchOf("sector", [center], edge, false, plume);
  assert.deepEqual(pointed.rubber, [center, edge]);
  assert.match(pointed.text, /^vers N 0° · /);
  // Offline sector: a rectangle to the cursor; without it the readout
  // stays as it is (undefined).
  const box = sketchOf("box", [center], [46.21, 6.16], false, plume);
  assert.deepEqual(box.poly, [
    [46.2, 6.14],
    [46.2, 6.16],
    [46.21, 6.16],
    [46.21, 6.14],
  ]);
  assert.match(box.text, / × /);
  const still = sketchOf("box", [center], null, false, plume);
  assert.deepEqual(still.poly, []);
  assert.equal(still.text, undefined);
});

test("map objects: default layers and symbols of what is placed", () => {
  const layers = standardLayers(newJournal("Crue").ops);
  assert.deepEqual(layers, {
    effects: "Effets",
    dangers: "Dangers",
    means: "Moyens",
    other: "Autre",
  });
  assert.equal(layerForKind("resource", layers), "Moyens");
  assert.equal(layerForKind("message", layers), "Effets");
  assert.equal(layerForKind("entry", layers), "Effets");
  assert.equal(layerForKind("contact", layers), "Autre");
  assert.equal(symbolForKind("resource"), "b:vehicule");
  assert.equal(symbolForKind("entry"), "b:incident");
  assert.equal(symbolForKind(""), "b:point");
});

test("positions cited by entries and messages, unless already placed", () => {
  let journal = addEntry(
    newJournal("Crue"),
    { ...emptyFields(), message: "Digue", coordinates: "46.2, 6.14" },
    "Alpha",
  );
  journal = addEntry(
    journal,
    { ...emptyFields(), message: "Pont", coordinates: "46.19, 6.15" },
    "Alpha",
  );
  journal = addEntry(journal, { ...emptyFields(), message: "Rien" }, "Alpha");
  const [e1, e2, e3] = journal.entries;
  const messages = [
    { id: "m1", coordinates: "2 500 000 / 1 117 000" },
    { id: "m2", coordinates: "pas de coordonnées" },
  ];
  const byRef = new Map([
    [`entry:${e1.id}`, { title: "#001 Digue" }],
    [`entry:${e2.id}`, { title: "#002 Pont" }],
    [`entry:${e3.id}`, { title: "#003 Rien" }],
    ["message:m1", { title: "Crue" }],
    ["message:m2", { title: "Autre" }],
  ]);
  // The second entry is linked to a map object: not a ghost.
  const edges = [{ a: "place:p1", b: `entry:${e2.id}` }];
  const ghosts = citedPositions({ edges, byRef }, journal.entries, messages);
  assert.deepEqual(
    ghosts.map((g) => [g.target, g.title]),
    [
      [`entry:${e1.id}`, "#001 Digue"],
      ["message:m1", "Crue"],
    ],
  );
  assert.deepEqual([ghosts[0].lat, ghosts[0].lng], [46.2, 6.14]);
  assert.ok(Math.abs(ghosts[1].lat - 46.2) < 0.1);
  // An item unknown to the graph is left out.
  assert.deepEqual(
    citedPositions({ edges: [], byRef: new Map() }, journal.entries, messages),
    [],
  );
});

test("keyboard moves, wind of the latest forecast, file names", () => {
  // 10 m north, 10 m east (metres on the ground at this latitude).
  const [lat, lng] = shiftBy(10, 10)([46.2, 6.14]);
  assert.ok(
    Math.abs(
      lengthOf([
        [46.2, 6.14],
        [lat, 6.14],
      ]) - 10,
    ) < 0.2,
  );
  assert.ok(
    Math.abs(
      lengthOf([
        [46.2, 6.14],
        [46.2, lng],
      ]) - 10,
    ) < 0.2,
  );
  assert.deepEqual(shiftBy(0, 0)([46.2, 6.14]), [46.2, 6.14]);

  const forecast = (fetchedAt, direction, place) => ({
    fetchedAt,
    place,
    data: { current: { direction, wind: 12 } },
  });
  assert.equal(latestWind([]), null);
  assert.deepEqual(
    latestWind([
      forecast("2026-05-10T08:00:00Z", 270, "Carouge"),
      forecast("2026-05-10T09:00:00Z", 350, "Genève"),
    ]),
    {
      towards: 170,
      from: 350,
      speed: 12,
      place: "Genève",
      at: "2026-05-10T09:00:00Z",
    },
  );
  // The latest forecast has no direction: no wind.
  assert.equal(
    latestWind([
      forecast("2026-05-10T08:00:00Z", 270, "Carouge"),
      forecast("2026-05-10T09:00:00Z", null, "Genève"),
    ]),
    null,
  );

  assert.equal(
    fileSlug("Crue de l’Arve — Secteur Acacias"),
    "crue-de-l-arve-secteur-acacias",
  );
  assert.equal(fileSlug("  Évacuation  "), "evacuation");
  assert.equal(fileSlug("—"), "");
});

test("the list of objects stays the same while nothing changed", () => {
  const place = (id, updatedAt, kind = "point") => ({ id, updatedAt, kind });
  const a = place("a", "1");
  const b = place("b", "1");
  let memo = keepStable({ list: [], byId: new Map() }, [a, b]);
  const first = memo.list;
  assert.deepEqual(first, [a, b]);
  // Re-validated records (new objects, same content): the same list.
  memo = keepStable(memo, [place("a", "1"), place("b", "1")]);
  assert.equal(memo.list, first);
  assert.equal(memo.list[0], a);
  // One changed: a new list keeping the unchanged object.
  const b2 = place("b", "2");
  memo = keepStable(memo, [place("a", "1"), b2]);
  assert.notEqual(memo.list, first);
  assert.equal(memo.list[0], a);
  assert.equal(memo.list[1], b2);
  // Another kind is another object; one removed: a new list.
  const a3 = place("a", "1", "text");
  memo = keepStable(memo, [a3, b2]);
  assert.equal(memo.list[0], a3);
  const before = memo.list;
  memo = keepStable(memo, [b2]);
  assert.notEqual(memo.list, before);
  assert.deepEqual(memo.list, [b2]);
});
