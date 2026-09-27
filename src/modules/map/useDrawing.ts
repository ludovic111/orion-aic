import { useEffect } from "react";
import L from "leaflet";
import type { LatLng } from "./geo";
import { simplify } from "./maps";
import { DRAWING, round6, sketchOf, type Plume, type Tool } from "./tools";
import type { MapCore } from "./useLeafletMap";

// Drawing on the map: the sketch of a line, zone, perimeter, plume, measure
// or offline sector in progress, and freehand strokes.

/** The sketch in progress, with the cursor (null: off the map). */
export function drawSketch(core: MapCore, cursor: L.LatLng | null) {
  const g = core.groups.current;
  if (!g) return;
  const { tool, draft, measureDone, plume } = core.state.current;
  const s = sketchOf(
    tool,
    draft,
    cursor ? [cursor.lat, cursor.lng] : null,
    measureDone,
    plume,
  );
  g.line.setLatLngs(s.line);
  g.poly.setLatLngs(s.poly);
  g.rubber.setLatLngs(s.rubber);
  if (core.liveEl.current && s.text !== undefined)
    core.liveEl.current.textContent = s.text;
}

/** Vertices placed so far; no zoom on a double click while drawing. */
export function useSketch(
  core: MapCore,
  tool: Tool,
  draft: LatLng[],
  measureDone: boolean,
  plume: Plume,
) {
  useEffect(() => {
    const g = core.groups.current;
    const m = core.map.current;
    if (!g || !m) return;
    g.dots.clearLayers();
    if (DRAWING.includes(tool))
      draft.forEach((p, i) =>
        L.circleMarker(p, {
          radius: i === 0 ? 6 : 4.5,
          className: `map-sketch-dot${i === 0 ? " first" : ""}`,
          interactive: false,
        }).addTo(g.dots),
      );
    drawSketch(core, null);
    if (DRAWING.includes(tool)) m.doubleClickZoom.disable();
    else m.doubleClickZoom.enable();
  }, [draft, tool, measureDone, plume]);
}

/** Freehand drawing: each stroke becomes a line (handlers.freehand). */
export function useFreehand(core: MapCore, tool: Tool) {
  useEffect(() => {
    const m = core.map.current;
    const g = core.groups.current;
    if (!m || !g || tool !== "freehand") return;
    const el = m.getContainer();
    m.dragging.disable();
    m.doubleClickZoom.disable();
    el.classList.add("map-drawing");
    let pointer: number | null = null;
    let pts: L.Point[] = [];
    let stroke: L.Polyline | null = null;
    const reset = () => {
      pointer = null;
      pts = [];
      stroke?.remove();
      stroke = null;
    };
    const down = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      // A second finger: pinch to zoom, not a stroke.
      if (pointer !== null) return reset();
      pointer = e.pointerId;
      pts = [m.mouseEventToContainerPoint(e as unknown as MouseEvent)];
      stroke = L.polyline([m.containerPointToLatLng(pts[0])], {
        className: "map-sketch freehand",
        weight: 3,
        interactive: false,
      }).addTo(g.sketch);
      el.setPointerCapture?.(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointer || !stroke) return;
      const p = m.mouseEventToContainerPoint(e as unknown as MouseEvent);
      if (p.distanceTo(pts[pts.length - 1]) < 2) return;
      pts.push(p);
      stroke.addLatLng(m.containerPointToLatLng(p));
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return;
      const drawn = pts;
      reset();
      if (e.type !== "pointerup" || drawn.length < 2) return;
      let simple = simplify(
        drawn.map((p) => [p.x, p.y] as [number, number]),
        1.4,
      );
      if (simple.length > 2000) simple = simplify(simple, 4).slice(0, 2000);
      const latlngs = simple.map(([x, y]) => {
        const at = m.containerPointToLatLng([x, y]).wrap();
        return [round6(at.lat), round6(at.lng)] as LatLng;
      });
      const length = Math.hypot(
        drawn[drawn.length - 1].x - drawn[0].x,
        drawn[drawn.length - 1].y - drawn[0].y,
      );
      if (latlngs.length < 2 || (latlngs.length === 2 && length < 6)) return;
      core.handlers.current.freehand(latlngs);
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    return () => {
      reset();
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.classList.remove("map-drawing");
      m.dragging.enable();
      m.doubleClickZoom.enable();
    };
  }, [tool]);
}
