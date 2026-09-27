import { X } from "lucide-react";
import type { OpsMap, Place } from "../../../shared/ops";
import type { ActiveOverlays, LiveStatus } from "./overlayLayers";
import { OverlayPanel } from "./OverlayPanel";
import { LayersPanel, PlacesList } from "./panels";
import { SymbolPalette } from "./symbols";
import { t, tn } from "./i18n.ts";

// Side panel of the map: the objects of the map shown, the palette of
// signs, and the layers (the journal's and geo.admin.ch's).

export type Panel = "list" | "symbols" | "layers" | null;

export function MapPanel({
  panel,
  onPanel,
  readOnly,
  places,
  hidden,
  strays,
  onFixStrays,
  onKeepStrays,
  onHover,
  onPick,
  onNudge,
  announce,
  armed,
  onArm,
  onToggleLayer,
  onShowAll,
  ghosts,
  live,
  showGhosts,
  onGhosts,
  overlays,
  liveStatus,
  online,
  onOverlay,
  onOpacity,
}: {
  panel: Exclude<Panel, null>;
  onPanel: (panel: Panel) => void;
  readOnly: boolean;
  places: Place[];
  hidden: Set<string>;
  /** Objects left on every map by earlier versions. */
  strays: { places: Place[]; home: OpsMap | null };
  onFixStrays: () => void;
  onKeepStrays: () => void;
  onHover: (id: string | null) => void;
  onPick: (place: Place) => void;
  onNudge?: (place: Place, east: number, north: number) => void;
  announce: string;
  /** Sign placed by the point tool (undefined: another tool). */
  armed: string | undefined;
  onArm: (symbol: string) => void;
  onToggleLayer: (layer: string) => void;
  onShowAll: () => void;
  ghosts: number;
  live: { on: boolean; past: boolean; onToggle: (on: boolean) => void };
  showGhosts: boolean;
  onGhosts: (on: boolean) => void;
  overlays: ActiveOverlays;
  liveStatus: Record<string, LiveStatus>;
  online: boolean;
  onOverlay: (id: string, on: boolean) => void;
  onOpacity: (id: string, opacity: number) => void;
}) {
  return (
    <aside
      className="map-panel map-glass"
      aria-label={t("Panneau de la carte")}
    >
      <header className="map-panel-head">
        <div className="seg" role="tablist">
          <button
            type="button"
            aria-pressed={panel === "list"}
            onClick={() => onPanel("list")}
          >
            {t("Objets")} <small>{places.length}</small>
          </button>
          {!readOnly && (
            <button
              type="button"
              aria-pressed={panel === "symbols"}
              onClick={() => onPanel("symbols")}
            >
              {t("Signes")}
            </button>
          )}
          <button
            type="button"
            aria-pressed={panel === "layers"}
            onClick={() => onPanel("layers")}
          >
            {t("Calques")}
          </button>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label={t("Fermer le panneau")}
          onClick={() => onPanel(null)}
        >
          <X size={16} />
        </button>
      </header>
      <div className="map-panel-body">
        {panel === "list" &&
          strays.places.length > 0 &&
          strays.home &&
          !readOnly && (
            <div className="map-stray" role="note">
              <p>
                {tn(
                  strays.places.length,
                  "{n} objet posé avant la deuxième carte s’affiche sur toutes les cartes.",
                  "{n} objets posés avant la deuxième carte s’affichent sur toutes les cartes.",
                )}
              </p>
              <div className="map-dialog-row">
                <button
                  type="button"
                  className="small primary"
                  onClick={onFixStrays}
                >
                  {t("Garder sur « {name} » seulement", {
                    name: strays.home.name,
                  })}
                </button>
                <button type="button" className="small" onClick={onKeepStrays}>
                  {t("C’est voulu")}
                </button>
              </div>
            </div>
          )}
        {panel === "list" && (
          <PlacesList
            places={places}
            hidden={hidden}
            onHover={onHover}
            onPick={onPick}
            onNudge={onNudge}
            announce={announce}
          />
        )}
        {panel === "symbols" && <SymbolPalette value={armed} onPick={onArm} />}
        {panel === "layers" && (
          <LayersPanel
            places={places}
            hidden={hidden}
            onToggle={onToggleLayer}
            onShowAll={onShowAll}
            ghosts={ghosts}
            live={live}
            showGhosts={showGhosts}
            onGhosts={onGhosts}
          />
        )}
        {panel === "layers" && (
          <OverlayPanel
            active={overlays}
            status={liveStatus}
            online={online}
            onToggle={onOverlay}
            onOpacity={onOpacity}
          />
        )}
      </div>
    </aside>
  );
}
