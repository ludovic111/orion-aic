import { useEffect, useLayoutEffect, useState, type RefObject } from "react";
import L from "leaflet";
import type { Place } from "../../../shared/ops";
import { formatPosition, type LatLng } from "./geo";
import {
  OverlayManager,
  type ActiveOverlays,
  type LiveStatus,
} from "./overlayLayers";
import { narrow, writeStore, type View } from "./browser";
import { round6, type Plume, type Tool } from "./tools";
import type { Style } from "./PinBody";
import type { Info } from "./MapCards";
import type { Ghost } from "./places";
import { drawSketch } from "./useDrawing";

// The Leaflet map, created once per journal, and what every other part of
// the map module shares with it. Leaflet is driven imperatively: callbacks
// registered once reach the latest state and handlers through refs.

export type Groups = {
  objects: L.LayerGroup;
  ghosts: L.LayerGroup;
  sketch: L.LayerGroup;
  dots: L.LayerGroup;
  edit: L.LayerGroup;
  line: L.Polyline;
  poly: L.Polygon;
  rubber: L.Polyline;
};

export type Entry = {
  layer: L.Marker | L.Polyline | L.Polygon;
  el?: HTMLElement;
  updatedAt: string;
  kind: Place["kind"];
  /** Colours of the theme a shape was drawn with (canvas: no CSS). */
  theme?: string;
  /** Marker currently on the map (markers far outside the view are not). */
  shown?: boolean;
};

/** What the map and its objects do on a click, a hover, a drag… */
export type Handlers = {
  mapClick: (at: L.LatLng) => void;
  finish: () => void;
  freehand: (points: LatLng[]) => void;
  style: (id: string, style: Style) => void;
  placeClick: (id: string, at: L.LatLng) => void;
  placeOver: (id: string, e: MouseEvent) => void;
  placeOut: () => void;
  placeMoved: (id: string, at: L.LatLng) => void;
  ghostOver: (g: Ghost, e: MouseEvent) => void;
  ghostClick: (g: Ghost, e: MouseEvent) => void;
  moved: () => void;
};
export const noHandlers = (): Handlers => ({
  mapClick: () => {},
  finish: () => {},
  freehand: () => {},
  style: () => {},
  placeClick: () => {},
  placeOver: () => {},
  placeOut: () => {},
  placeMoved: () => {},
  ghostOver: () => {},
  ghostClick: () => {},
  moved: () => {},
});

/** Latest state for Leaflet callbacks registered once. */
export type LiveState = {
  tool: Tool;
  draft: LatLng[];
  measureDone: boolean;
  readOnly: boolean;
  canDrag: boolean;
  byId: Map<string, Place>;
  mapId: string;
  crosshair: boolean;
  showGrid: boolean;
  plume: Plume;
};

/** The Leaflet objects and refs shared by the hooks of the map. */
export type MapCore = {
  map: RefObject<L.Map | null>;
  groups: RefObject<Groups | null>;
  registry: RefObject<Map<string, Entry>>;
  /** Canvas of the lines and areas. */
  renderer: RefObject<L.Canvas | null>;
  overlayManager: RefObject<OverlayManager | null>;
  state: RefObject<LiveState>;
  handlers: RefObject<Handlers>;
  /** Objects being dragged here: positions from other posts wait. */
  dragging: RefObject<Set<string>>;
  /** Text of the coordinates and of the live measurement. */
  coordsEl: RefObject<HTMLSpanElement | null>;
  liveEl: RefObject<HTMLElement | null>;
  lastCursor: RefObject<LatLng | null>;
};

