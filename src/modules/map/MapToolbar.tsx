import type { RefObject } from "react";
import {
  CircleDashed,
  Copy,
  Crosshair,
  List,
  MapPin,
  MousePointer2,
  Pencil,
  Pentagon,
  Redo2,
  Ruler,
  Spline,
  Type,
  Undo2,
  Wind,
  type LucideIcon,
} from "lucide-react";
import type { Tool } from "./tools";
import { t } from "./i18n.ts";

// Bottom of the map: the coordinates of the cursor (or of the centre) and
// the tool bar, with undo / redo and the side panel.

const TOOLS: {
  id: Tool;
  readonly label: string;
  icon: LucideIcon;
  write: boolean;
  readonly hint: string;
}[] = [
  {
    id: "select",
    get label() {
      return t("Sélection");
    },
    icon: MousePointer2,
    write: false,
    get hint() {
      return t("Sélectionner et déplacer");
    },
  },
  {
    id: "point",
    get label() {
      return t("Point");
    },
    icon: MapPin,
    write: true,
    get hint() {
      return t("Placer un signe");
    },
  },
  {
    id: "line",
    get label() {
      return t("Ligne");
    },
    icon: Spline,
    write: true,
    get hint() {
      return t("Tracer une ligne ou un itinéraire");
    },
  },
  {
    id: "area",
    get label() {
      return t("Zone");
    },
    icon: Pentagon,
    write: true,
    get hint() {
      return t("Dessiner une zone");
    },
  },
  {
    id: "circle",
    get label() {
      return t("Périmètre");
    },
    icon: CircleDashed,
    write: true,
    get hint() {
      return t("Périmètre circulaire : un centre, un rayon");
    },
  },
  {
    id: "sector",
    get label() {
      return t("Panache");
    },
    icon: Wind,
    write: true,
    get hint() {
      return t(
        "Secteur ou panache depuis un point : direction, ouverture et longueur (vent)",
      );
    },
  },
  {
    id: "freehand",
    get label() {
      return t("Dessin");
    },
    icon: Pencil,
    write: true,
    get hint() {
      return t("Dessin libre, à la souris ou au doigt");
    },
  },
  {
    id: "text",
    get label() {
      return t("Texte");
    },
    icon: Type,
    write: true,
    get hint() {
      return t("Écrire un texte sur la carte");
    },
  },
  {
    id: "measure",
    get label() {
      return t("Mesurer");
    },
    icon: Ruler,
    write: false,
    get hint() {
      return t("Mesurer une distance ou une surface");
    },
  },
];

export function MapToolbar({
  tool,
  readOnly,
  crosshair,
  coordsButton,
  coordsEl,
  coordsOpen,
  onCoords,
  onTool,
  canUndo,
  canRedo,
  onStep,
  panelOpen,
  onList,
}: {
  tool: Tool;
  readOnly: boolean;
  crosshair: boolean;
  coordsButton: RefObject<HTMLButtonElement | null>;
  /** Text of the coordinates, written directly while the cursor moves. */
  coordsEl: RefObject<HTMLSpanElement | null>;
  coordsOpen: boolean;
  onCoords: () => void;
  onTool: (tool: Tool) => void;
  canUndo: boolean;
  canRedo: boolean;
  onStep: (direction: "undo" | "redo") => void;
  panelOpen: boolean;
  onList: () => void;
}) {
  const tools = TOOLS.filter((t) => !readOnly || !t.write);
  return (
    <div className="map-bottom">
      <button
        ref={coordsButton}
        type="button"
        className="map-coords map-glass"
        title={
          crosshair
            ? t("Centre de la carte : cliquer pour copier (MN95 ou WGS84)")
            : t("Position du curseur : cliquer pour copier (MN95 ou WGS84)")
        }
        aria-haspopup="menu"
        aria-expanded={coordsOpen}
        onClick={onCoords}
      >
        <Crosshair size={13} />
        <span ref={coordsEl} className="mono" />
        <Copy size={12} className="map-coords-copy" />
      </button>
      <nav
        className="map-toolbar map-glass"
        aria-label={t("Outils de la carte")}
      >
        {tools.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              className={`map-tool${tool === t.id ? " on" : ""}`}
              aria-pressed={tool === t.id}
              title={t.hint}
              onClick={() =>
                onTool(tool === t.id && t.id !== "select" ? "select" : t.id)
              }
            >
              <Icon size={18} />
              <span>{t.label}</span>
            </button>
          );
        })}
        <i className="map-toolbar-sep" aria-hidden="true" />
        {!readOnly && (
          <>
            <button
              type="button"
              className="map-tool icon"
              aria-label={t("Annuler la dernière opération sur la carte")}
              title={t("Annuler (⌘Z / Ctrl+Z) : opérations de ce poste")}
              disabled={!canUndo}
              onClick={() => onStep("undo")}
            >
              <Undo2 size={18} />
            </button>
            <button
              type="button"
              className="map-tool icon"
              aria-label={t("Rétablir l’opération annulée")}
              title={t("Rétablir (⇧⌘Z / Ctrl+Y)")}
              disabled={!canRedo}
              onClick={() => onStep("redo")}
            >
              <Redo2 size={18} />
            </button>
            <i className="map-toolbar-sep" aria-hidden="true" />
          </>
        )}
        <button
          type="button"
          className={`map-tool${panelOpen ? " on" : ""}`}
          aria-pressed={panelOpen}
          title={t("Liste des objets, signes et calques")}
          onClick={onList}
        >
          <List size={18} />
          <span>{t("Liste")}</span>
        </button>
      </nav>
    </div>
  );
}
