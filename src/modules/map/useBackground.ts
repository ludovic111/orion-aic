import { useEffect, useRef, useState, type RefObject } from "react";
import L from "leaflet";
import { fromMN95, toMN95 } from "../../../shared/coordinates";
import { getLang } from "../../../shared/i18n/core.ts";
import type { LatLng } from "./geo";
import { gridLines, gridSpacingForZoom } from "./swissgrid";
import { gridLabel } from "./printscale";
import { BASES, SWISS_BOUNDS, type BaseId } from "./bases";
import { narrow, writeStore } from "./browser";
import type { MapCore } from "./useLeafletMap";
import { t } from "./i18n.ts";

// Under the objects: the background (swisstopo or OpenStreetMap tiles) and
// the Swiss grid (MN95) with its labels.

const SWISSTOPO = () =>
  `© <a href="https://www.swisstopo.admin.ch/${getLang()}/" target="_blank" rel="noopener noreferrer">swisstopo</a>`;
const OSM = () =>
  `© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">${t("les contributeurs d’OpenStreetMap")}</a>`;

/** The MN95 grid, redrawn for the view (drawGrid, after each move). */
export function useSwissGrid(core: MapCore, showGrid: boolean) {
  const { map, state } = core;
  const gridGroup = useRef<L.LayerGroup | null>(null);
  function drawGrid() {
    const m = map.current;
    gridGroup.current?.remove();
    gridGroup.current = null;
    if (!m || !state.current.showGrid) return;
    const spacing = gridSpacingForZoom(m.getZoom());
    if (!spacing) return;
    const b = m.getBounds().pad(0.05);
    const lines = gridLines(
      [
        [b.getSouth(), b.getWest()],
        [b.getNorth(), b.getEast()],
      ],
      spacing,
    );
    const group = L.layerGroup();
    // Labels along the top edge (east values) and along the right edge,
    // beside the controls (north values): the left edge has the panel.
    const size = m.getSize();
    const top = m.containerPointToLatLng([size.x / 2, 34]);
    const left = m.containerPointToLatLng([
      Math.max(40, size.x - (narrow() ? 90 : 110)),
      size.y / 2,
    ]);
    let edge: { north: number; east: number };
    try {
      edge = {
        north: toMN95(top.lat, top.lng).north,
        east: toMN95(left.lat, left.lng).east,
      };
    } catch {
      return;
    }
    for (const line of lines) {
      L.polyline(line.points, {
        pane: "orion-grid",
        className: `map-grid-line${line.value % (spacing * 10) === 0 ? " major" : ""}`,
        weight: 1,
        interactive: false,
      }).addTo(group);
      let anchor: LatLng;
      try {
        const p =
          line.axis === "east"
            ? fromMN95(line.value, edge.north)
            : fromMN95(edge.east, line.value);
        anchor = [p.lat, p.lng];
      } catch {
        continue;
      }
      const el = document.createElement("span");
      el.className = `map-grid-label ${line.axis}`;
      el.textContent = gridLabel(line.value, spacing);
      L.marker(anchor, {
        pane: "orion-grid",
        interactive: false,
        keyboard: false,
        icon: L.divIcon({ html: el, className: "map-icon", iconSize: [0, 0] }),
      }).addTo(group);
    }
    group.addTo(m);
    gridGroup.current = group;
  }
  useEffect(() => {
    drawGrid();
    writeStore("orion.map.grid", showGrid);
  }, [showGrid]);
  return drawGrid;
}

/**
 * The background tiles. Why the background is missing: the device is
 * offline, or it is online but the tile server does not answer.
 */
export function useBaseLayer(map: RefObject<L.Map | null>, base: BaseId) {
  const [tileError, setTileError] = useState<"offline" | "unreachable" | null>(
    null,
  );
  const baseLayer = useRef<L.TileLayer | null>(null);
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const b = BASES[base];
    setTileError(null);
    let loaded = 0;
    let failed = 0;
    const layer = L.tileLayer(b.url, {
      maxZoom: 20,
      maxNativeZoom: b.native,
      crossOrigin: true,
      className: b.className,
      attribution: b.swiss ? SWISSTOPO() : OSM(),
      ...(b.swiss ? { bounds: L.latLngBounds(SWISS_BOUNDS) } : {}),
    });
    layer.on("loading", () => {
      loaded = 0;
      failed = 0;
    });
    layer.on("tileload", () => {
      loaded++;
      setTileError(null);
    });
    layer.on("tileerror", () => {
      failed++;
      if (!navigator.onLine) setTileError("offline");
      // A few isolated misses (edge of the coverage) are not an outage.
      else if (failed >= 4 && loaded === 0) setTileError("unreachable");
    });
    // Back online: fetch the missing tiles again at once.
    const online = () => {
      setTileError(null);
      layer.redraw();
    };
    const offline = () => setTileError("offline");
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    layer.addTo(m);
    layer.bringToBack();
    baseLayer.current = layer;
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      baseLayer.current = null;
      // Removed first: Leaflet unhooks the layer from the map on its own
      // « remove » event, which off() would drop (every zoom would then
      // reach a layer without a map).
      layer.remove();
      layer.off();
    };
  }, [base]);
  return { tileError, setTileError, baseLayer };
}
