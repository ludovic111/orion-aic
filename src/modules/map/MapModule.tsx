import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Pin } from "lucide-react";
import { journalLang, type OpsMap, type Place } from "../../../shared/ops";
import { t } from "./i18n.ts";
import { parseRef, ref, type Ref } from "../../../shared/links";
import { Ctx, useApp } from "../../app/context";
import { ModuleHead } from "../../ui/ModuleHead";
import { formatPosition, parseRadii, type LatLng } from "./geo";
import type {
  ActiveOverlays,
  LiveStatus,
  OverlayManager,
} from "./overlayLayers";
import { LiveLayer } from "./LiveLayer";
import { overlayById } from "./overlays";
import { SectorDialog } from "./SectorDialog";
import { PrintDialog } from "./PrintDialog";
import { persistStorage } from "./sectors";
import type { Bounds } from "./tilecache";
import { MapSearch } from "./MapSearch";
import { PlaceSheet } from "./PlaceSheet";
import { layerKey } from "./panels";
import {
  describeSymbol,
  recentSymbols,
  useCatalog,
  useCustomSymbolsSync,
} from "./symbols";
import { GENEVA, isBase, type BaseId } from "./bases";
import { MAIN_MAP, MAIN_NAME, onMap, sortMaps, strayObjects } from "./maps";
import { MapTabs } from "./MapTabs";
import { MapDialog } from "./MapDialog";
import { ImportDialog } from "./ImportDialog";
import {
  isRecord,
  isView,
  narrow,
  readStore,
  reducedMotion,
  writeStore,
  type View,
} from "./browser";
import { isPlume, type Plume, type Tool } from "./tools";
import {
  citedPositions,
  keepStable,
  latestWind,
  standardLayers,
  symbolForKind,
  type Ghost,
  type StablePlaces,
} from "./places";
import { PinBody, type Style } from "./PinBody";
import {
  CoordsMenu,
  GhostCard,
  InfoCard,
  MapHover,
  type Hover,
  type Info,
} from "./MapCards";
import { MapPanel, type Panel } from "./MapPanel";
import { BaseMenu, MapControls, TileBanner } from "./MapControls";
import { MapToolbar } from "./MapToolbar";
import { toolHint } from "./ToolHint";
import { useMapHistory } from "./useMapHistory";
import {
  noHandlers,
  useLeafletMap,
  useMapHeight,
  useOnline,
  useOverlays,
  type Entry,
  type Groups,
  type Handlers,
  type LiveState,
  type MapCore,
} from "./useLeafletMap";
import { useBaseLayer, useSwissGrid } from "./useBackground";
import { useObjectLayer } from "./useObjectLayer";
import { useFreehand, useSketch } from "./useDrawing";
import { useShapeEditor, type ShapeEdit } from "./useShapeEditor";
import { useMapKeyboard } from "./useMapKeyboard";
import { drawActions } from "./drawActions";
import {
  useGoTo,
  useShowPlace,
  viewActions,
  type Override,
} from "./viewActions";
import "./map.css";

// Situation map: swisstopo background, official civil symbols, lines and
// areas, and everything linked to each object on hover. Leaflet is driven
// imperatively; marker contents are React portals so they follow the data
// without rebuilding the map.
//
// This file holds the state and puts the parts together: the Leaflet map
// and what is drawn on it (use*.ts hooks), what the tools and the views do
// (drawActions.ts, viewActions.ts), and the controls around the map
// (MapPanel, MapControls, MapToolbar, ToolHint, MapCards).

/**
 * Same objects as long as nothing changed: an edit elsewhere in the
 * journal re-validates every record (new objects), which would redraw
 * every symbol on the map.
 */
function useStablePlaces(list: Place[]): Place[] {
  const memo = useRef<StablePlaces>({ list: [], byId: new Map() });
  return useMemo(() => {
    memo.current = keepStable(memo.current, list);
    return memo.current.list;
  }, [list]);
}

