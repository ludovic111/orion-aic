import type { Dispatch, SetStateAction } from "react";
import type L from "leaflet";
import type { Journal } from "../../../shared/journal";
import {
  journalLang,
  upsert,
  type InputOf,
  type OpsMap,
  type Place,
} from "../../../shared/ops";
import { addLink, parseRef, ref, type Ref } from "../../../shared/links";
import type { Unit } from "../../../shared/live";
import type { AppContext } from "../../app/context";
import {
  bearingOf,
  circlePoints,
  compass,
  formatDistance,
  formatPosition,
  lengthOf,
  sectorPoints,
  type LatLng,
} from "./geo";
import { describeSymbol, rememberSymbol, type SymbolInfo } from "./symbols";
import { narrow, writeStore } from "./browser";
import {
  DRAWING,
  boxOf,
  dropRepeats,
  round6,
  type Plume,
  type Tool,
} from "./tools";
import { layerForKind, symbolForKind, type Ghost, type Layers } from "./places";
import type { Bounds } from "./tilecache";
import type { Hover, Info } from "./MapCards";
import type { Panel } from "./MapPanel";
import type { ShapeEdit } from "./useShapeEditor";
import type { Handlers, MapCore } from "./useLeafletMap";
import { t } from "./i18n.ts";

// What the tools write: new objects (signs, lines, zones, perimeters,
// plumes, texts), reshaped lines and areas; and what the map does on a
// click, a hover or a drag (the handlers of the Leaflet events).

type Setter<T> = Dispatch<SetStateAction<T>>;

export type DrawContext = {
  core: MapCore;
  journal: Journal;
  author: string;
  readOnly: boolean;
  locked: boolean;
  toast: AppContext["toast"];
  updateOps: AppContext["updateOps"];
  catalog: SymbolInfo[] | null;
  currentMap: OpsMap | null;
  byId: Map<string, Place>;
  layers: Layers;
  drawLayer: string;
  tool: Tool;
  draft: LatLng[];
  measureDone: boolean;
  armed: string;
  pending: { target: Ref; title: string } | null;
  shapeEdit: ShapeEdit | null;
  panel: Panel;
  hoverTimer: { current: ReturnType<typeof setTimeout> | undefined };
  setTool: Setter<Tool>;
  setDraft: Setter<LatLng[]>;
  setMeasureDone: Setter<boolean>;
  setShapeEdit: Setter<ShapeEdit | null>;
  setGhostMenu: Setter<(Ghost & { x: number; y: number }) | null>;
  setPending: Setter<{ target: Ref; title: string } | null>;
  setPanel: Setter<Panel>;
  setSheetId: Setter<string | null>;
  setPlume: Setter<Plume>;
  setHover: Setter<Hover | null>;
  setInfo: Setter<Info | null>;
  setSectorBox: Setter<Bounds | null>;
  setSectorDialog: Setter<boolean>;
};

