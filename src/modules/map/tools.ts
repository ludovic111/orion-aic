// Drawing tools of the situation map: their ids, their constants and the
// geometry shown while drawing or measuring. Pure: tested in node (the
// tool bar with its icons is MapToolbar.tsx).

import {
  areaOf,
  bearingOf,
  circlePoints,
  compass,
  formatArea,
  formatDistance,
  lengthOf,
  sectorPoints,
  type LatLng,
} from "./geo.ts";
import { isRecord } from "./browser.ts";
import type { Bounds } from "./tilecache.ts";
import { t } from "./i18n.ts";

export type Tool =
  | "select"
  | "point"
  | "line"
  | "area"
  | "circle"
  | "sector"
  | "freehand"
  | "text"
  | "measure"
  // Frame of an offline sector (two corners); not in the tool bar.
  | "box";
export type Plume = { bearing: number; angle: number; length: number };

export const DRAWING: Tool[] = [
  "line",
  "area",
  "circle",
  "sector",
  "measure",
  "box",
];
/** Radii offered once the centre of a perimeter is placed, in metres. */
export const RADII = [50, 100, 200, 300, 500, 1000];
export const PLUME_ANGLES = [30, 45, 60, 90];
/** Vertex handles shown at once when editing a long line. */
export const MAX_HANDLES = 120;
/**
 * Below this distance (screen pixels) a drag is a shaky click, not a move:
 * the object stays exactly where it was.
 */
export const DRAG_THRESHOLD = 8;

export const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export const isPlume = (v: unknown): v is Plume =>
  isRecord(v) &&
  Number.isFinite((v as Plume).bearing) &&
  Number.isFinite((v as Plume).angle) &&
  Number.isFinite((v as Plume).length);

/** The sketch layers: line, area, rubber band, and the live readout. */
export type Sketch = {
  line: LatLng[];
  poly: LatLng[];
  rubber: LatLng[];
  /** Live measurement; undefined: the readout stays as it is. */
  text?: string;
};

/**
 * What the sketch shows while drawing or measuring: the points placed so
 * far, the cursor (null: off the map) and whether the measure is done.
 */
export function sketchOf(
  tool: Tool,
  pts: LatLng[],
  cursor: LatLng | null,
  done: boolean,
  plume: Plume,
): Sketch {
  const drawing = DRAWING.includes(tool);
  const live = drawing && !done && cursor ? [...pts, cursor] : pts;
  if (!drawing || !pts.length)
    return { line: [], poly: [], rubber: [], text: "" };
  if (tool === "circle") {
    const center = pts[0];
    const r = cursor && !done ? lengthOf([center, live[live.length - 1]]) : 0;
    return {
      line: [],
      poly: r ? circlePoints(center, r) : [],
      rubber: r ? [center, live[live.length - 1]] : [],
      text: r
        ? t("rayon {r} · surface {a}", {
            r: formatDistance(r),
            a: formatArea(Math.PI * r * r),
          })
        : "",
    };
  }
  if (tool === "sector") {
    // The cursor sets direction and length; without it, the values typed.
    const apex = pts[0];
    const end = cursor && !done ? live[live.length - 1] : null;
    const bearing = end ? bearingOf(apex, end) : plume.bearing;
    const length = end ? Math.max(10, lengthOf([apex, end])) : plume.length;
    return {
      line: [],
      poly: sectorPoints(apex, bearing, plume.angle, length),
      rubber: end ? [apex, end] : [],
      text: t("vers {dir} {deg}° · {len}", {
        dir: compass(bearing),
        deg: Math.round(bearing),
        len: formatDistance(length),
      }),
    };
  }
  if (tool === "box") {
    const a = pts[0];
    const b = cursor ? live[live.length - 1] : null;
    return {
      line: [],
      rubber: [],
      poly: b
        ? [
            [a[0], a[1]],
            [a[0], b[1]],
            [b[0], b[1]],
            [b[0], a[1]],
          ]
        : [],
      text: b
        ? `${formatDistance(lengthOf([a, [a[0], b[1]]]))} × ${formatDistance(lengthOf([a, [b[0], a[1]]]))}`
        : undefined,
    };
  }
  const last = pts[pts.length - 1];
  const parts: string[] = [];
  if (tool !== "area" || live.length < 3)
    parts.push(formatDistance(lengthOf(live)));
  else
    parts.push(
      t("périmètre {d}", {
        d: formatDistance(lengthOf([...live, live[0]])),
      }),
    );
  if (live.length >= 3 && tool !== "line")
    parts.push(t("surface {a}", { a: formatArea(areaOf(live)) }));
  return {
    line: tool === "area" ? [] : pts,
    poly:
      tool === "area"
        ? live
        : tool === "measure" && live.length >= 3
          ? live
          : [],
    rubber:
      cursor && !done
        ? tool === "area" && pts.length > 1
          ? [last, cursor, pts[0]]
          : [last, cursor]
        : [],
    text: parts.join(" · "),
  };
}

/**
 * A double click adds the same vertex twice: a point within `min` (screen
 * pixels, measured by `distance`) of the previous one is dropped.
 */
export const dropRepeats = (
  raw: LatLng[],
  distance: (a: LatLng, b: LatLng) => number,
  min = 5,
) => raw.filter((p, i) => !i || distance(raw[i - 1], p) > min);

/** Frame of an offline sector from two opposite corners. */
export const boxOf = (a: LatLng, b: LatLng): Bounds => [
  [Math.min(a[0], b[0]), Math.min(a[1], b[1])],
  [Math.max(a[0], b[0]), Math.max(a[1], b[1])],
];
