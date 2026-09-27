// Map objects (places) as the situation map sees them: default layers and
// symbols, positions cited elsewhere in the journal, keyboard moves, the
// wind of the latest forecast. Pure: tested in node.

import { current, type Entry } from "../../../shared/journal.ts";
import {
  defaultListValues,
  journalLang,
  listValues,
  type ForecastRecord,
  type Message,
  type Ops,
  type Place,
} from "../../../shared/ops.ts";
import { ref, type Ref } from "../../../shared/links.ts";
import type { Graph } from "../../app/context";
import { parseCoordinates, type LatLng } from "./geo.ts";
import { round6 } from "./tools.ts";

/** An item citing coordinates that no map object stands for yet. */
export type Ghost = { target: Ref; lat: number; lng: number; title: string };

/**
 * Standard layers of the journal (référentiel « layers »), in its language:
 * the first one (Effets) is the default layer of the drawings.
 */
export function standardLayers(ops: Ops) {
  const defaults = defaultListValues("layers", journalLang(ops));
  return {
    effects: listValues(ops, "layers")[0] ?? "Effets",
    dangers: defaults[1] ?? "Dangers",
    means: defaults[2] ?? "Moyens",
    other: defaults[5] ?? "Autre",
  };
}
export type Layers = ReturnType<typeof standardLayers>;
export const layerForKind = (kind: string, layers: Layers) =>
  kind === "resource"
    ? layers.means
    : kind === "message" || kind === "entry"
      ? layers.effects
      : layers.other;
export const symbolForKind = (kind: string) =>
  kind === "resource"
    ? "b:vehicule"
    : kind === "message" || kind === "entry"
      ? "b:incident"
      : "b:point";

/** Items citing coordinates that no map object stands for yet. */
export function citedPositions(
  graph: Pick<Graph, "edges" | "byRef">,
  entries: Entry[],
  messages: Message[],
): Ghost[] {
  const placed = new Set<string>();
  for (const e of graph.edges) {
    if (e.a.startsWith("place:")) placed.add(e.b);
    if (e.b.startsWith("place:")) placed.add(e.a);
  }
  const out: Ghost[] = [];
  const consider = (target: Ref, text: string) => {
    if (!text.trim() || placed.has(target)) return;
    const item = graph.byRef.get(target);
    const at = parseCoordinates(text);
    if (item && at)
      out.push({ target, lat: at[0], lng: at[1], title: item.title });
  };
  for (const e of entries) consider(ref("entry", e.id), current(e).coordinates);
  for (const m of messages) consider(ref("message", m.id), m.coordinates);
  return out;
}

/** A point moved by metres east / north (keyboard move from the list). */
export const shiftBy =
  (east: number, north: number) =>
  ([lat, lng]: LatLng): LatLng => [
    round6(lat + north / 111320),
    round6(lng + east / (111320 * Math.cos((lat * Math.PI) / 180))),
  ];

/** Wind of the latest forecast (weather module), blowing towards. */
export function latestWind(forecasts: ForecastRecord[]) {
  let latest: ForecastRecord | null = null;
  for (const f of forecasts)
    if (!latest || f.fetchedAt > latest.fetchedAt) latest = f;
  const c = latest?.data.current;
  if (!latest || !c || c.direction === null || c.direction === undefined)
    return null;
  return {
    towards: (c.direction + 180) % 360,
    from: c.direction,
    speed: c.wind,
    place: latest.place,
    at: latest.fetchedAt,
  };
}

/** A name for a file: no accents, lowercase words joined by dashes. */
export const fileSlug = (name: string) =>
  name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();

export type StablePlaces = { list: Place[]; byId: Map<string, Place> };
/**
 * Same objects as long as nothing changed: an edit elsewhere in the
 * journal re-validates every record (new objects), which would redraw
 * every symbol on the map. Returns the previous list itself when no object
 * changed.
 */
export function keepStable(
  previous: StablePlaces,
  list: Place[],
): StablePlaces {
  const byId = new Map<string, Place>();
  let same = list.length === previous.list.length;
  const out = list.map((p, i) => {
    const old = previous.byId.get(p.id);
    const keep =
      old && old.updatedAt === p.updatedAt && old.kind === p.kind ? old : p;
    byId.set(p.id, keep);
    if (keep !== previous.list[i]) same = false;
    return keep;
  });
  return { list: same ? previous.list : out, byId };
}