/** Height of the map: down to the bottom of the window. */
export function useMapHeight(shell: RefObject<HTMLDivElement | null>) {
  const [height, setHeight] = useState(560);
  useLayoutEffect(() => {
    const el = shell.current;
    if (!el) return;
    const fit = () => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      setHeight(
        Math.max(
          380,
          Math.round(window.innerHeight - top - (narrow() ? 92 : 18)),
        ),
      );
    };
    fit();
    const late = setTimeout(fit, 450);
    const observer = new ResizeObserver(fit);
    const main = el.closest("main");
    if (main) observer.observe(main);
    window.addEventListener("resize", fit);
    return () => {
      clearTimeout(late);
      observer.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, []);
  return height;
}

/**
 * Creates the map, its panes and layer groups, and wires its events to
 * the handlers. Created once per journal (the module remounts on a
 * journal switch).
 */
export function useLeafletMap(
  core: MapCore,
  root: RefObject<HTMLDivElement | null>,
  {
    startView,
    viewKey,
    setLiveStatus,
    setInfo,
    setGhostMenu,
    setThemeKey,
  }: {
    /** View shown first. */
    startView: () => View;
    viewKey: (mapId: string) => string;
    setLiveStatus: (
      update: (s: Record<string, LiveStatus>) => Record<string, LiveStatus>,
    ) => void;
    setInfo: (info: Info | null) => void;
    setGhostMenu: (menu: null) => void;
    setThemeKey: (update: (k: number) => number) => void;
  },
) {
  const {
    map,
    groups,
    registry,
    renderer,
    overlayManager,
    state,
    handlers,
    coordsEl,
    lastCursor,
  } = core;
  useEffect(() => {
    if (!root.current) return;
    const start = startView();
    const m = L.map(root.current, {
      center: [start.lat, start.lng],
      zoom: start.zoom,
      minZoom: 3,
      maxZoom: 20,
      zoomControl: false,
      attributionControl: true,
      worldCopyJump: true,
    });
    m.attributionControl.setPrefix(
      '<a href="https://leafletjs.com" target="_blank" rel="noopener noreferrer">Leaflet</a>',
    );
    L.control
      .scale({ imperial: false, position: "bottomleft", maxWidth: 120 })
      .addTo(m);
    // Lines and areas on one canvas: thousands of vertices stay fluid.
    renderer.current = L.canvas({ padding: 0.5, tolerance: 6 });
    const gridPane = m.createPane("orion-grid");
    gridPane.style.zIndex = "360";
    gridPane.style.pointerEvents = "none";
    gridPane.classList.add("map-grid-pane");
    overlayManager.current = new OverlayManager(
      m,
      (id, status) => setLiveStatus((s) => ({ ...s, [id]: status })),
      (picked, at) => {
        const p = m.latLngToContainerPoint(at);
        const box = m.getContainer().getBoundingClientRect();
        setInfo({ x: box.left + p.x, y: box.top + p.y, items: [picked] });
      },
    );
    const objects = L.layerGroup().addTo(m);
    const ghostsGroup = L.layerGroup().addTo(m);
    const sketch = L.layerGroup().addTo(m);
    const edit = L.layerGroup().addTo(m);
    const dots = L.layerGroup().addTo(sketch);
    const line = L.polyline([], {
      className: "map-sketch",
      weight: 3,
      interactive: false,
    }).addTo(sketch);
    const poly = L.polygon([], {
      className: "map-sketch area",
      weight: 2,
      interactive: false,
    }).addTo(sketch);
    const rubber = L.polyline([], {
      className: "map-sketch rubber",
      weight: 2,
      dashArray: "4 6",
      interactive: false,
    }).addTo(sketch);
    groups.current = {
      objects,
      ghosts: ghostsGroup,
      sketch,
      dots,
      edit,
      line,
      poly,
      rubber,
    };
    map.current = m;

    const showCenter = () => {
      const c = m.getCenter();
      if (coordsEl.current)
        coordsEl.current.textContent = formatPosition(c.lat, c.wrap().lng);
    };
    showCenter();
    m.on("mousemove", (e: L.LeafletMouseEvent) => {
      const { lat, lng } = e.latlng.wrap();
      lastCursor.current = [lat, lng];
      if (coordsEl.current && !state.current.crosshair)
        coordsEl.current.textContent = formatPosition(lat, lng);
      drawSketch(core, e.latlng);
    });
    m.on("mouseout", () => drawSketch(core, null));
    m.on("move", () => {
      if (state.current.crosshair) showCenter();
    });
    m.on("moveend", () => {
      const c = m.getCenter().wrap();
      writeStore(viewKey(state.current.mapId), {
        lat: round6(c.lat),
        lng: round6(c.lng),
        zoom: m.getZoom(),
      });
      if (narrow() || state.current.crosshair) showCenter();
      handlers.current.moved();
    });
    m.on("click", (e: L.LeafletMouseEvent) =>
      handlers.current.mapClick(e.latlng),
    );
    m.on("dblclick", () => handlers.current.finish());
    m.on("movestart", () => setGhostMenu(null));
    // A glide in progress would fight the zoom animation: land at once.
    m.on("zoomstart", () => {
      for (const el of m
        .getContainer()
        .querySelectorAll<HTMLElement>(".map-moving"))
        el.classList.remove("map-moving");
    });

    const observer = new ResizeObserver(() => m.invalidateSize());
    observer.observe(root.current);
    // Another colour theme: the canvas shapes take its layer colours.
    const themes = new MutationObserver(() => setThemeKey((k) => k + 1));
    themes.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "data-palette"],
    });
    const registryMap = registry.current;
    return () => {
      observer.disconnect();
      themes.disconnect();
      overlayManager.current?.destroy();
      overlayManager.current = null;
      registryMap.clear();
      groups.current = null;
      map.current = null;
      m.remove();
    };
  }, []);
}

/** The geo.admin.ch layers chosen on this post. */
export function useOverlays(core: MapCore, overlays: ActiveOverlays) {
  useEffect(() => {
    core.overlayManager.current?.sync(overlays);
    writeStore("orion.map.overlays", overlays);
  }, [overlays]);
}

/** The device is online (the geo.admin.ch layers need it). */
export function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}
