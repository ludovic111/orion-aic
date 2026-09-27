import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import type { Place } from "../../../shared/ops";
import type { LatLng } from "./geo";
import { MAX_HANDLES, round6 } from "./tools";
import type { MapCore } from "./useLeafletMap";
import { t } from "./i18n.ts";

// Reshaping a line or an area: a handle per vertex (drag, arrows, click to
// remove) and a « + » in the middle of each segment to add one.

export type ShapeEdit = { id: string; points: LatLng[] };

export function useShapeEditor(
  core: MapCore,
  {
    shapeEdit,
    setShapeEdit,
    byId,
    toast,
    sheetId,
    cull,
    publishSlots,
  }: {
    shapeEdit: ShapeEdit | null;
    setShapeEdit: (update: (s: ShapeEdit | null) => ShapeEdit | null) => void;
    byId: Map<string, Place>;
    toast: (text: string) => void;
    sheetId: string | null;
    cull: () => boolean;
    publishSlots: () => void;
  },
) {
  const { map, groups } = core;
  const editKind = shapeEdit ? byId.get(shapeEdit.id)?.kind : undefined;
  // Handles of a long line follow the view.
  const [editView, setEditView] = useState(0);
  const refocus = useRef<number | null>(null);
  const longEdit = useRef(false);
  longEdit.current = !!shapeEdit && shapeEdit.points.length > MAX_HANDLES;
  useEffect(() => {
    if (cull()) publishSlots();
  }, [sheetId]);
  useEffect(() => {
    const g = groups.current;
    if (!g) return;
    g.edit.clearLayers();
    if (!shapeEdit) return;
    if (!editKind) return;
    const pts = shapeEdit.points.map((p) => [...p] as LatLng);
    const area = editKind === "area";
    const shape = (area ? L.polygon(pts) : L.polyline(pts)).setStyle({
      className: `map-sketch editing${area ? " area" : ""}`,
      weight: 3,
      interactive: false,
    });
    shape.addTo(g.edit);
    const min = area ? 3 : 2;
    const handle = (cls: string, size: number) =>
      L.divIcon({
        className: `map-vertex ${cls}`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      });
    // A long line (2000 points) would need 4000 handles: only the
    // vertices in view, nearest to the centre first, are editable at once.
    const m = map.current;
    let editable = pts.map((_, i) => i);
    if (m && pts.length > MAX_HANDLES) {
      const view = m.getBounds();
      const c = m.getCenter();
      editable = editable
        .filter((i) => view.contains(pts[i]))
        .sort((a, b) => c.distanceTo(pts[a]) - c.distanceTo(pts[b]))
        .slice(0, MAX_HANDLES)
        .sort((a, b) => a - b);
    }
    const shown = new Set(editable);
    const nudge = (v: L.Marker, e: KeyboardEvent) => {
      const step = e.shiftKey ? 20 : 4;
      const d =
        e.key === "ArrowUp"
          ? [0, -step]
          : e.key === "ArrowDown"
            ? [0, step]
            : e.key === "ArrowLeft"
              ? [-step, 0]
              : e.key === "ArrowRight"
                ? [step, 0]
                : null;
      if (!d || !m) return false;
      e.preventDefault();
      e.stopPropagation();
      const p = m.latLngToContainerPoint(v.getLatLng()).add(d as L.PointTuple);
      v.setLatLng(m.containerPointToLatLng(p));
      v.fire("drag");
      v.fire("dragend");
      return true;
    };
    for (const i of editable) {
      const v = L.marker(pts[i], {
        icon: handle("", 16),
        draggable: true,
        keyboard: true,
      }).addTo(g.edit);
      v.on("add", () => {
        const el = v.getElement();
        el?.setAttribute(
          "aria-label",
          t(
            "Sommet {i} sur {n} : glisser ou flèches pour déplacer, Entrée pour retirer",
            { i: i + 1, n: pts.length },
          ),
        );
        el?.addEventListener("keydown", (e) => {
          if (nudge(v, e)) refocus.current = i;
        });
        // Rebuilt after a keyboard move: the focus stays on the vertex.
        if (refocus.current === i) {
          refocus.current = null;
          el?.focus();
        }
      });
      v.on("drag", () => {
        const at = v.getLatLng();
        pts[i] = [round6(at.lat), round6(at.lng)];
        shape.setLatLngs(pts);
      });
      v.on("dragend", () =>
        setShapeEdit((s) => (s ? { ...s, points: [...pts] } : s)),
      );
      v.on("click", () => {
        if (pts.length <= min)
          return toast(t("Au moins {n} sommets.", { n: min }));
        setShapeEdit((s) =>
          s ? { ...s, points: pts.filter((_, j) => j !== i) } : s,
        );
      });
    }
    const segments = area ? pts.length : pts.length - 1;
    for (let i = 0; i < segments; i++) {
      const j = (i + 1) % pts.length;
      if (!shown.has(i) || !shown.has(j)) continue;
      const a = pts[i];
      const b = pts[j];
      const mid: LatLng = [
        round6((a[0] + b[0]) / 2),
        round6((a[1] + b[1]) / 2),
      ];
      const add = L.marker(mid, {
        icon: handle("mid", 12),
        keyboard: true,
      }).addTo(g.edit);
      add.on("add", () =>
        add
          .getElement()
          ?.setAttribute(
            "aria-label",
            t("Ajouter un sommet après le sommet {i}", { i: i + 1 }),
          ),
      );
      add.on("click", () =>
        setShapeEdit((s) =>
          s && s.points.length < 2000
            ? {
                ...s,
                points: [...pts.slice(0, i + 1), mid, ...pts.slice(i + 1)],
              }
            : s,
        ),
      );
    }
  }, [shapeEdit, editKind, toast, editView]);
  /** After a move: the handles of a long line follow the view. */
  return () => {
    if (longEdit.current) setEditView((v) => v + 1);
  };
}