export function MapModule() {
  const app = useApp();
  const {
    journal,
    live,
    viewAt,
    author,
    readOnly,
    graph,
    updateOps: updateOpsRaw,
    lists,
    focus,
    setFocus,
    open,
    toast,
    exportCenter,
  } = app;
  const catalog = useCatalog();
  useCustomSymbolsSync(journal.ops.symbols, live.ops.symbols);
  const allPlaces = useStablePlaces(journal.ops.places);
  const settingsCenter = journal.ops.settings.mapCenter;

  /* ---------- Undo / redo (this post, this session) ---------- */
  // Every change of the map module (sheet, dialogs included) goes through
  // the history: the state of each object before and after is remembered.
  const { updateOps, step, canUndo, canRedo } = useMapHistory({
    live,
    updateOps: updateOpsRaw,
    toast,
    readOnly,
  });
  const mapApp = useMemo(() => ({ ...app, updateOps }), [app, updateOps]);

  const shell = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const groups = useRef<Groups | null>(null);
  const registry = useRef(new Map<string, Entry>());
  const coordsEl = useRef<HTMLSpanElement>(null);
  const liveEl = useRef<HTMLElement>(null);
  const baseButton = useRef<HTMLButtonElement>(null);

  // Background of the implicit main map (before any map record).
  const [localBase, setLocalBase] = useState<BaseId>(() =>
    readStore<BaseId>("orion.map.base", "color", isBase),
  );
  const [baseMenu, setBaseMenu] = useState(false);
  const [tool, setTool] = useState<Tool>("select");
  const [armed, setArmed] = useState(() => recentSymbols()[0] ?? "b:incident");
  const [pending, setPending] = useState<{ target: Ref; title: string } | null>(
    null,
  );
  const [draft, setDraft] = useState<LatLng[]>([]);
  const [measureDone, setMeasureDone] = useState(false);
  // Standard layers in the language of the journal (Effets, Auswirkungen…).
  const layers = standardLayers(journal.ops);
  const [drawLayer, setDrawLayer] = useState(() =>
    readStore(
      "orion.map.drawLayer",
      layers.effects,
      (v) => typeof v === "string",
    ),
  );
  const [panel, setPanel] = useState<Panel>(() => (narrow() ? null : "list"));
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [localHidden, setLocalHidden] = useState<string[]>(() =>
    readStore<string[]>("orion.map.hidden", [], (v) => Array.isArray(v)).filter(
      (x) => typeof x === "string",
    ),
  );
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [chosenMap, setChosenMap] = useState(() =>
    readStore(
      `orion.map.current.${journal.id}`,
      MAIN_MAP,
      (v) => typeof v === "string",
    ),
  );
  const [mapDialog, setMapDialog] = useState<"new" | "edit" | null>(null);
  const [importing, setImporting] = useState(false);
  const [showGhosts, setShowGhosts] = useState(() =>
    readStore("orion.map.ghosts", true, (v) => typeof v === "boolean"),
  );
  // Live positions of the teams (never stored, hidden in the past).
  const [showLive, setShowLive] = useState(() =>
    readStore("orion.map.live", true, (v) => typeof v === "boolean"),
  );
  const [ghostMenu, setGhostMenu] = useState<
    (Ghost & { x: number; y: number }) | null
  >(null);
  const [shapeEdit, setShapeEdit] = useState<ShapeEdit | null>(null);
  // Objects locked in place (this browser): no accidental move while
  // panning or zooming.
  const [locked, setLocked] = useState(() =>
    readStore("orion.map.locked", false, (v) => typeof v === "boolean"),
  );
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // geo.admin.ch overlays chosen on this post.
  const [overlays, setOverlays] = useState<ActiveOverlays>(() => {
    const v = readStore<ActiveOverlays>("orion.map.overlays", {}, isRecord);
    const out: ActiveOverlays = {};
    for (const [id, o] of Object.entries(v))
      if (overlayById(id) && typeof o === "number") out[id] = o;
    return out;
  });
  const [liveStatus, setLiveStatus] = useState<Record<string, LiveStatus>>({});
  const overlayManager = useRef<OverlayManager | null>(null);
  const [info, setInfo] = useState<Info | null>(null);
  const [showGrid, setShowGrid] = useState(() =>
    readStore("orion.map.grid", false, (v) => typeof v === "boolean"),
  );
  const [crosshair, setCrosshair] = useState(false);
  const [coordsMenu, setCoordsMenu] = useState<LatLng | null>(null);
  const coordsButton = useRef<HTMLButtonElement>(null);
  const lastCursor = useRef<LatLng | null>(null);
  const [full, setFull] = useState(false);
  const [sectorDialog, setSectorDialog] = useState(false);
  const [sectorBox, setSectorBox] = useState<Bounds | null>(null);
  const [printing, setPrinting] = useState(false);
  const [ringsText, setRingsText] = useState(() =>
    readStore(
      "orion.map.rings",
      "100, 300, 1000",
      (v) => typeof v === "string",
    ),
  );
  const [plume, setPlume] = useState<Plume>(() =>
    readStore<Plume>(
      "orion.map.plume",
      { bearing: 45, angle: 45, length: 1000 },
      isPlume,
    ),
  );
  const renderer = useRef<L.Canvas | null>(null);
  const [themeKey, setThemeKey] = useState(0);
  const dragging = useRef(new Set<string>());
  const [nudged, setNudged] = useState("");

  /* ---------- Maps of the operation ---------- */
  const maps = useMemo(() => sortMaps(journal.ops.maps), [journal.ops.maps]);
  const known = useMemo(() => new Set(maps.map((m) => m.id)), [maps]);
  const currentMap: OpsMap | null =
    maps.find((m) => m.id === chosenMap) ?? maps[0] ?? null;
  const mapId = currentMap?.id ?? MAIN_MAP;
  const override = overrides[mapId];
  const base: BaseId = currentMap
    ? (override?.base ?? (isBase(currentMap.base) ? currentMap.base : "color"))
    : localBase;
  const hiddenList = currentMap
    ? (override?.hidden ?? currentMap.hidden)
    : localHidden;
  const hidden = useMemo(() => new Set(hiddenList), [hiddenList]);
  // Back to the present: the records speak again.
  useEffect(() => {
    if (!readOnly) setOverrides({});
    else {
      // Entering the time machine (or a closed journal): drop any drawing
      // or editing in progress, and close the dialogs that write.
      setTool("select");
      setDraft([]);
      setMeasureDone(false);
      setShapeEdit(null);
      setPending(null);
      setMapDialog(null);
      setImporting(false);
      setPanel((p) => (p === "symbols" ? (narrow() ? null : "list") : p));
    }
  }, [readOnly]);

  const places = useMemo(
    () => (mapId ? allPlaces.filter((p) => onMap(p, mapId, known)) : allPlaces),
    [allPlaces, mapId, known],
  );
  const byId = useMemo(
    () => new Map(allPlaces.map((p) => [p.id, p])),
    [allPlaces],
  );
  const sheetPlace = sheetId ? byId.get(sheetId) : undefined;
  const visible = useMemo(
    () =>
      places.filter((p) => !hidden.has(layerKey(p)) && p.id !== shapeEdit?.id),
    [places, hidden, shapeEdit?.id],
  );
  const canDrag = tool === "select" && !readOnly && !locked;

  // Items citing coordinates that no map object stands for yet.
  const ghosts = useMemo(
    () => citedPositions(graph, journal.entries, journal.ops.messages),
    [graph, journal.entries, journal.ops.messages],
  );

  const panelOpen = useRef(false);
  panelOpen.current = !!panel;

  // Latest state for Leaflet callbacks registered once.
  const state = useRef<LiveState>({
    tool,
    draft,
    measureDone,
    readOnly,
    canDrag,
    byId,
    mapId,
    crosshair,
    showGrid,
    plume,
  });
  state.current = {
    tool,
    draft,
    measureDone,
    readOnly,
    canDrag,
    byId,
    mapId,
    crosshair,
    showGrid,
    plume,
  };
  const handlers = useRef<Handlers>(noHandlers());
  const core: MapCore = {
    map,
    groups,
    registry,
    renderer,
    overlayManager,
    state,
    handlers,
    dragging,
    coordsEl,
    liveEl,
    lastCursor,
  };

  /* ---------- Layout ---------- */
  const height = useMapHeight(shell);

  /* ---------- Map ---------- */
  // Last view of each map in this browser; the saved framing of the map
  // (shared by every post) otherwise.
  const viewKey = (id: string) =>
    id ? `orion.map.view.${journal.id}.${id}` : `orion.map.view.${journal.id}`;
  const framingOf = (m: OpsMap | null): View | null =>
    m ? { lat: m.lat, lng: m.lng, zoom: m.zoom } : settingsCenter;
  const viewOf = (m: OpsMap | null): View =>
    readStore<View | null>(viewKey(m?.id ?? MAIN_MAP), null, isView) ??
    framingOf(m) ??
    GENEVA;
  useLeafletMap(core, root, {
    startView: () => viewOf(currentMap),
    viewKey,
    setLiveStatus,
    setInfo,
    setGhostMenu,
    setThemeKey,
  });

  /* ---------- geo.admin.ch overlays ---------- */
  useOverlays(core, overlays);
  const online = useOnline();

  /* ---------- Swiss grid ---------- */
  const drawGrid = useSwissGrid(core, showGrid);
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const c = m.getCenter();
    if (coordsEl.current)
      coordsEl.current.textContent = formatPosition(c.lat, c.wrap().lng);
  }, [crosshair]);

  // Another map chosen: its own view.
  const shownMap = useRef(mapId);
  useEffect(() => {
    if (shownMap.current === mapId) return;
    shownMap.current = mapId;
    const m = map.current;
    if (!m) return;
    const v = viewOf(currentMap);
    if (reducedMotion()) m.setView([v.lat, v.lng], v.zoom);
    else m.flyTo([v.lat, v.lng], v.zoom, { duration: 0.8 });
    setDraft([]);
    setShapeEdit(null);
  }, [mapId]);

  /* ---------- Base layer ---------- */
  const { tileError, setTileError, baseLayer } = useBaseLayer(map, base);

  /* ---------- Objects ---------- */
  // Hovered or opened object stands out.
  const hot = hover?.target.startsWith("place:")
    ? parseRef(hover.target).id
    : null;
  const { slots, cull, publishSlots } = useObjectLayer(core, shell, {
    visible,
    themeKey,
    canDrag,
    sheetId,
    highlight,
    hot,
    byId,
    ghosts,
    showGhosts,
  });

  /* ---------- Drawing, freehand, shape editing ---------- */
  useSketch(core, tool, draft, measureDone, plume);
  useFreehand(core, tool);
  const refreshHandles = useShapeEditor(core, {
    shapeEdit,
    setShapeEdit,
    byId,
    toast,
    sheetId,
    cull,
    publishSlots,
  });

  /* ---------- Actions ---------- */
  const goTo = useGoTo(map);
  /** Wind of the latest forecast (weather module), blowing towards. */
  const wind = useMemo(
    () => latestWind(journal.ops.forecasts),
    [journal.ops.forecasts],
  );
  const draw = drawActions({
    core,
    journal,
    author,
    readOnly,
    locked,
    toast,
    updateOps,
    catalog,
    currentMap,
    byId,
    layers,
    drawLayer,
    tool,
    draft,
    measureDone,
    armed,
    pending,
    shapeEdit,
    panel,
    hoverTimer,
    setTool,
    setDraft,
    setMeasureDone,
    setShapeEdit,
    setGhostMenu,
    setPending,
    setPanel,
    setSheetId,
    setPlume,
    setHover,
    setInfo,
    setSectorBox,
    setSectorDialog,
  });
  const { chooseTool, createCircle, createRings, createSector, finish } = draw;

  /* ---------- Objects left on every map by earlier versions ---------- */
  const strayKey = `orion.map.strays.${journal.id}`;
  const [strayDismissed, setStrayDismissed] = useState(() =>
    readStore(strayKey, false, (v) => typeof v === "boolean"),
  );
  const strays = useMemo(
    () =>
      strayDismissed
        ? { places: [] as Place[], home: null }
        : strayObjects(allPlaces, maps),
    [allPlaces, maps, strayDismissed],
  );
  const identifying = useRef(0);
  const view = viewActions({
    core,
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
  });
  const { selectMap, saveFraming, fitPoints } = view;
  const showPlace = useShowPlace({
    map,
    mapId,
    known,
    hidden,
    shownMap,
    panelOpen,
    selectMap: view.selectMap,
    setLayerHidden: view.setLayerHidden,
    setSheetId,
  });

  handlers.current = draw.mapHandlers({
    identify: view.identify,
    moved: () => {
      if (cull()) publishSlots();
      drawGrid();
      refreshHandles();
    },
  });

  /* ---------- Focus from other modules ---------- */
  useEffect(() => {
    if (!focus) return;
    const { kind, id } = parseRef(focus);
    if (kind !== "place") return;
    setFocus(null);
    if (id.startsWith("new:")) {
      const target = id.slice(4) as Ref;
      const item = graph.byRef.get(target);
      if (readOnly)
        return toast(
          viewAt !== null
            ? t(
                "Lecture seule : vous consultez le passé. Revenez au direct pour placer un objet.",
              )
            : t("Journal clôturé : la carte est en lecture seule."),
        );
      if (!item) return toast(t("Élément introuvable."));
      setDraft([]);
      setShapeEdit(null);
      setTool("point");
      setPanel("symbols");
      setArmed(symbolForKind(item.kind));
      setPending({ target, title: item.title });
      return;
    }
    const p = byId.get(id);
    if (p) showPlace(p, true);
    else toast(t("Cet objet n’est plus sur la carte."));
  }, [focus, setFocus, graph.byRef, byId, readOnly, showPlace, toast]);

  /* ---------- Keyboard ---------- */
  useMapKeyboard({
    step,
    info,
    setInfo,
    ghostMenu,
    setGhostMenu,
    shapeEdit,
    setShapeEdit,
    draft,
    setDraft,
    measureDone,
    tool,
    chooseTool,
    finish,
    full,
    setFull,
  });

  const onStyle = useCallback(
    (id: string, style: Style) => handlers.current.style(id, style),
    [],
  );

  // Map tiles kept offline: ask the browser, once, not to evict the
  // storage of the site (Chrome decides alone; Firefox asks the user).
  useEffect(() => {
    if (readStore("orion.map.persist", false, (v) => typeof v === "boolean"))
      return;
    writeStore("orion.map.persist", true);
    void persistStorage();
  }, []);

  const armedInfo = describeSymbol(armed, catalog, journalLang(journal.ops));
  const layerOptions = lists("layers");

  const hint = toolHint({
    tool,
    shapeEdit: !!shapeEdit,
    draft,
    measureDone,
    armed,
    placing: pending ? pending.title : armedInfo.name,
    drawLayer,
    layerOptions,
    onDrawLayer: (layer) => {
      setDrawLayer(layer);
      writeStore("orion.map.drawLayer", layer);
    },
    ringsText,
    onRingsText: (text) => {
      setRingsText(text);
      writeStore("orion.map.rings", text);
    },
    plume,
    onPlume: (patch) => {
      const next = { ...plume, ...patch };
      setPlume(next);
      writeStore("orion.map.plume", next);
    },
    wind,
    liveEl,
    onSaveShape: draw.saveShape,
    onCancelShape: () => setShapeEdit(null),
    onClose: () => chooseTool("select"),
    onCircle: (r) => createCircle(draft[0], r),
    onRings: () => createRings(draft[0], parseRadii(ringsText)),
    onSector: () => createSector(draft[0], plume.bearing, plume.length),
    onBoxCancel: () => {
      chooseTool("select");
      setSectorDialog(true);
    },
    onUndoPoint: () => setDraft((d) => d.slice(0, -1)),
    onFinish: finish,
  });

  return (
    <Ctx.Provider value={mapApp}>
      <ModuleHead
        actions={
          !readOnly && (
            <button
              type="button"
              onClick={saveFraming}
              title={
                currentMap
                  ? t("« {name} » s’ouvrira ici pour tous les postes", {
                      name: currentMap.name,
                    })
                  : t("La carte s’ouvrira ici pour tous les postes")
              }
            >
              <Pin size={14} />
              {t("Enregistrer le cadrage")}
            </button>
          )
        }
      />
      <div
        ref={shell}
        className={`map-shell tool-${tool}${base === "night" ? " night dark-base" : base === "aerial" ? " dark-base" : ""}${panel ? " with-panel" : ""}${hint ? " has-hint" : ""}${viewAt !== null ? " past" : ""}${full ? " full" : ""}`}
        style={full ? undefined : { height }}
      >
        <div
          ref={root}
          className="map-canvas"
          role="application"
          aria-label={t("Carte de situation")}
        />
        {crosshair && <div className="map-reticle" aria-hidden="true" />}

        <div className="map-top-left">
          <MapTabs
            maps={maps}
            current={mapId}
            readOnly={readOnly}
            onSelect={selectMap}
            onNew={() => setMapDialog("new")}
            onEdit={() => setMapDialog("edit")}
            onFrame={saveFraming}
            onImport={() => setImporting(true)}
            onExport={() => exportCenter({ sections: ["map"], viewAt })}
            onPrint={() => setPrinting(true)}
            onOffline={() => setSectorDialog(true)}
            onSwissGeoJSON={view.exportSwissGeoJSON}
          />
          <MapSearch onGo={goTo} />
          {panel && (
            <MapPanel
              panel={panel}
              onPanel={setPanel}
              readOnly={readOnly}
              places={places}
              hidden={hidden}
              strays={strays}
              onFixStrays={view.fixStrays}
              onKeepStrays={view.keepStrays}
              onHover={setHighlight}
              onPick={(p) => {
                if (narrow()) setPanel(null);
                showPlace(p, true);
              }}
              onNudge={readOnly || locked ? undefined : view.nudge}
              announce={nudged}
              armed={tool === "point" ? armed : undefined}
              onArm={(id) => {
                setArmed(id);
                if (tool !== "point") {
                  setTool("point");
                  setDraft([]);
                }
                if (narrow()) setPanel(null);
              }}
              onToggleLayer={view.toggleLayer}
              onShowAll={() => view.setHiddenLayers([])}
              ghosts={ghosts.length}
              live={{
                on: showLive,
                past: viewAt !== null,
                onToggle: (on) => {
                  setShowLive(on);
                  writeStore("orion.map.live", on);
                },
              }}
              showGhosts={showGhosts}
              onGhosts={(on) => {
                setShowGhosts(on);
                writeStore("orion.map.ghosts", on);
              }}
              overlays={overlays}
              liveStatus={liveStatus}
              online={online}
              onOverlay={(id, on) =>
                setOverlays((o) => {
                  const next = { ...o };
                  if (on) next[id] = overlayById(id)?.opacity ?? 0.7;
                  else delete next[id];
                  return next;
                })
              }
              onOpacity={(id, opacity) =>
                setOverlays((o) => ({ ...o, [id]: opacity }))
              }
            />
          )}
        </div>

        <MapControls
          base={base}
          baseButton={baseButton}
          baseMenu={baseMenu}
          onBaseMenu={() => setBaseMenu((v) => !v)}
          onZoomIn={() => map.current?.zoomIn()}
          onZoomOut={() => map.current?.zoomOut()}
          readOnly={readOnly}
          locked={locked}
          onLock={() => {
            const next = !locked;
            setLocked(next);
            writeStore("orion.map.locked", next);
            toast(
              next
                ? t(
                    "Objets verrouillés : ils ne bougent plus, même en glissant dessus.",
                  )
                : t("Objets déverrouillés : glisser un objet le déplace."),
            );
          }}
          onFitAll={view.fitAll}
          onLocate={view.locate}
          onHome={view.home}
          full={full}
          onFull={() => setFull((v) => !v)}
        />

        {hint && (
          <div className="map-hint map-glass" role="status">
            {hint}
          </div>
        )}
        {tileError && (
          <TileBanner
            error={tileError}
            base={base}
            onRetry={() => {
              setTileError(null);
              baseLayer.current?.redraw();
            }}
            onClose={() => setTileError(null)}
          />
        )}

        <MapToolbar
          tool={tool}
          readOnly={readOnly}
          crosshair={crosshair}
          coordsButton={coordsButton}
          coordsEl={coordsEl}
          coordsOpen={!!coordsMenu}
          onCoords={() => {
            const m = map.current;
            if (!m) return;
            const c = m.getCenter().wrap();
            setCoordsMenu(
              crosshair || !lastCursor.current || narrow()
                ? [c.lat, c.lng]
                : lastCursor.current,
            );
          }}
          onTool={chooseTool}
          canUndo={canUndo}
          canRedo={canRedo}
          onStep={step}
          panelOpen={!!panel}
          onList={() => setPanel(panel ? null : "list")}
        />
      </div>

      {slots.map((s) => {
        const p = byId.get(s.id);
        if (!p) return null;
        return createPortal(
          <PinBody
            place={p}
            hot={s.id === highlight || s.id === sheetId || s.id === hot}
            links={graph.degree.get(ref("place", p.id)) ?? 0}
            editable={s.id === sheetId && canDrag}
            onStyle={onStyle}
          />,
          s.el,
          s.id,
        );
      })}

      {baseMenu && (
        <BaseMenu
          anchor={baseButton.current}
          base={base}
          onChoose={view.chooseBase}
          onClose={() => setBaseMenu(false)}
          showGrid={showGrid}
          onGrid={() => setShowGrid((v) => !v)}
          crosshair={crosshair}
          onCrosshair={() => setCrosshair((v) => !v)}
          overlays={Object.keys(overlays).length}
          onLayers={() => {
            setPanel("layers");
            setBaseMenu(false);
          }}
        />
      )}

      {hover && !sheetPlace && <MapHover hover={hover} />}

      <LiveLayer
        mapRef={map}
        show={showLive && viewAt === null}
        onCreatePoint={draw.createFromLive}
      />

      {ghostMenu && (
        <GhostCard
          ghost={ghostMenu}
          readOnly={readOnly}
          onCreate={() => draw.createFromGhost(ghostMenu)}
          onOpen={() => {
            setGhostMenu(null);
            open(ghostMenu.target);
          }}
          onClose={() => setGhostMenu(null)}
        />
      )}

      {info && <InfoCard info={info} onClose={() => setInfo(null)} />}

      {coordsMenu && (
        <CoordsMenu
          anchor={coordsButton.current}
          at={coordsMenu}
          toast={toast}
          onClose={() => setCoordsMenu(null)}
        />
      )}

      {sheetPlace && (
        <PlaceSheet
          key={`${sheetPlace.id}${readOnly ? ":ro" : ""}`}
          place={sheetPlace}
          maps={maps}
          onClose={() => setSheetId(null)}
          onCenter={(p) => showPlace(p, true)}
          onEditShape={(p) => {
            setSheetId(null);
            chooseTool("select");
            setShapeEdit({
              id: p.id,
              points: p.points.map((x) => [...x] as LatLng),
            });
            showPlace(p, false);
          }}
        />
      )}

      {mapDialog && (
        <MapDialog
          map={mapDialog === "edit" ? currentMap : null}
          main={mapDialog === "edit" && !currentMap}
          current={{
            base,
            hidden: hiddenList,
            view: (() => {
              const m = map.current;
              if (!m) return viewOf(currentMap);
              const c = m.getCenter().wrap();
              return { lat: c.lat, lng: c.lng, zoom: m.getZoom() };
            })(),
          }}
          shown={mapId}
          onClose={() => setMapDialog(null)}
          onSelect={(id) => {
            // A new map starts from the view shown: no flight.
            if (!known.has(id)) shownMap.current = id;
            selectMap(id);
          }}
        />
      )}
      {importing && (
        <ImportDialog
          maps={maps}
          current={mapId}
          onClose={() => setImporting(false)}
          onDone={fitPoints}
        />
      )}
      {sectorDialog && map.current && (
        <SectorDialog
          view={(() => {
            const b = map.current!.getBounds();
            return [
              [b.getSouth(), b.getWest()],
              [b.getNorth(), b.getEast()],
            ] as Bounds;
          })()}
          zoom={map.current.getZoom()}
          box={sectorBox}
          base={base}
          overlays={(overlayManager.current?.tileTemplates() ?? []).map(
            (o) => ({
              id: o.id,
              url: o.url,
              label: overlayById(o.id)?.label ?? o.id,
            }),
          )}
          onDrawBox={() => {
            setSectorDialog(false);
            chooseTool("box");
          }}
          onShow={(b) => {
            setSectorDialog(false);
            fitPoints([b[0], b[1]]);
          }}
          onClose={() => setSectorDialog(false)}
        />
      )}
      {printing && map.current && (
        <PrintDialog
          mapId={mapId}
          mapName={currentMap?.name ?? MAIN_NAME}
          center={(() => {
            const c = map.current!.getCenter().wrap();
            return [c.lat, c.lng] as LatLng;
          })()}
          base={base}
          overlays={(overlayManager.current?.tileTemplates() ?? []).map(
            (o) => ({
              url: o.url,
              opacity: o.opacity,
              label: overlayById(o.id)?.label ?? o.id,
            }),
          )}
          onClose={() => setPrinting(false)}
        />
      )}
    </Ctx.Provider>
  );
}
export default MapModule;
