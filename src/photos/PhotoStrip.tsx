import { useEffect, useRef, useState } from "react";
import { ImageOff, MapPin, X } from "lucide-react";
import {
  attachPhotos,
  photoRefusal,
  photosOf,
  pictureOf,
  type NewPhoto,
} from "../../shared/photos";
import { journalLang, upsert } from "../../shared/ops";
import { addLink, ref, type Ref } from "../../shared/links";
import type { Position } from "../../shared/exif";
import { useApp } from "../app/context";
import { standardLayer } from "../modules/map/maps";
import { PhotoButtons, useDropPaste, useIntake } from "./PhotoInput";
import { PhotoViewer } from "./PhotoViewer";
import { t, tn } from "./i18n.ts";

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * Photos of an entry, a message or a map object (`target`: "entry:<id>"…):
 * thumbnails, full screen on a tap, « Photo » to add one.
 */
export function PhotoStrip({ target }: { target: Ref }) {
  const {
    journal,
    live,
    workspace,
    readOnly,
    canWrite,
    updateOps,
    author,
    toast,
    graph,
  } = useApp();
  const photos = photosOf(journal.ops, target);
  const [viewing, setViewing] = useState<number | null>(null);
  const [offer, setOffer] = useState<Position | null>(null);
  const zone = useRef<HTMLElement>(null);
  const intake = useIntake((reduced) => {
    if (!canWrite()) return;
    const list: NewPhoto[] = reduced.map((r) => r.photo);
    const refusal = photoRefusal(workspace, live.ops, target, list);
    if (refusal) {
      intake.setError(refusal);
      return;
    }
    try {
      updateOps((ops) => attachPhotos(ops, target, list, author));
    } catch (err) {
      intake.setError((err as Error).message);
      return;
    }
    toast(tn(list.length, "Photo ajoutée.", "{n} photos ajoutées."));
    // Where it was taken, if the camera said so: offered, never automatic.
    const found = reduced.find((r) => r.position)?.position ?? null;
    if (found && !target.startsWith("place:")) setOffer(found);
  });
  const over = useDropPaste(zone, intake.add, !readOnly);
  // The last photo removed (here or on another post): the viewer closes.
  useEffect(() => {
    if (!photos.length) setViewing(null);
  }, [photos.length]);
  if (readOnly && !photos.length) return null;

  function place(at: Position) {
    if (!canWrite()) return;
    const id = crypto.randomUUID();
    const title = graph.byRef.get(target)?.title ?? "";
    try {
      updateOps((ops) =>
        addLink(
          upsert(
            ops,
            "places",
            {
              id,
              label: (title || t("Photo")).slice(0, 200),
              kind: "point",
              symbol: "b:incident",
              color: "",
              layer: standardLayer("Effets", journalLang(ops)),
              points: [[round6(at.lat), round6(at.lng)]],
              notes: t(
                "Placé d’après la position enregistrée par l’appareil photo.",
              ),
              maps: [],
            },
            author,
          ),
          ref("place", id),
          target,
          "",
          author,
        ),
      );
      toast(t("Point placé sur la carte, relié à cet élément."));
      setOffer(null);
    } catch (err) {
      toast((err as Error).message);
    }
  }

  return (
    <section
      className={`photo-strip${over ? " over" : ""}`}
      ref={zone}
      aria-label={t("Photos")}
    >
      <div className="photo-strip-head">
        <span className="label">
          {photos.length
            ? tn(photos.length, "{n} photo", "{n} photos")
            : t("Photos")}
        </span>
        {!readOnly && (
          <span className="photo-hint">
            {t("ou glissez / collez une image ici")}
          </span>
        )}
      </div>
      {photos.length > 0 && (
        <ul className="photo-grid">
          {photos.map((p, i) => {
            const picture = pictureOf(p, journal.blobs);
            return (
              <li key={p.id}>
                <button
                  type="button"
                  className="photo-thumb"
                  onClick={() => setViewing(i)}
                  aria-label={t("Voir la photo {n}", { n: i + 1 })}
                  title={p.caption || undefined}
                >
                  {picture ? (
                    <img src={picture} alt="" decoding="async" loading="lazy" />
                  ) : (
                    <ImageOff size={22} aria-hidden="true" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {!readOnly && <PhotoButtons busy={intake.busy} onFiles={intake.add} />}
      {intake.error && (
        <p className="error photo-error" role="alert">
          {intake.error}
        </p>
      )}
      {offer && (
        <div className="photo-offer" role="status">
          <MapPin size={16} aria-hidden="true" />
          <span>{t("La photo indique où elle a été prise.")}</span>
          <button type="button" onClick={() => place(offer)}>
            {t("Placer sur la carte")}
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => setOffer(null)}
            aria-label={t("Non merci")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {viewing !== null && photos.length > 0 && (
        <PhotoViewer
          photos={photos}
          index={viewing}
          onIndex={setViewing}
          onClose={() => setViewing(null)}
        />
      )}
    </section>
  );
}
