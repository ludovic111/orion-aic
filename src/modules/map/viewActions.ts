import {
  useCallback,
  useRef,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import L from "leaflet";
import type { Journal } from "../../../shared/journal";
import { upsert, type OpsMap, type Place } from "../../../shared/ops";
import type { AppContext } from "../../app/context";
import { formatDistance, type LatLng } from "./geo";
import { identifyUrl, readIdentify } from "./overlays";
import { toGeoJSON } from "./geoformats";
import { onMap } from "./maps";
import { layerKey } from "./panels";
import { GENEVA, type BaseId } from "./bases";
import { narrow, reducedMotion, writeStore, type View } from "./browser";
import { round6 } from "./tools";
import { fileSlug, shiftBy } from "./places";
import type { Info } from "./MapCards";
import type { MapCore } from "./useLeafletMap";
import { t, tn } from "./i18n.ts";

// Where the map looks and what it shows: flights to a place or an object,
// the maps of the operation, backgrounds and hidden layers, framing,
// keyboard moves, the answers of the geo.admin.ch layers, the MN95 export.

type Setter<T> = Dispatch<SetStateAction<T>>;
/** Background or hidden layers chosen while the journal is read-only. */
export type Override = { base?: BaseId; hidden?: string[] };

/** Fly to a place (search, my position), marked for a few seconds. */
export function useGoTo(map: RefObject<L.Map | null>) {
  const flashMarker = useRef<L.Layer | null>(null);
  const flash = useCallback((lat: number, lng: number, label: string) => {
    const m = map.current;
    if (!m) return;
    flashMarker.current?.remove();
    const el = document.createElement("div");
    el.className = "map-flash";
    const span = document.createElement("span");
    span.textContent = label;
    el.append(document.createElement("i"), span);
    const marker = L.marker([lat, lng], {
      icon: L.divIcon({
        html: el,
        className: "map-icon",
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      }),
      interactive: false,
    }).addTo(m);
    flashMarker.current = marker;
    setTimeout(() => {
      if (flashMarker.current === marker) {
        marker.remove();
        flashMarker.current = null;
      }
    }, 9000);
  }, []);

  const goTo = useCallback(
    (lat: number, lng: number, zoom: number | null, label: string) => {
      const m = map.current;
      if (!m) return;
      const z = zoom ?? Math.max(m.getZoom(), 16);
      if (reducedMotion()) m.setView([lat, lng], z);
      else m.flyTo([lat, lng], z, { duration: 0.9 });
      if (label) flash(lat, lng, label);
    },
    [flash],
  );
  return goTo;
}

/**
 * Show an object: on a map that shows it, its layer visible, clear of the
 * side panel and of its sheet (withSheet: opened).
 */
export function useShowPlace({
  map,
  mapId,
  known,
  hidden,
  shownMap,
  panelOpen,
  selectMap,
  setLayerHidden,
  setSheetId,
}: {
  map: RefObject<L.Map | null>;
  mapId: string;
  known: Set<string>;
  hidden: Set<string>;
  /** Map whose view is shown (no flight to its own view). */
  shownMap: RefObject<string>;
  panelOpen: RefObject<boolean>;
  selectMap: (id: string) => void;
  setLayerHidden: (layer: string, off: boolean) => void;
  setSheetId: (id: string | null) => void;
}) {
  return useCallback(
    (p: Place, withSheet: boolean) => {
      const m = map.current;
      if (!m) return;
      // Not on this map: open a map that shows it.
      if (mapId && !onMap(p, mapId, known)) {
        const other = p.maps.find((id) => known.has(id));
        if (other) {
          shownMap.current = other;
          selectMap(other);
        }
      } else if (hidden.has(layerKey(p))) setLayerHidden(layerKey(p), false);
      // Keep the object in the part of the map not covered by the side
      // panel and the sheet.
      const size = m.getSize();
      const wide = !narrow();
      const right = withSheet && wide ? Math.min(560, size.x * 0.6) : 0;
      let left = wide && panelOpen.current ? 384 : 0;
      if (size.x - left - right < 220) left = 0;
      const below = withSheet && !wide ? size.y * 0.55 : 0;
      const animate = !reducedMotion();
      if (p.kind === "line" || p.kind === "area") {
        const bounds = L.latLngBounds(p.points);
        const options = {
          paddingTopLeft: [50 + left, 60] as L.PointTuple,
          paddingBottomRight: [50 + right, 90 + below] as L.PointTuple,
          maxZoom: 17,
        };
        if (animate) m.flyToBounds(bounds, { ...options, duration: 0.9 });
        else m.fitBounds(bounds, options);
      } else {
        const z = Math.max(m.getZoom(), 16);
        const target = m.unproject(
          m.project(p.points[0], z).add([(right - left) / 2, below / 2]),
          z,
        );
        if (animate) m.flyTo(target, z, { duration: 0.9 });
        else m.setView(target, z);
      }
      if (withSheet) setSheetId(p.id);
    },
    [hidden, mapId, known],
  );
}

export type ViewContext = {
  core: MapCore;
  journal: Journal;
  author: string;
  readOnly: boolean;
  locked: boolean;
  toast: AppContext["toast"];
  updateOps: AppContext["updateOps"];
  currentMap: OpsMap | null;
  mapId: string;
  hiddenList: string[];
  hidden: Set<string>;
  visible: Place[];
  framingOf: (m: OpsMap | null) => View | null;
  goTo: (lat: number, lng: number, zoom: number | null, label: string) => void;
  strays: { places: Place[]; home: OpsMap | null };
  strayKey: string;
  /** Latest request to the geo.admin.ch layers (older answers dropped). */
  identifying: RefObject<number>;
  setInfo: Setter<Info | null>;
  setChosenMap: Setter<string>;
  setSheetId: Setter<string | null>;
  setLocalBase: Setter<BaseId>;
  setLocalHidden: Setter<string[]>;
  setOverrides: Setter<Record<string, Override>>;
  setStrayDismissed: Setter<boolean>;
  setNudged: Setter<string>;
};

export function viewActions({
  core: { map, overlayManager },
  journal,
  author,
  readOnly,
  locked,
  toast,
  updateOps,
  currentMap,
  mapId,
  hiddenList,
  hidden,
  visible,
  framingOf,
  goTo,
  strays,
  strayKey,
  identifying,
  setInfo,
  setChosenMap,
  setSheetId,
  setLocalBase,
  setLocalHidden,
  setOverrides,
  setStrayDismissed,
  setNudged,
}: ViewContext) {
  /** Feature info of the geo.admin.ch layers shown, at a click. */
  async function identify(at: L.LatLng) {
    const m = map.current;
    const ids = overlayManager.current?.identifiable() ?? [];
    if (!m || !ids.length) return;
    const b = m.getBounds();
    const size = m.getSize();
    const url = identifyUrl(
      ids,
      [at.lat, at.lng],
      [
        [b.getSouth(), b.getWest()],
        [b.getNorth(), b.getEast()],
      ],
      [size.x, size.y],
    );
    if (!url) return;
    const p = m.latLngToContainerPoint(at);
    const box = m.getContainer().getBoundingClientRect();
    const where = { x: box.left + p.x, y: box.top + p.y };
    const request = ++identifying.current;
    if (!navigator.onLine)
      return setInfo({
        ...where,
        items: [],
        error: t(
          "Hors ligne : les informations des couches ne sont pas disponibles.",
        ),
      });
    setInfo({ ...where, items: [], loading: true });
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(String(response.status));
      const items = readIdentify(await response.json()).map((i) => ({
        title: i.title,
        source: "geo.admin.ch",
        rows: i.rows,
      }));
      if (request !== identifying.current) return;
      setInfo(items.length ? { ...where, items } : null);
    } catch {
      if (request !== identifying.current) return;
      setInfo({
        ...where,
        items: [],
        error: t("Le service d’information de geo.admin.ch ne répond pas."),
      });
    }
  }

  /* ---------- Maps, backgrounds, layers ---------- */
  function selectMap(id: string) {
    setChosenMap(id);
    writeStore(`orion.map.current.${journal.id}`, id);
    setSheetId(null);
  }

  function updateMap(m: OpsMap, patch: Partial<OpsMap>) {
    try {
      updateOps((ops) => upsert(ops, "maps", { ...m, ...patch }, author));
    } catch (err) {
      toast((err as Error).message);
    }
  }

  // Past versions and closed journals: changes stay on this screen.
  function chooseBase(id: BaseId) {
    if (!currentMap) {
      setLocalBase(id);
      writeStore("orion.map.base", id);
    } else if (readOnly)
      setOverrides((o) => ({ ...o, [mapId]: { ...o[mapId], base: id } }));
    else updateMap(currentMap, { base: id });
  }

  function setHiddenLayers(next: string[]) {
    if (!currentMap) {
      setLocalHidden(next);
      writeStore("orion.map.hidden", next);
    } else if (readOnly)
      setOverrides((o) => ({ ...o, [mapId]: { ...o[mapId], hidden: next } }));
    else updateMap(currentMap, { hidden: next.slice(0, 50) });
  }
  function setLayerHidden(layer: string, off: boolean) {
    const next = new Set(hiddenList);
    if (off) next.add(layer);
    else next.delete(layer);
    setHiddenLayers([...next]);
  }
  const toggleLayer = (layer: string) =>
    setLayerHidden(layer, !hidden.has(layer));

  function fitAll() {
    const m = map.current;
    const pts = visible.flatMap((p) => p.points);
    if (!m) return;
    if (!pts.length) return toast(t("Aucun objet visible à afficher."));
    m.fitBounds(L.latLngBounds(pts), {
      padding: [60, 60],
      maxZoom: 17,
      animate: !reducedMotion(),
    });
  }

  function home() {
    const c = framingOf(currentMap) ?? GENEVA;
    map.current?.setView([c.lat, c.lng], c.zoom, { animate: !reducedMotion() });
  }

  function locate() {
    if (!navigator.geolocation)
      return toast(t("Position indisponible sur cet appareil."));
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        goTo(pos.coords.latitude, pos.coords.longitude, 16, t("Ma position")),
      (err) =>
        toast(
          err.code === err.PERMISSION_DENIED
            ? t(
                "Position refusée : autorisez la localisation dans le navigateur.",
              )
            : t("Position indisponible pour le moment."),
        ),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
    );
  }

  /** Framing of the map shown, for every post. */
  function saveFraming() {
    const m = map.current;
    if (!m) return;
    if (readOnly)
      return toast(t("Lecture seule : le cadrage n’est pas enregistré."));
    const c = m.getCenter().wrap();
    const view = {
      lat: round6(c.lat),
      lng: round6(c.lng),
      zoom: Math.min(22, Math.max(1, m.getZoom())),
    };
    try {
      if (currentMap) updateMap(currentMap, view);
      else
        updateOps((ops) => ({
          ...ops,
          settings: { ...ops.settings, mapCenter: view },
        }));
      toast(
        currentMap
          ? t("Cadrage enregistré pour « {name} ».", { name: currentMap.name })
          : t("Vue par défaut enregistrée pour ce journal."),
      );
    } catch (err) {
      toast((err as Error).message);
    }
  }

  function fitPoints(points: LatLng[]) {
    const m = map.current;
    if (!m || !points.length) return;
    m.fitBounds(L.latLngBounds(points), {
      padding: [60, 60],
      maxZoom: 17,
      animate: !reducedMotion(),
    });
  }

  function fixStrays() {
    const { home, places: list } = strays;
    if (!home || !list.length) return;
    const ids = new Set(list.map((p) => p.id));
    try {
      updateOps((ops) => ({
        ...ops,
        places: ops.places.map((p) =>
          ids.has(p.id) && !p.maps.length
            ? { ...p, maps: [home.id], updatedAt: new Date().toISOString() }
            : p,
        ),
      }));
      toast(
        tn(
          list.length,
          "{n} objet gardé sur « {name} » seulement.",
          "{n} objets gardés sur « {name} » seulement.",
          { name: home.name },
        ),
      );
    } catch (err) {
      toast((err as Error).message);
    }
  }
  function keepStrays() {
    setStrayDismissed(true);
    writeStore(strayKey, true);
  }

  /** Keyboard move from the list of objects: metres east / north. */
  function nudge(p: Place, east: number, north: number) {
    if (readOnly || locked) return;
    const shift = shiftBy(east, north);
    try {
      updateOps((ops) =>
        upsert(
          ops,
          "places",
          {
            ...p,
            points: p.points.map(shift),
            ...(p.holes && { holes: p.holes.map((h) => h.map(shift)) }),
          },
          author,
        ),
      );
      const d = Math.hypot(east, north);
      const params = { name: p.label || t("Objet"), d: formatDistance(d) };
      setNudged(
        north > 0
          ? t("{name} déplacé de {d} vers le nord.", params)
          : north < 0
            ? t("{name} déplacé de {d} vers le sud.", params)
            : east > 0
              ? t("{name} déplacé de {d} vers l’est.", params)
              : t("{name} déplacé de {d} vers l’ouest.", params),
      );
    } catch (err) {
      toast((err as Error).message);
    }
  }

  /** GeoJSON of the map shown in MN95 (EPSG:2056), for Swiss GIS. */
  function exportSwissGeoJSON() {
    try {
      const text = toGeoJSON(journal, mapId, { crs: "EPSG:2056" });
      const blob = new Blob([text], { type: "application/geo+json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const name = fileSlug(currentMap?.name ?? journal.title);
      a.href = url;
      a.download = `${name || t("carte")}-mn95.geojson`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      toast(t("GeoJSON MN95 (EPSG:2056) enregistré."));
    } catch (err) {
      toast((err as Error).message);
    }
  }

  return {
    identify,
    selectMap,
    chooseBase,
    setHiddenLayers,
    setLayerHidden,
    toggleLayer,
    fitAll,
    home,
    locate,
    saveFraming,
    fitPoints,
    fixStrays,
    keepStrays,
    nudge,
    exportSwissGeoJSON,
  };
}
