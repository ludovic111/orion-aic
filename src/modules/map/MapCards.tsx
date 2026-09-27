import { createPortal } from "react-dom";
import { Copy, MapPin, X } from "lucide-react";
import type { Ref } from "../../../shared/links";
import { formatMN95 } from "../../../shared/coordinates";
import { ItemPreview } from "../../ui/links";
import { Popover } from "../../ui/Popover";
import { formatPosition, formatWgs, mn95Text, type LatLng } from "./geo";
import type { Ghost } from "./places";
import { t } from "./i18n.ts";

// Cards floating over the map: what an object is linked to (hover), a
// position cited in the journal, the answer of a geo.admin.ch layer, and the
// coordinates to copy.

export type Hover = { target: Ref; x: number; y: number; hint: string };
/** Information card: a live measurement or the answer of a layer. */
export type Info = {
  x: number;
  y: number;
  items: { title: string; source: string; rows: [string, string][] }[];
  loading?: boolean;
  error?: string;
};

export function MapHover({ hover }: { hover: Hover }) {
  const left = Math.max(8, Math.min(hover.x + 18, window.innerWidth - 336));
  const top =
    hover.y + 300 > window.innerHeight
      ? Math.max(8, hover.y - 300)
      : hover.y + 18;
  return createPortal(
    <div
      className="hovercard map-hovercard"
      style={{ left, top }}
      role="tooltip"
    >
      <ItemPreview target={hover.target} limit={10} />
      {hover.hint && <footer>{hover.hint}</footer>}
    </div>,
    document.body,
  );
}

/** A position cited by an entry or a message: place it, or open the item. */
export function GhostCard({
  ghost,
  readOnly,
  onCreate,
  onOpen,
  onClose,
}: {
  ghost: Ghost & { x: number; y: number };
  readOnly: boolean;
  onCreate: () => void;
  onOpen: () => void;
  onClose: () => void;
}) {
  return createPortal(
    <div
      className="hovercard map-ghost-card"
      style={{
        left: Math.max(8, Math.min(ghost.x + 12, window.innerWidth - 336)),
        top: Math.max(8, Math.min(ghost.y + 12, window.innerHeight - 320)),
      }}
      role="dialog"
      aria-label={t("Position citée")}
    >
      <ItemPreview target={ghost.target} limit={5} />
      <p className="map-ghost-where mono">
        {formatPosition(ghost.lat, ghost.lng)}
      </p>
      <div className="map-ghost-actions">
        {!readOnly && (
          <button type="button" className="small primary" onClick={onCreate}>
            <MapPin size={13} />
            {t("Créer un objet ici")}
          </button>
        )}
        <button type="button" className="small" onClick={onOpen}>
          {t("Ouvrir")}
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={t("Fermer")}
          onClick={onClose}
        >
          <X size={14} />
        </button>
      </div>
    </div>,
    document.body,
  );
}

/** What the geo.admin.ch layers shown say about the place clicked. */
export function InfoCard({
  info,
  onClose,
}: {
  info: Info;
  onClose: () => void;
}) {
  return createPortal(
    <div
      className="hovercard map-info-card"
      style={{
        left: Math.max(8, Math.min(info.x + 12, window.innerWidth - 336)),
        top: Math.max(8, Math.min(info.y + 12, window.innerHeight - 340)),
      }}
      role="dialog"
      aria-label={t("Informations de la couche")}
    >
      <header>
        <span className="label">
          {info.loading
            ? t("Recherche…")
            : (info.items[0]?.source ?? "geo.admin.ch")}
        </span>
        <button
          type="button"
          className="icon-button"
          aria-label={t("Fermer")}
          onClick={onClose}
        >
          <X size={14} />
        </button>
      </header>
      {info.error && <p className="muted">{info.error}</p>}
      {info.items.map((item, i) => (
        <section key={i}>
          <strong>{item.title}</strong>
          {item.rows.length > 0 && (
            <dl>
              {item.rows.map(([k, v], j) => (
                <div key={j}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      ))}
    </div>,
    document.body,
  );
}

/** Coordinates of the cursor or of the centre, to copy in MN95 or WGS84. */
export function CoordsMenu({
  anchor,
  at,
  toast,
  onClose,
}: {
  anchor: HTMLElement | null;
  at: LatLng;
  toast: (text: string) => void;
  onClose: () => void;
}) {
  const [lat, lng] = at;
  const mn95 = mn95Text(lat, lng);
  const copy = (
    text: string,
    done:
      | "Coordonnées MN95 copiées : {text}"
      | "Coordonnées WGS84 copiées : {text}",
  ) => {
    navigator.clipboard?.writeText(text).then(
      () => toast(t(done, { text })),
      () => toast(t("Copie impossible.")),
    );
  };
  return (
    <Popover anchor={anchor} onClose={onClose}>
      {mn95 && (
        <button
          type="button"
          role="menuitem"
          data-close
          onClick={() => copy(mn95, "Coordonnées MN95 copiées : {text}")}
        >
          <Copy size={14} />
          <span className="row-main">
            <strong>{t("MN95")}</strong>
            <small className="mono">{formatMN95(lat, lng)}</small>
          </span>
        </button>
      )}
      <button
        type="button"
        role="menuitem"
        data-close
        onClick={() =>
          copy(formatWgs(lat, lng), "Coordonnées WGS84 copiées : {text}")
        }
      >
        <Copy size={14} />
        <span className="row-main">
          <strong>WGS84</strong>
          <small className="mono">{formatWgs(lat, lng)}</small>
        </span>
      </button>
    </Popover>
  );
}