export function drawActions({
  core: { map, state, handlers },
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
}: DrawContext) {
  function create(
    place: Omit<InputOf<"places">, "id" | "createdAt" | "updatedAt" | "by">,
    link?: Ref,
  ) {
    // Past version or closed journal: nothing is written.
    if (state.current.readOnly) return null;
    const id = crypto.randomUUID();
    // Drawn on a named map: belongs to it, even while it is the only one
    // (a map created later starts empty).
    const own = currentMap ? [currentMap.id] : [];
    try {
      updateOps((ops) => {
        const next = upsert(ops, "places", { maps: own, ...place, id }, author);
        return link
          ? addLink(next, ref("place", id), link, t("position"), author)
          : next;
      });
      return id;
    } catch (err) {
      toast((err as Error).message);
      return null;
    }
  }

  /**
   * Several areas in one change (concentric rings), each linked to the
   * first so that hovering one shows the others.
   */
  function createMany(
    list: Omit<InputOf<"places">, "id" | "createdAt" | "updatedAt" | "by">[],
  ) {
    if (state.current.readOnly || !list.length) return [];
    const own = currentMap ? [currentMap.id] : [];
    const ids = list.map(() => crypto.randomUUID());
    try {
      updateOps((ops) => {
        let next = ops;
        list.forEach((place, i) => {
          next = upsert(
            next,
            "places",
            { maps: own, ...place, id: ids[i] },
            author,
          );
          if (i)
            next = addLink(
              next,
              ref("place", ids[0]),
              ref("place", ids[i]),
              t("périmètre"),
              author,
            );
        });
        return next;
      });
      return ids;
    } catch (err) {
      toast((err as Error).message);
      return [];
    }
  }

  /** Concentric perimeters (e.g. 100 / 300 / 1000 m) around a point. */
  function createRings(center: LatLng, radii: number[]) {
    if (!radii.length)
      return toast(t("Indiquez des rayons, par exemple « 100, 300, 1000 »."));
    const where = formatPosition(center[0], center[1]);
    const ids = createMany(
      radii.map((r, i) => ({
        label: t("Périmètre {d}", { d: formatDistance(r) }),
        kind: "area" as const,
        symbol: "",
        color: "",
        layer: drawLayer,
        points: circlePoints(center, r),
        notes: t("Centre {where} · rayon {r} · anneau {i} sur {n}", {
          where,
          r: formatDistance(r),
          i: i + 1,
          n: radii.length,
        }),
        dash: i ? ("dash" as const) : ("solid" as const),
      })),
    );
    if (!ids.length) return;
    toast(t("{n} périmètres créés et reliés.", { n: ids.length }));
    chooseTool("select");
    setSheetId(ids[0]);
  }

  /** Plume or wind sector from a point, as a normal area. */
  function createSector(apex: LatLng, bearing: number, length: number) {
    if (length < 10) return toast(t("Longueur trop courte : au moins 10 m."));
    const b = ((Math.round(bearing) % 360) + 360) % 360;
    const { angle } = state.current.plume;
    const id = create({
      label: t("Panache {dir} · {len}", {
        dir: compass(b),
        len: formatDistance(length),
      }),
      kind: "area",
      symbol: "",
      color: "",
      layer: drawLayer === layers.effects ? layers.dangers : drawLayer,
      points: sectorPoints(apex, b, angle, length),
      notes: t(
        "Origine {where} · direction {deg}° ({dir}) · ouverture {angle}° · longueur {len}",
        {
          where: formatPosition(apex[0], apex[1]),
          deg: b,
          dir: compass(b),
          angle,
          len: formatDistance(length),
        },
      ),
    });
    if (!id) return;
    const next = {
      ...state.current.plume,
      bearing: b,
      length: Math.round(length),
    };
    setPlume(next);
    writeStore("orion.map.plume", next);
    chooseTool("select");
    setSheetId(id);
  }

  function chooseTool(next: Tool) {
    setDraft([]);
    setMeasureDone(false);
    setShapeEdit(null);
    setGhostMenu(null);
    if (next !== "point") setPending(null);
    setTool(next);
    if (next === "point") setPanel("symbols");
    else if (panel === "symbols") setPanel(narrow() ? null : "list");
  }

  function placePoint(at: L.LatLng) {
    const info = describeSymbol(armed, catalog, journalLang(journal.ops));
    const target = pending?.target;
    const id = create(
      {
        label: (pending?.title ?? info.name).slice(0, 200),
        kind: "point",
        symbol: armed,
        color: "",
        layer: target
          ? layerForKind(parseRef(target).kind, layers)
          : info.layer,
        points: [[round6(at.lat), round6(at.lng)]],
        notes: "",
      },
      target,
    );
    if (!id) return;
    rememberSymbol(armed);
    if (pending)
      toast(t("« {title} » est placé sur la carte.", { title: pending.title }));
    setPending(null);
    chooseTool("select");
    setSheetId(id);
  }

  function finish() {
    const m = map.current;
    const { tool: tl, draft: raw, readOnly: locked } = state.current;
    if (
      !m ||
      !DRAWING.includes(tl) ||
      tl === "circle" ||
      tl === "sector" ||
      tl === "box" ||
      (locked && tl !== "measure")
    )
      return;
    // A double click adds the same vertex twice.
    const pts = dropRepeats(raw, (a, b) =>
      m.latLngToContainerPoint(a).distanceTo(m.latLngToContainerPoint(b)),
    );
    if (tl === "measure") {
      setDraft(pts);
      setMeasureDone(true);
      return;
    }
    if (tl === "line" && pts.length < 2)
      return toast(t("Un tracé demande au moins deux points."));
    if (tl === "area" && pts.length < 3)
      return toast(t("Une zone demande au moins trois points."));
    const id = create({
      label: "",
      kind: tl === "area" ? "area" : "line",
      symbol: "",
      color: "",
      layer: drawLayer,
      points: pts.slice(0, 2000),
      notes: "",
    });
    if (!id) return;
    chooseTool("select");
    setSheetId(id);
  }

  /** A perimeter: an area drawn as a circle, labelled with its radius. */
  function createCircle(center: LatLng, radius: number) {
    if (radius < 5) return toast(t("Rayon trop petit : au moins 5 m."));
    const id = create({
      label: t("Périmètre {d}", { d: formatDistance(radius) }),
      kind: "area",
      symbol: "",
      color: "",
      layer: drawLayer,
      points: circlePoints(center, radius),
      notes: t("Centre {where} · rayon {r}", {
        where: formatPosition(center[0], center[1]),
        r: formatDistance(radius),
      }),
    });
    if (!id) return;
    chooseTool("select");
    setSheetId(id);
  }

  function saveShape() {
    if (!shapeEdit) return;
    if (readOnly) return setShapeEdit(null);
    const p = byId.get(shapeEdit.id);
    if (!p) return setShapeEdit(null);
    try {
      updateOps((ops) =>
        upsert(ops, "places", { ...p, points: shapeEdit.points }, author),
      );
      toast(t("Forme enregistrée."));
    } catch (err) {
      toast((err as Error).message);
    }
    setShapeEdit(null);
  }

  function createFromGhost(g: Ghost) {
    const kind = parseRef(g.target).kind;
    const id = create(
      {
        label: g.title.slice(0, 200),
        kind: "point",
        symbol: symbolForKind(kind),
        color: "",
        layer: layerForKind(kind, layers),
        points: [[round6(g.lat), round6(g.lng)]],
        notes: "",
      },
      g.target,
    );
    setGhostMenu(null);
    if (id) setSheetId(id);
  }

  /** « Créer un point ici » from a live position: an ordinary object. */
  function createFromLive(u: Unit) {
    const kind = u.ref ? parseRef(u.ref as Ref).kind : "";
    const id = create(
      {
        label: (u.label || u.name).slice(0, 200),
        kind: "point",
        symbol: symbolForKind(kind),
        color: "",
        layer: layers.means,
        points: [[round6(u.lat), round6(u.lng)]],
        notes: "",
      },
      u.ref ? (u.ref as Ref) : undefined,
    );
    if (id) setSheetId(id);
  }

  /**
   * The handlers of the Leaflet events (registered once, called through
   * the handlers ref: the latest state). `identify` asks the geo.admin.ch
   * layers shown; the others keep the map in step after a move.
   */
  function mapHandlers({
    identify,
    moved,
  }: {
    identify: (at: L.LatLng) => Promise<void>;
    moved: () => void;
  }): Handlers {
    return {
      moved,
      mapClick: (at) => {
        setGhostMenu(null);
        setInfo(null);
        // The sheet of an object stays beside the map: a click elsewhere
        // on the map closes it; the layers shown may say what is there.
        if (tool === "select") {
          setSheetId(null);
          void identify(at);
          return;
        }
        if (tool === "freehand") return;
        if (readOnly && tool !== "measure" && tool !== "box") return;
        const pt: LatLng = [round6(at.lat), round6(at.wrap().lng)];
        if (tool === "box") {
          if (!draft.length) return setDraft([pt]);
          setSectorBox(boxOf(draft[0], pt));
          chooseTool("select");
          setSectorDialog(true);
          return;
        }
        if (tool === "sector") {
          if (!draft.length) return setDraft([pt]);
          createSector(
            draft[0],
            bearingOf(draft[0], pt),
            lengthOf([draft[0], pt]),
          );
          return;
        }
        if (tool === "point") placePoint(at.wrap());
        else if (tool === "text") {
          const id = create({
            label: t("Texte"),
            kind: "text",
            symbol: "",
            color: "",
            layer: layers.other,
            points: [pt],
            notes: "",
          });
          if (id) {
            chooseTool("select");
            setSheetId(id);
          }
        } else if (tool === "circle") {
          if (!draft.length) setDraft([pt]);
          else createCircle(draft[0], lengthOf([draft[0], pt]));
        } else if (tool === "measure" && measureDone) {
          setDraft([pt]);
          setMeasureDone(false);
        } else if (draft.length < 500) setDraft((d) => [...d, pt]);
      },
      finish,
      freehand: (points) => {
        if (readOnly) return;
        create({
          label: "",
          kind: "line",
          symbol: "",
          color: "",
          layer: drawLayer,
          points,
          notes: "",
        });
      },
      style: (id, style) => {
        const p = byId.get(id);
        if (!p || readOnly) return;
        try {
          updateOps((ops) => upsert(ops, "places", { ...p, ...style }, author));
        } catch (err) {
          toast((err as Error).message);
        }
      },
      placeClick: (id, at) => {
        if (tool === "select") {
          clearTimeout(hoverTimer.current);
          setHover(null);
          setSheetId(id);
        } else handlers.current.mapClick(at);
      },
      placeOver: (id, e) => {
        if ((DRAWING.includes(tool) && draft.length) || tool === "freehand")
          return;
        clearTimeout(hoverTimer.current);
        const x = e.clientX;
        const y = e.clientY;
        hoverTimer.current = setTimeout(
          () =>
            setHover({
              target: ref("place", id),
              x,
              y,
              hint:
                tool === "select"
                  ? readOnly || locked
                    ? t("Cliquer pour ouvrir")
                    : t("Cliquer pour ouvrir · glisser pour déplacer")
                  : "",
            }),
          120,
        );
      },
      placeOut: () => {
        clearTimeout(hoverTimer.current);
        hoverTimer.current = setTimeout(() => setHover(null), 60);
      },
      placeMoved: (id, at) => {
        const p = byId.get(id);
        if (!p || readOnly) return;
        try {
          updateOps((ops) =>
            upsert(
              ops,
              "places",
              { ...p, points: [[round6(at.lat), round6(at.wrap().lng)]] },
              author,
            ),
          );
        } catch (err) {
          toast((err as Error).message);
        }
      },
      ghostOver: (g, e) => {
        clearTimeout(hoverTimer.current);
        const { clientX: x, clientY: y } = e;
        hoverTimer.current = setTimeout(
          () =>
            setHover({
              target: g.target,
              x,
              y,
              hint: t("Position citée · cliquer pour la placer"),
            }),
          120,
        );
      },
      ghostClick: (g, e) => {
        clearTimeout(hoverTimer.current);
        setHover(null);
        setGhostMenu({ ...g, x: e.clientX, y: e.clientY });
      },
    };
  }

  return {
    create,
    createRings,
    createSector,
    chooseTool,
    placePoint,
    finish,
    createCircle,
    saveShape,
    createFromGhost,
    createFromLive,
    mapHandlers,
  };
}
