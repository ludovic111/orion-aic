import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CORE,
  ESSENTIAL,
  PHONE_SLOTS,
  defaultDock,
  dockLayout,
  migrateDock,
  phoneBar,
  place,
  placementOf,
} from "../src/app/dock.ts";
import { MODULE_IDS } from "../src/app/modules.ts";

const auto = { hidden: [], dock: null };

test("a new post sees the essential modules in the dock, the others under « Plus d’outils »", () => {
  const { bar, more } = dockLayout(auto);
  assert.deepEqual(bar, [
    "situation",
    "journal",
    "messages",
    "tasks",
    "map",
    "resources",
    "team",
  ]);
  assert.deepEqual(more, [
    "missions",
    "orders",
    "checklists",
    "radio",
    "contacts",
    "weather",
    "agenda",
    "network",
    "trace",
    "debrief",
  ]);
  // Aide is at the foot of the dock, never in either list.
  assert.ok(!bar.includes("docs") && !more.includes("docs"));
  // Every module is reachable: in the dock, behind « Plus d’outils » or Aide.
  assert.deepEqual([...bar, ...more, "docs"].sort(), [...MODULE_IDS].sort());
});

test("the function of the post adds the modules it works in most", () => {
  // Télématique (src/post/roles.ts): radio, messages, team, network.
  const telematics = dockLayout(auto, ["radio", "messages", "team", "network"]);
  assert.ok(telematics.bar.includes("radio"));
  assert.ok(telematics.bar.includes("network"));
  assert.ok(!telematics.more.includes("radio"));
  // Kept in the order of the modules, without duplicates.
  assert.deepEqual(
    telematics.bar,
    MODULE_IDS.filter((m) => telematics.bar.includes(m)),
  );
  assert.deepEqual(defaultDock(["radio", "radio", "nope"]), [
    ...ESSENTIAL,
    "radio",
  ]);
});

test("every function of src/post/roles.ts gives a short dock of known modules", () => {
  const source = readFileSync(
    new URL("../src/post/roles.ts", import.meta.url),
    "utf8",
  );
  const profiles = [...source.matchAll(/focus: \[([^\]]*)\]/g)].map((m) =>
    [...m[1].matchAll(/"(\w+)"/g)].map((x) => x[1]),
  );
  assert.ok(profiles.length >= 7, "the seven standard functions");
  for (const focus of profiles) {
    for (const id of focus) assert.ok(MODULE_IDS.includes(id), id);
    const { bar, more } = dockLayout(auto, focus);
    for (const id of [...ESSENTIAL, ...focus]) assert.ok(bar.includes(id));
    // Short enough to read at a glance; the rest stays one tap away.
    assert.ok(bar.length <= 11, bar.join());
    assert.ok(more.length > 0);
  }
});

test("hidden modules leave the navigation; Situation, Journal and Aide stay", () => {
  const layout = dockLayout({
    hidden: ["radio", "map", "situation", "journal"],
    dock: null,
  });
  assert.ok(!layout.bar.includes("map"));
  assert.ok(!layout.more.includes("radio") && !layout.more.includes("map"));
  assert.ok(layout.bar.includes("situation") && layout.bar.includes("journal"));
});

test("moving a module turns the automatic dock into the post's own choice", () => {
  const withWeather = place(auto, "weather", "bar");
  assert.deepEqual(withWeather.dock, [...ESSENTIAL, "weather"]);
  assert.equal(placementOf(withWeather, "weather"), "bar");
  const withoutMap = place(withWeather, "map", "more");
  assert.equal(placementOf(withoutMap, "map"), "more");
  assert.ok(dockLayout(withoutMap).more.includes("map"));
  const hidden = place(withoutMap, "contacts", "hidden");
  assert.deepEqual(hidden.hidden, ["contacts"]);
  assert.equal(placementOf(hidden, "contacts"), "hidden");
  // Shown again: back under « Plus d’outils ».
  const back = place(hidden, "contacts", "more");
  assert.deepEqual(back.hidden, []);
  assert.equal(placementOf(back, "contacts"), "more");
  // The core modules do not move.
  for (const id of CORE) {
    assert.equal(place(auto, id, "hidden"), auto);
    assert.equal(placementOf(auto, id), "bar");
  }
});

test("a phone keeps four modules of the dock in its bottom bar", () => {
  assert.deepEqual(phoneBar(dockLayout(auto).bar), [
    "situation",
    "journal",
    "messages",
    "map",
  ]);
  // A dock without Carte takes the next module in order of preference.
  const noMap = dockLayout(place(auto, "map", "more")).bar;
  assert.deepEqual(phoneBar(noMap), [
    "situation",
    "journal",
    "messages",
    "tasks",
  ]);
  assert.equal(phoneBar(["situation", "journal"]).length, 2);
  assert.ok(phoneBar(dockLayout(auto).bar).length <= PHONE_SLOTS);
});

test("preferences stored before the two-level dock are migrated tolerantly", () => {
  // Never changed: the new automatic dock.
  assert.deepEqual(migrateDock({ hidden: [] }), { hidden: [], dock: null });
  assert.deepEqual(migrateDock({}), { hidden: [], dock: null });
  // Modules hidden by hand: every module kept stays in the dock, as before.
  const curated = migrateDock({ hidden: ["radio", "network", "gone"] });
  assert.deepEqual(curated.hidden, ["radio", "network"]);
  assert.deepEqual(
    curated.dock,
    MODULE_IDS.filter((m) => !["radio", "network", "docs"].includes(m)),
  );
  const { bar, more } = dockLayout(curated);
  assert.equal(more.length, 0);
  assert.ok(bar.includes("weather") && !bar.includes("radio"));
  // Core modules can never be hidden, even by an old or edited value.
  assert.deepEqual(migrateDock({ hidden: ["journal", "docs"] }), {
    hidden: [],
    dock: null,
  });
  // Already migrated: kept as is (unknown ids dropped); malformed: automatic.
  assert.deepEqual(migrateDock({ hidden: [], dock: ["map", "x", "map"] }), {
    hidden: [],
    dock: ["map"],
  });
  assert.deepEqual(migrateDock({ hidden: "radio", dock: "all" }), {
    hidden: [],
    dock: null,
  });
  assert.deepEqual(migrateDock({ dock: null }), { hidden: [], dock: null });
});
