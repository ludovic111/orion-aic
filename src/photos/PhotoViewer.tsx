import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ImageOff, Trash2, X } from "lucide-react";
import { dateTime } from "../../shared/journal";
import { pictureOf, type Photo } from "../../shared/photos";
import { removeRecords, upsert } from "../../shared/ops";
import { useApp } from "../app/context";
import { escapedJustNow, useLayer } from "../ui/overlay";
import { t } from "./i18n.ts";

/**
 * A photo on the whole screen: previous / next (arrows, swipe), legend,
 * delete with confirmation. Above any dialog (top layer).
 */
export function PhotoViewer({
  photos,
  index,
  onIndex,
  onClose,
}: {
  photos: Photo[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
}) {
  const { journal, readOnly, canWrite, updateOps, author, toast } = useApp();
  const ref = useRef<HTMLDialogElement>(null);
  const [confirming, setConfirming] = useState(false);
  const photo = photos[Math.min(index, photos.length - 1)];
  const [caption, setCaption] = useState(photo?.caption ?? "");
  const state = useRef({ onClose, index, count: photos.length, onIndex });
  state.current = { onClose, index, count: photos.length, onIndex };
  const close = () => state.current.onClose();
  useLayer(ref, { kind: "modal", onEscape: close });
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);
  useEffect(() => {
    setCaption(photo?.caption ?? "");
    setConfirming(false);
  }, [photo?.id, photo?.caption]);
  // The last photo removed (here or by another post): nothing left to show.
  useEffect(() => {
    if (!photos.length) state.current.onClose();
    else if (index >= photos.length) state.current.onIndex(photos.length - 1);
  }, [photos.length, index]);
  const go = (step: number) => {
    const { index: i, count } = state.current;
    if (count > 1) state.current.onIndex((i + step + count) % count);
  };
  const swipe = useRef<{ x: number; y: number } | null>(null);
  if (!photo) return null;
  const picture = pictureOf(photo, journal.blobs);
  function saveCaption() {
    if (readOnly || caption.trim() === photo.caption) return;
    if (!canWrite()) return;
    try {
      updateOps((ops) =>
        upsert(ops, "photos", { ...photo, caption: caption.trim() }, author),
      );
      toast(t("Légende enregistrée."));
    } catch (err) {
      toast((err as Error).message);
    }
  }
  function remove() {
    if (!canWrite()) return;
    try {
      updateOps((ops) => removeRecords(ops, [photo.id]));
      toast(t("Photo supprimée."));
    } catch (err) {
      toast((err as Error).message);
    }
    setConfirming(false);
  }
  return (
    <dialog
      ref={ref}
      className="photo-viewer"
      aria-label={t("Photo {n} sur {count}", {
        n: index + 1,
        count: photos.length,
      })}
      onCancel={(e) => {
        e.preventDefault();
        if (!escapedJustNow()) close();
      }}
      onKeyDown={(e) => {
        if ((e.target as HTMLElement).closest("input, textarea")) return;
        if (e.key === "ArrowLeft") go(-1);
        if (e.key === "ArrowRight") go(1);
      }}
    >
      <header className="photo-viewer-head">
        <span className="mono">
          {index + 1} / {photos.length}
        </span>
        <span className="photo-viewer-meta">
          {t("Ajoutée par {name} · {when}", {
            name: photo.by || "—",
            when: dateTime(photo.createdAt),
          })}
        </span>
        <button
          type="button"
          className="photo-viewer-close"
          onClick={close}
          aria-label={t("Fermer la photo")}
        >
          <X size={24} />
        </button>
      </header>
      <figure
        className="photo-viewer-figure"
        onPointerDown={(e) => {
          swipe.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerUp={(e) => {
          const from = swipe.current;
          swipe.current = null;
          if (!from) return;
          const dx = e.clientX - from.x;
          if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(e.clientY - from.y))
            go(dx < 0 ? 1 : -1);
        }}
      >
        {picture ? (
          <img
            src={picture}
            alt={
              photo.caption ||
              t("Photo {n} sur {count}", {
                n: index + 1,
                count: photos.length,
              })
            }
            draggable={false}
          />
        ) : (
          <div className="photo-viewer-missing">
            <ImageOff size={40} aria-hidden="true" />
            <p>{t("Photo supprimée : l’image n’est plus conservée.")}</p>
          </div>
        )}
        {photos.length > 1 && (
          <>
            <button
              type="button"
              className="photo-viewer-nav prev"
              onClick={() => go(-1)}
              aria-label={t("Photo précédente")}
            >
              <ChevronLeft size={30} />
            </button>
            <button
              type="button"
              className="photo-viewer-nav next"
              onClick={() => go(1)}
              aria-label={t("Photo suivante")}
            >
              <ChevronRight size={30} />
            </button>
          </>
        )}
      </figure>
      <footer className="photo-viewer-foot">
        {readOnly ? (
          photo.caption && (
            <p className="photo-viewer-caption">{photo.caption}</p>
          )
        ) : confirming ? (
          <div className="photo-viewer-confirm" role="alert">
            <p>
              {t(
                "Supprimer cette photo ? Elle disparaît aussi des autres postes. L’historique garde qui l’a ajoutée et supprimée, pas l’image.",
              )}
            </p>
            <div className="photo-viewer-actions">
              <button type="button" onClick={() => setConfirming(false)}>
                {t("Annuler")}
              </button>
              <button type="button" className="danger solid" onClick={remove}>
                <Trash2 size={16} />
                {t("Supprimer la photo")}
              </button>
            </div>
          </div>
        ) : (
          <div className="photo-viewer-actions">
            <label className="photo-viewer-legend">
              <span className="sr-only">{t("Légende")}</span>
              <input
                value={caption}
                maxLength={300}
                placeholder={t("Légende (facultatif)")}
                onChange={(e) => setCaption(e.target.value)}
                onBlur={saveCaption}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    saveCaption();
                  }
                }}
              />
            </label>
            <button
              type="button"
              className="danger"
              onClick={() => setConfirming(true)}
            >
              <Trash2 size={16} />
              {t("Supprimer")}
            </button>
          </div>
        )}
      </footer>
    </dialog>
  );
}
