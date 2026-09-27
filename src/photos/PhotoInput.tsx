import { useEffect, useRef, useState, type RefObject } from "react";
import { Camera, Images, LoaderCircle } from "lucide-react";
import { imageFiles, reducePhoto, type Reduced } from "./reduce.ts";
import { t } from "./i18n.ts";
import "./photos.css";

/** A phone or a tablet: the camera and the gallery are two buttons. */
const touch = () =>
  typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

/**
 * Photos chosen by the operator, reduced one after the other. `onReady`
 * receives the ones that could be read; the others leave a message.
 */
export function useIntake(onReady: (list: Reduced[]) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ready = useRef(onReady);
  ready.current = onReady;
  async function add(files: File[]) {
    if (!files.length) return;
    setBusy(true);
    setError("");
    const out: Reduced[] = [];
    let problem = "";
    for (const file of files)
      try {
        out.push(await reducePhoto(file));
      } catch (err) {
        problem = (err as Error).message;
      }
    setBusy(false);
    if (problem) setError(problem);
    if (out.length) ready.current(out);
  }
  return { busy, error, setError, add };
}

// Paste goes to the photo area opened last (a sheet over a module…).
const pasteTargets: RefObject<(files: File[]) => void>[] = [];
let listening = false;
function onPaste(e: ClipboardEvent) {
  const top = pasteTargets[pasteTargets.length - 1];
  if (!top?.current || !e.clipboardData) return;
  // Text copied from a document may come with a picture of itself: in a
  // field, the text is what the operator wants.
  const field = (e.target as HTMLElement | null)?.closest?.(
    "input, textarea, [contenteditable]",
  );
  if (field && e.clipboardData.types.includes("text/plain")) return;
  const files = imageFiles(e.clipboardData.items);
  if (!files.length) return;
  e.preventDefault();
  top.current(files);
}

/**
 * Drag and drop on `zone`, and paste anywhere while it is shown: images are
 * handed to `onFiles`.
 */
export function useDropPaste(
  zone: RefObject<HTMLElement | null>,
  onFiles: (files: File[]) => void,
  enabled: boolean,
) {
  const [over, setOver] = useState(false);
  const handler = useRef(onFiles);
  handler.current = onFiles;
  useEffect(() => {
    const el = zone.current;
    if (!enabled || !el) return;
    const target: RefObject<(files: File[]) => void> = {
      current: (files) => handler.current(files),
    };
    pasteTargets.push(target);
    if (!listening) {
      window.addEventListener("paste", onPaste);
      listening = true;
    }
    const hasFiles = (e: DragEvent) =>
      !!e.dataTransfer && [...e.dataTransfer.types].includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setOver(true);
    };
    const leave = (e: DragEvent) => {
      if (!el.contains(e.relatedTarget as Node | null)) setOver(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setOver(false);
      handler.current(imageFiles(e.dataTransfer?.files ?? null));
    };
    el.addEventListener("dragenter", enter);
    el.addEventListener("dragover", enter);
    el.addEventListener("dragleave", leave);
    el.addEventListener("drop", drop);
    return () => {
      const i = pasteTargets.indexOf(target);
      if (i >= 0) pasteTargets.splice(i, 1);
      if (!pasteTargets.length && listening) {
        window.removeEventListener("paste", onPaste);
        listening = false;
      }
      el.removeEventListener("dragenter", enter);
      el.removeEventListener("dragover", enter);
      el.removeEventListener("dragleave", leave);
      el.removeEventListener("drop", drop);
    };
  }, [zone, enabled]);
  return over;
}

/**
 * The « Photo » button: on a phone it opens the camera, and « Galerie »
 * picks photos already taken; on a computer it chooses files.
 */
export function PhotoButtons({
  busy,
  disabled = false,
  onFiles,
}: {
  busy: boolean;
  disabled?: boolean;
  onFiles: (files: File[]) => void;
}) {
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const phone = touch();
  const take = (input: HTMLInputElement) => {
    const files = imageFiles(input.files);
    // The same photo can be chosen again after a refusal.
    input.value = "";
    onFiles(files);
  };
  return (
    <div className="photo-buttons">
      <button
        type="button"
        className="photo-add"
        disabled={disabled || busy}
        onClick={() => camera.current?.click()}
      >
        {busy ? (
          <LoaderCircle size={18} className="photo-spin" aria-hidden="true" />
        ) : (
          <Camera size={18} aria-hidden="true" />
        )}
        {busy ? t("Préparation…") : t("Photo")}
      </button>
      {phone && (
        <button
          type="button"
          className="photo-gallery"
          disabled={disabled || busy}
          onClick={() => gallery.current?.click()}
        >
          <Images size={18} aria-hidden="true" />
          {t("Galerie")}
        </button>
      )}
      <input
        ref={camera}
        className="photo-file"
        type="file"
        accept="image/*"
        tabIndex={-1}
        aria-hidden="true"
        {...(phone ? { capture: "environment" } : { multiple: true })}
        onChange={(e) => take(e.currentTarget)}
      />
      <input
        ref={gallery}
        className="photo-file"
        type="file"
        accept="image/*"
        multiple
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => take(e.currentTarget)}
      />
    </div>
  );
}
