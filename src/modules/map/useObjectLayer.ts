import { useEffect, useRef, useState, type RefObject } from "react";
import L from "leaflet";
import type { Place } from "../../../shared/ops";
import { KIND_INFO, parseRef } from "../../../shared/links";
import { TONE_COLOR, hexColor } from "./maps";
import { toneOf } from "./panels";
import { coarse, reducedMotion } from "./browser";
import { DRAG_THRESHOLD } from "./tools";
import type { Ghost } from "./places";
import type { MapCore } from "./useLeafletMap";
import { t } from "./i18n.ts";

// The objects of the map in Leaflet: lines and areas on a canvas, symbols
// and texts as markers whose content React renders through portals (the
// slots), and the positions cited in the journal (ghosts).

/** A marker element to render the content of an object into. */
export type Slot = { id: string; el: HTMLElement };

/** Colour of each layer family in the current theme (CSS variables). */
function toneColors(el: Element | null): Record<string, string> {
  const style = el ? getComputedStyle(el) : null;
  const out: Record<string, string> = {};
  for (const tone of Object.keys(TONE_COLOR))
    out[tone] =
      style?.getPropertyValue(`--map-${tone}`).trim() ||
      TONE_COLOR[tone as keyof typeof TONE_COLOR];
  return out;
}

