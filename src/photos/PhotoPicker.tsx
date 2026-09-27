import { useRef } from "react";
import { X } from "lucide-react";
import { photoRefusal, type NewPhoto } from "../../shared/photos";
import { useApp } from "../app/context";
import { PhotoButtons, useDropPaste, useIntake } from "./PhotoInput";
import { t, tn } from "./i18n.ts";

/**
 * Photos of an item being written (new entry, new message): kept in the
 * form until it is saved, then attached to the new item.
 */
export function PhotoPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: NewPhoto[];
  onChange: (photos: NewPhoto[]) => void;
  disabled?: boolean;
}) {
  const { workspace } = useApp();
  const zone = useRef<HTMLDivElement>(null);
  const current = useRef(value);
  current.current = value;
  const intake = useIntake((reduced) => {
    const next = [...current.current, ...reduced.map((r) => r.photo)];
    const refusal = photoRefusal(workspace, { photos: [] }, "", next);
    if (refusal) intake.setError(refusal);
    else onChange(next);
  });
  const over = useDropPaste(zone, intake.add, !disabled);
  return (
    <div className={`photo-picker${over ? " over" : ""}`} ref={zone}>
      {value.length > 0 && (
        <ul
          className="photo-grid"
          aria-label={tn(value.length, "{n} photo", "{n} photos")}
        >
          {value.map((p, i) => (
            <li key={`${i}-${p.image.length}`}>
              <span className="photo-thumb">
                <img src={p.image} alt="" decoding="async" />
              </span>
              <button
                type="button"
                className="photo-remove"
                onClick={() => onChange(value.filter((_, j) => j !== i))}
                aria-label={t("Retirer la photo {n}", { n: i + 1 })}
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="photo-row">
        <PhotoButtons
          busy={intake.busy}
          disabled={disabled}
          onFiles={intake.add}
        />
        {!disabled && (
          <span className="photo-hint">
            {t("ou glissez / collez une image ici")}
          </span>
        )}
      </div>
      {intake.error && (
        <p className="error photo-error" role="alert">
          {intake.error}
        </p>
      )}
    </div>
  );
}
