import type { RefObject } from "react";
import {
  Check,
  Crosshair,
  Expand,
  Grid3x3,
  House,
  Layers,
  LocateFixed,
  Lock,
  LockOpen,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  WifiOff,
  X,
} from "lucide-react";
import { Popover } from "../../ui/Popover";
import { LiveShareButton } from "./LiveLayer";
import { BASES, type BaseId } from "./bases";
import { t } from "./i18n.ts";

// Controls on the right of the map (background, zoom, lock, view), the
// menu of the backgrounds and the banner of a missing background.

export function MapControls({
  base,
  baseButton,
  baseMenu,
  onBaseMenu,
  onZoomIn,
  onZoomOut,
  readOnly,
  locked,
  onLock,
  onFitAll,
  onLocate,
  onHome,
  full,
  onFull,
}: {
  base: BaseId;
  baseButton: RefObject<HTMLButtonElement | null>;
  baseMenu: boolean;
  onBaseMenu: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  readOnly: boolean;
  locked: boolean;
  onLock: () => void;
  onFitAll: () => void;
  onLocate: () => void;
  onHome: () => void;
  full: boolean;
  onFull: () => void;
}) {
  return (
    <div className="map-controls">
      <button
        ref={baseButton}
        type="button"
        className="map-glass map-base-button"
        aria-haspopup="menu"
        aria-expanded={baseMenu}
        onClick={onBaseMenu}
      >
        <Layers size={15} />
        <span>{BASES[base].label}</span>
      </button>
      <div className="map-glass map-control-stack">
        <button
          type="button"
          className="icon-button"
          aria-label={t("Zoom avant")}
          title={t("Zoom avant")}
          onClick={onZoomIn}
        >
          <Plus size={17} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={t("Zoom arrière")}
          title={t("Zoom arrière")}
          onClick={onZoomOut}
        >
          <Minus size={17} />
        </button>
      </div>
      {!readOnly && (
        <div className="map-glass map-control-stack">
          <button
            type="button"
            className="icon-button"
            aria-pressed={locked}
            aria-label={
              locked
                ? t("Déverrouiller les objets")
                : t("Verrouiller les objets")
            }
            title={
              locked
                ? t(
                    "Objets verrouillés : aucun déplacement possible. Cliquer pour déverrouiller.",
                  )
                : t("Verrouiller les objets (évite de les déplacer par erreur)")
            }
            onClick={onLock}
          >
            {locked ? <Lock size={16} /> : <LockOpen size={16} />}
          </button>
        </div>
      )}
      <div className="map-glass map-control-stack">
        <button
          type="button"
          className="icon-button"
          aria-label={t("Voir tous les objets")}
          title={t("Voir tous les objets")}
          onClick={onFitAll}
        >
          <Expand size={16} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={t("Ma position")}
          title={t("Ma position")}
          onClick={onLocate}
        >
          <LocateFixed size={16} />
        </button>
        <LiveShareButton />
        <button
          type="button"
          className="icon-button"
          aria-label={t("Vue par défaut")}
          title={t("Revenir à la vue par défaut")}
          onClick={onHome}
        >
          <House size={16} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-pressed={full}
          aria-label={
            full ? t("Quitter le plein écran") : t("Carte en plein écran")
          }
          title={
            full
              ? t("Quitter le plein écran (Échap)")
              : t("Carte en plein écran")
          }
          onClick={onFull}
        >
          {full ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
      </div>
    </div>
  );
}

/** Backgrounds, Swiss grid, reticle and the geo.admin.ch layers. */
export function BaseMenu({
  anchor,
  base,
  onChoose,
  onClose,
  showGrid,
  onGrid,
  crosshair,
  onCrosshair,
  overlays,
  onLayers,
}: {
  anchor: HTMLElement | null;
  base: BaseId;
  onChoose: (id: BaseId) => void;
  onClose: () => void;
  showGrid: boolean;
  onGrid: () => void;
  crosshair: boolean;
  onCrosshair: () => void;
  /** Number of geo.admin.ch layers shown. */
  overlays: number;
  onLayers: () => void;
}) {
  return (
    <Popover anchor={anchor} onClose={onClose} align="end">
      {(Object.keys(BASES) as BaseId[]).map((id) => (
        <button
          key={id}
          type="button"
          role="menuitemradio"
          aria-checked={base === id}
          data-close
          className={base === id ? "active" : ""}
          onClick={() => onChoose(id)}
        >
          <span className={`map-base-swatch ${id}`} aria-hidden="true" />
          <span className="row-main">
            <strong>{BASES[id].label}</strong>
            <small className="muted">{BASES[id].hint}</small>
          </span>
          {base === id && <Check size={14} />}
        </button>
      ))}
      <hr />
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={showGrid}
        onClick={onGrid}
      >
        <Grid3x3 size={16} />
        <span className="row-main">
          <strong>{t("Quadrillage MN95")}</strong>
          <small className="muted">{t("1 km, 100 m en zoom rapproché")}</small>
        </span>
        {showGrid && <Check size={14} />}
      </button>
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={crosshair}
        onClick={onCrosshair}
      >
        <Crosshair size={16} />
        <span className="row-main">
          <strong>{t("Réticule au centre")}</strong>
          <small className="muted">
            {t("Coordonnées du centre, à copier")}
          </small>
        </span>
        {crosshair && <Check size={14} />}
      </button>
      <button type="button" role="menuitem" data-close onClick={onLayers}>
        <Layers size={16} />
        <span className="row-main">
          <strong>{t("Couches geo.admin.ch…")}</strong>
          <small className="muted">
            {t("Dangers, cadastre, crues et vent en direct")}
            {overlays ? ` · ${t("{n} affichée(s)", { n: overlays })}` : ""}
          </small>
        </span>
      </button>
    </Popover>
  );
}

/** Why the background is missing: offline, or its server does not answer. */
export function TileBanner({
  error,
  base,
  onRetry,
  onClose,
}: {
  error: "offline" | "unreachable";
  base: BaseId;
  onRetry: () => void;
  onClose: () => void;
}) {
  const tileError = error;
  return (
    <div className="map-offline map-glass" role="status">
      <WifiOff size={15} />
      <span>
        {tileError === "offline"
          ? t(
              "Hors ligne : le fond de carte n’est plus téléchargé. Les objets restent visibles ; les zones déjà consultées restent en cache.",
            )
          : t(
              "Le serveur du fond ({server}) ne répond pas. Les objets restent visibles.",
              {
                server: BASES[base].swiss ? "swisstopo" : "OpenStreetMap",
              },
            )}
      </span>
      {tileError === "unreachable" && (
        <button type="button" className="small" onClick={onRetry}>
          {t("Réessayer")}
        </button>
      )}
      <button
        type="button"
        className="icon-button"
        aria-label={t("Masquer")}
        onClick={onClose}
      >
        <X size={14} />
      </button>
    </div>
  );
}