export function useObjectLayer(
  core: MapCore,
  shell: RefObject<HTMLDivElement | null>,
  {
    visible,
    themeKey,
    canDrag,
    sheetId,
    highlight,
    hot,
    byId,
    ghosts,
    showGhosts,
  }: {
    /** Objects of the map shown, in the layers shown. */
    visible: Place[];
    themeKey: number;
    canDrag: boolean;
    sheetId: string | null;
    /** Hovered in the list, opened, hovered on the map. */
    highlight: string | null;
    hot: string | null;
    byId: Map<string, Place>;
    ghosts: Ghost[];
    showGhosts: boolean;
  },
) {
  const { map, groups, registry, renderer, state, handlers, dragging } = core;
  const [slots, setSlots] = useState<Slot[]>([]);

  function makeShape(p: Place, tones: Record<string, string>) {
    const tone = toneOf(p.layer);
    const w = p.weight;
    const color = hexColor(p.color) || tones[tone] || TONE_COLOR[tone];
    const options: L.PolylineOptions = {
      renderer: renderer.current ?? undefined,
      className: `map-shape tone-${tone}${p.kind === "area" ? " area" : ""}`,
      weight: w,
      color,
      fillColor: color,
      opacity: 0.95,
      fillOpacity: 0.16,
      lineCap: "round",
      lineJoin: "round",
      dashArray:
        p.dash === "dash"
          ? `${w * 3} ${w * 2.2}`
          : p.dash === "dot"
            ? `0.1 ${w * 2}`
            : undefined,
    };
    const shape =
      p.kind === "area"
        ? L.polygon(
            p.holes?.length ? [p.points, ...p.holes] : p.points,
            options,
          )
        : L.polyline(p.points, options);
    if (p.label) {
      const tip = document.createElement("span");
      tip.textContent = p.label;
      shape.bindTooltip(tip, {
        permanent: true,
        direction: "center",
        className: "map-shape-label",
        interactive: false,
      });
    }
    shape.on("click", (e: L.LeafletMouseEvent) => {
      if (state.current.tool !== "select") return;
      L.DomEvent.stopPropagation(e);
      handlers.current.placeClick(p.id, e.latlng);
    });
    shape.on("mouseover", (e: L.LeafletMouseEvent) =>
      handlers.current.placeOver(p.id, e.originalEvent),
    );
    shape.on("mouseout", () => handlers.current.placeOut());
    return shape;
  }

  function makeMarker(p: Place) {
    const el = document.createElement("div");
    el.className = "map-pin-host";
    const text = p.kind === "text";
    // Zero-sized anchor: the content is centred on the point by CSS, so a
    // new size or rotation never rebuilds the marker.
    const marker = L.marker(p.points[0], {
      icon: L.divIcon({
        html: el,
        className: text ? "map-icon text" : "map-icon",
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      }),
      draggable: state.current.canDrag,
      keyboard: true,
      riseOnHover: true,
      autoPan: true,
    });
    marker.on("add", () => {
      const icon = marker.getElement();
      icon?.setAttribute("role", "button");
      icon?.setAttribute(
        "aria-label",
        state.current.byId.get(p.id)?.label || t("Objet de la carte"),
      );
    });
    marker.on("click", (e: L.LeafletMouseEvent) =>
      handlers.current.placeClick(p.id, e.latlng),
    );
    marker.on("mouseover", (e: L.LeafletMouseEvent) =>
      handlers.current.placeOver(p.id, e.originalEvent),
    );
    marker.on("mouseout", () => handlers.current.placeOut());
    // A drag moves the object only when it is deliberate: a shaky click,
    // a second finger (pinch to zoom) or a zoom during the drag puts the
    // object back exactly where it was.
    let origin: L.LatLng | null = null;
    let cancelled = false;
    const cancel = () => {
      cancelled = true;
    };
    const touch = (e: TouchEvent) => {
      if (e.touches.length > 1) cancel();
    };
    marker.on("dragstart", () => {
      handlers.current.placeOut();
      origin = marker.getLatLng();
      cancelled = false;
      // Positions arriving from other posts wait until the drop.
      dragging.current.add(p.id);
      document.addEventListener("touchstart", touch, true);
      map.current?.on("zoomstart", cancel);
    });
    marker.on("dragend", () => {
      document.removeEventListener("touchstart", touch, true);
      map.current?.off("zoomstart", cancel);
      const from = origin;
      origin = null;
      // Leaflet may still apply the last pointer position in the next
      // animation frame: decide once it has.
      requestAnimationFrame(() => {
        dragging.current.delete(p.id);
        const m = map.current;
        if (!m || !from) return;
        const to = marker.getLatLng();
        const moved = m
          .latLngToContainerPoint(to)
          .distanceTo(m.latLngToContainerPoint(from));
        if (cancelled || moved < DRAG_THRESHOLD) {
          // Back to the latest known position (maybe moved meanwhile by
          // another post), not to where the drag started.
          const latest = state.current.byId.get(p.id)?.points[0];
          marker.setLatLng(latest ?? from);
        } else handlers.current.placeMoved(p.id, to);
      });
    });
    return { marker, el };
  }

  const moving = useRef(
    new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>(),
  ).current;
  const selected = useRef(sheetId);
  selected.current = sheetId;
  /**
   * Symbols far outside the view are taken off the map (hundreds of
   * symbols on the whole canton would otherwise weigh on every pan).
   */
  function cull(): boolean {
    const m = map.current;
    const g = groups.current;
    if (!m || !g) return false;
    const view = m.getBounds().pad(0.6);
    let changed = false;
    for (const [id, e] of registry.current) {
      if (!e.el) continue;
      const marker = e.layer as L.Marker;
      const inside =
        view.contains(marker.getLatLng()) ||
        id === selected.current ||
        dragging.current.has(id);
      if (inside && !e.shown) {
        marker.addTo(g.objects);
        e.shown = true;
        changed = true;
      } else if (!inside && e.shown) {
        marker.remove();
        e.shown = false;
        changed = true;
      }
    }
    return changed;
  }
  const publishSlots = () =>
    setSlots(
      [...registry.current]
        .filter(([, e]) => e.el && e.shown)
        .map(([id, e]) => ({ id, el: e.el! })),
    );
  useEffect(() => {
    const g = groups.current;
    if (!g) return;
    const reg = registry.current;
    const seen = new Set<string>();
    const theme = String(themeKey);
    // Layer colours of the theme shown (read here: the shell exists).
    const tones = toneColors(shell.current);
    let changed = false;
    for (const p of visible) {
      seen.add(p.id);
      const known = reg.get(p.id);
      if (
        known &&
        known.updatedAt === p.updatedAt &&
        known.kind === p.kind &&
        (known.el || known.theme === theme)
      )
        continue;
      // Being dragged here: a position from another post waits for the drop.
      if (known && dragging.current.has(p.id)) continue;
      if (known && known.kind === p.kind && known.el) {
        const marker = known.layer as L.Marker;
        const was = marker.getLatLng();
        const [lat, lng] = p.points[0];
        const icon = marker.getElement();
        // Moved by another post or by the replay: glide to the new place.
        // A move made here (drag) is already in place: no glide, or the
        // symbol would lag behind the map during the next zoom.
        const m = map.current;
        const far =
          !!m &&
          m
            .latLngToContainerPoint(was)
            .distanceTo(m.latLngToContainerPoint([lat, lng])) > 2;
        if (
          icon &&
          far &&
          !icon.classList.contains("leaflet-drag-target") &&
          !reducedMotion()
        ) {
          icon.classList.add("map-moving");
          clearTimeout(moving.get(icon));
          moving.set(
            icon,
            setTimeout(() => icon.classList.remove("map-moving"), 700),
          );
        }
        marker.setLatLng(p.points[0]);
        marker
          .getElement()
          ?.setAttribute("aria-label", p.label || t("Objet de la carte"));
        known.updatedAt = p.updatedAt;
        continue;
      }
      if (known) {
        known.layer.remove();
        reg.delete(p.id);
        changed ||= !!known.el;
      }
      if (p.kind === "point" || p.kind === "text") {
        const { marker, el } = makeMarker(p);
        reg.set(p.id, {
          layer: marker,
          el,
          updatedAt: p.updatedAt,
          kind: p.kind,
          shown: false,
        });
        changed = true;
      } else {
        const shape = makeShape(p, tones).addTo(g.objects);
        reg.set(p.id, {
          layer: shape,
          updatedAt: p.updatedAt,
          kind: p.kind,
          theme,
        });
      }
    }
    for (const [id, e] of reg)
      if (!seen.has(id)) {
        e.layer.remove();
        reg.delete(id);
        changed ||= !!e.el;
      }
    if (cull()) changed = true;
    if (changed) publishSlots();
  }, [visible, themeKey]);

  // Dragging only with the selection tool, objects unlocked; on a touch
  // screen only the selected object, so that panning or pinching over a
  // symbol never moves it.
  useEffect(() => {
    const touch = coarse();
    for (const [id, e] of registry.current) {
      const dragging = (e.layer as L.Marker).dragging;
      if (!e.el || !dragging) continue;
      if (canDrag && (!touch || id === sheetId)) dragging.enable();
      else dragging.disable();
    }
  }, [canDrag, slots, sheetId]);

  // Hovered or opened object stands out.
  const hotShapes = useRef(new Set<string>());
  useEffect(() => {
    // Canvas shapes: a thicker, opaque stroke instead of a CSS class.
    const next = new Set<string>();
    for (const id of [highlight, sheetId, hot])
      if (id && registry.current.get(id) && !registry.current.get(id)!.el)
        next.add(id);
    for (const id of new Set([...hotShapes.current, ...next])) {
      const e = registry.current.get(id);
      const p = byId.get(id);
      if (!e || e.el || !p) continue;
      const on = next.has(id);
      (e.layer as L.Polyline).setStyle({
        weight: on ? p.weight + 2.5 : p.weight,
        opacity: on ? 1 : 0.95,
        fillOpacity: on ? 0.26 : 0.16,
      });
      if (on) (e.layer as L.Polyline).bringToFront();
    }
    hotShapes.current = next;
  }, [highlight, sheetId, hot, visible, byId]);

  /* ---------- Ghosts ---------- */
  useEffect(() => {
    const g = groups.current;
    if (!g) return;
    g.ghosts.clearLayers();
    if (!showGhosts) return;
    for (const ghost of ghosts) {
      const hue = KIND_INFO[parseRef(ghost.target).kind].hue;
      const marker = L.marker([ghost.lat, ghost.lng], {
        icon: L.divIcon({
          html: `<div class="map-ghost" style="--h:${hue}"><i></i></div>`,
          className: "map-icon",
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        }),
        keyboard: true,
      });
      marker.on("add", () => {
        marker
          .getElement()
          ?.setAttribute(
            "aria-label",
            t("Position citée : {title}", { title: ghost.title }),
          );
      });
      marker.on("mouseover", (e: L.LeafletMouseEvent) =>
        handlers.current.ghostOver(ghost, e.originalEvent),
      );
      marker.on("mouseout", () => handlers.current.placeOut());
      marker.on("click", (e: L.LeafletMouseEvent) =>
        handlers.current.ghostClick(ghost, e.originalEvent),
      );
      marker.addTo(g.ghosts);
    }
  }, [ghosts, showGhosts]);

  return { slots, cull, publishSlots };
}
