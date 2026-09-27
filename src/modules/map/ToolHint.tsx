import type { ReactNode, RefObject } from "react";
import { Check, Pencil, Undo2, Wind, X } from "lucide-react";
import { formatNumber } from "../../../shared/i18n/core.ts";
import { compass, type LatLng } from "./geo";
import type { latestWind } from "./places";
import { Glyph } from "./symbols";
import { DRAWING, PLUME_ANGLES, RADII, type Plume, type Tool } from "./tools";
import { t } from "./i18n.ts";

// Bar above the tools: what the tool in use expects, its options (layer of
// the new object, radii, plume) and how to finish or leave it.

export type HintProps = {
  tool: Tool;
  /** A line or an area being reshaped. */
  shapeEdit: boolean;
  draft: LatLng[];
  measureDone: boolean;
  /** Sign placed by the point tool, and the name it will take. */
  armed: string;
  placing: string;
  drawLayer: string;
  layerOptions: string[];
  onDrawLayer: (layer: string) => void;
  ringsText: string;
  onRingsText: (text: string) => void;
  plume: Plume;
  onPlume: (patch: Partial<Plume>) => void;
  wind: ReturnType<typeof latestWind>;
  /** Live measurement, written directly while the cursor moves. */
  liveEl: RefObject<HTMLElement | null>;
  onSaveShape: () => void;
  onCancelShape: () => void;
  onClose: () => void;
  onCircle: (radius: number) => void;
  onRings: () => void;
  onSector: () => void;
  onBoxCancel: () => void;
  onUndoPoint: () => void;
  onFinish: () => void;
};

/** Content of the hint bar (null: no tool, nothing to say). */
export function toolHint({
  tool,
  shapeEdit,
  draft,
  measureDone,
  armed,
  placing,
  drawLayer,
  layerOptions,
  onDrawLayer,
  ringsText,
  onRingsText,
  plume,
  onPlume,
  wind,
  liveEl,
  onSaveShape,
  onCancelShape,
  onClose,
  onCircle,
  onRings,
  onSector,
  onBoxCancel,
  onUndoPoint,
  onFinish,
}: HintProps): ReactNode {
  const drawing = DRAWING.includes(tool);
  let hint: ReactNode = null;
  if (shapeEdit)
    hint = (
      <>
        <span>
          {t(
            "Glissez les sommets · cliquez un sommet pour le retirer · « + » pour en ajouter",
          )}
        </span>
        <button type="button" className="small primary" onClick={onSaveShape}>
          <Check size={13} />
          {t("Enregistrer")}
        </button>
        <button type="button" className="small" onClick={onCancelShape}>
          {t("Annuler")}
        </button>
      </>
    );
  else if (tool === "point")
    hint = (
      <>
        <Glyph symbol={armed} size={24} />
        <span>
          {t("Cliquez sur la carte pour placer « {name} »", {
            name: placing,
          })}
        </span>
        <button
          type="button"
          className="icon-button"
          aria-label={t("Annuler le placement")}
          onClick={onClose}
        >
          <X size={15} />
        </button>
      </>
    );
  else if (tool === "freehand")
    hint = (
      <>
        <Pencil size={15} aria-hidden="true" />
        <span>
          {t(
            "Dessinez à la souris ou au doigt · chaque trait devient un tracé",
          )}
        </span>
        <select
          className="map-hint-layer"
          value={drawLayer}
          aria-label={t("Calque des traits")}
          onChange={(e) => onDrawLayer(e.target.value)}
        >
          {[...new Set([...layerOptions, drawLayer])].map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="icon-button"
          aria-label={t("Fermer le dessin libre")}
          onClick={onClose}
        >
          <X size={15} />
        </button>
      </>
    );
  else if (tool === "text")
    hint = (
      <>
        <span>{t("Cliquez à l’endroit où écrire le texte.")}</span>
        <button
          type="button"
          className="icon-button"
          aria-label={t("Annuler")}
          onClick={onClose}
        >
          <X size={15} />
        </button>
      </>
    );
  else if (tool === "circle")
    hint = (
      <>
        <span>
          {draft.length
            ? t("Cliquez pour fixer le rayon, ou choisissez :")
            : t("Cliquez le centre du périmètre")}
        </span>
        {draft.length > 0 && (
          <>
            {RADII.map((r) => (
              <button
                key={r}
                type="button"
                className="small"
                onClick={() => onCircle(r)}
              >
                {r < 1000
                  ? `${formatNumber(r)} m`
                  : `${formatNumber(r / 1000)} km`}
              </button>
            ))}
            <strong className="mono map-live" ref={liveEl} />
            <span className="map-hint-rings">
              <input
                className="mono"
                value={ringsText}
                size={14}
                aria-label={t(
                  "Rayons des anneaux, en mètres (ex. 100, 300, 1000)",
                )}
                title={t("Rayons des anneaux concentriques, en m (ou km)")}
                onChange={(e) => onRingsText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onRings();
                }}
              />
              <button
                type="button"
                className="small primary"
                onClick={() => onRings()}
              >
                {t("Anneaux")}
              </button>
            </span>
          </>
        )}
        <select
          className="map-hint-layer"
          value={drawLayer}
          aria-label={t("Calque du périmètre")}
          onChange={(e) => onDrawLayer(e.target.value)}
        >
          {[...new Set([...layerOptions, drawLayer])].map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="icon-button"
          aria-label={t("Fermer l’outil")}
          onClick={onClose}
        >
          <X size={15} />
        </button>
      </>
    );
  else if (tool === "sector") {
    const setPl = onPlume;
    hint = (
      <>
        <span>
          {draft.length
            ? t("Cliquez la direction et la longueur, ou saisissez-les :")
            : t("Cliquez l’origine du panache (source, foyer)")}
        </span>
        <label className="map-hint-field">
          <span>{t("Vers")}</span>
          <input
            type="number"
            className="mono"
            min={0}
            max={359}
            value={plume.bearing}
            aria-label={t("Direction du panache, en degrés depuis le nord")}
            onChange={(e) =>
              setPl({ bearing: ((Number(e.target.value) % 360) + 360) % 360 })
            }
          />
          °
        </label>
        {wind && (
          <button
            type="button"
            className="small"
            title={
              wind.speed !== null
                ? t(
                    "Vent de {dir} ({deg}°), {speed} km/h · prévision {place}",
                    {
                      dir: compass(wind.from),
                      deg: Math.round(wind.from),
                      speed: Math.round(wind.speed),
                      place: wind.place || "",
                    },
                  )
                : t("Vent de {dir} ({deg}°) · prévision {place}", {
                    dir: compass(wind.from),
                    deg: Math.round(wind.from),
                    place: wind.place || "",
                  })
            }
            onClick={() => setPl({ bearing: Math.round(wind.towards) })}
          >
            <Wind size={13} />
            {t("Vent actuel")}
          </button>
        )}
        <select
          className="map-hint-layer"
          value={plume.angle}
          aria-label={t("Ouverture du secteur")}
          onChange={(e) => setPl({ angle: Number(e.target.value) })}
        >
          {[...new Set([...PLUME_ANGLES, plume.angle])].map((a) => (
            <option key={a} value={a}>
              {a}°
            </option>
          ))}
        </select>
        <label className="map-hint-field">
          <span>{t("Long.")}</span>
          <input
            type="number"
            className="mono"
            min={10}
            max={50000}
            step={50}
            value={plume.length}
            aria-label={t("Longueur du panache, en mètres")}
            onChange={(e) =>
              setPl({
                length: Math.max(
                  10,
                  Math.min(50000, Number(e.target.value) || 0),
                ),
              })
            }
          />
          m
        </label>
        {draft.length > 0 && (
          <>
            <strong className="mono map-live" ref={liveEl} />
            <button type="button" className="small primary" onClick={onSector}>
              <Check size={13} />
              {t("Créer")}
            </button>
          </>
        )}
        <button
          type="button"
          className="icon-button"
          aria-label={t("Fermer l’outil")}
          onClick={onClose}
        >
          <X size={15} />
        </button>
      </>
    );
  } else if (tool === "box")
    hint = (
      <>
        <span>
          {draft.length
            ? t("Cliquez le coin opposé du secteur à garder hors ligne")
            : t("Cliquez un coin du secteur à garder hors ligne")}
        </span>
        <strong className="mono map-live" ref={liveEl} />
        <button
          type="button"
          className="icon-button"
          aria-label={t("Annuler")}
          onClick={onBoxCancel}
        >
          <X size={15} />
        </button>
      </>
    );
  else if (drawing)
    hint = (
      <>
        <span>
          {tool === "measure"
            ? measureDone
              ? t("Mesure terminée · cliquez pour recommencer")
              : draft.length
                ? t("Double-clic pour terminer la mesure")
                : t("Cliquez des points pour mesurer")
            : draft.length
              ? t("Double-clic ou « Terminer » pour finir · Échap pour annuler")
              : tool === "line"
                ? t("Cliquez pour tracer la ligne, point par point")
                : t("Cliquez les coins de la zone")}
        </span>
        <strong className="mono map-live" ref={liveEl} />
        {tool !== "measure" && (
          <select
            className="map-hint-layer"
            value={drawLayer}
            aria-label={t("Calque du nouvel objet")}
            onChange={(e) => onDrawLayer(e.target.value)}
          >
            {[...new Set([...layerOptions, drawLayer])].map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        )}
        {draft.length > 0 && !measureDone && (
          <button
            type="button"
            className="icon-button"
            aria-label={t("Retirer le dernier point")}
            title={t("Retirer le dernier point (⌫)")}
            onClick={onUndoPoint}
          >
            <Undo2 size={15} />
          </button>
        )}
        {tool !== "measure" && draft.length >= (tool === "area" ? 3 : 2) && (
          <button type="button" className="small primary" onClick={onFinish}>
            <Check size={13} />
            {t("Terminer")}
          </button>
        )}
        <button
          type="button"
          className="icon-button"
          aria-label={t("Fermer l’outil")}
          onClick={onClose}
        >
          <X size={15} />
        </button>
      </>
    );
  return hint;
}
