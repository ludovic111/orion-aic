import {
  PHOTO_MAX_CHARS,
  PHOTO_MAX_FILE,
  PHOTO_MAX_SIDE,
  PHOTO_TARGET_BYTES,
  type NewPhoto,
} from "../../shared/photos.ts";
import { jpegPosition, type Position } from "../../shared/exif.ts";
import { t } from "./i18n.ts";

// A photo is reduced in the browser before it is kept: longest side 1600 px
// at most, JPEG of a few hundred kilobytes. Drawing it on a canvas and
// encoding it again leaves every metadata of the original behind (camera,
// time, position): only the picture is kept.

export type Reduced = {
  photo: NewPhoto;
  /** Position written by the camera, if any (offered, never stored). */
  position: Position | null;
};

function load(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(
        new Error(
          t("Cette image ne peut pas être lue. Essayez une photo JPEG ou PNG."),
        ),
      );
    };
    image.src = url;
  });
}

const encode = (canvas: HTMLCanvasElement, quality: number) =>
  new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", quality),
  );

const dataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

/** Reduce a photo taken or chosen by the operator. */
export async function reducePhoto(file: File): Promise<Reduced> {
  if (file.type && !file.type.startsWith("image/"))
    throw new Error(t("Ce fichier n’est pas une photo."));
  if (file.size > PHOTO_MAX_FILE)
    throw new Error(
      t("Cette photo est trop grande ({size} Mo). Choisissez-en une autre.", {
        size: Math.ceil(file.size / (1024 * 1024)),
      }),
    );
  const position =
    file.type === "image/jpeg" || /\.jpe?g$/i.test(file.name)
      ? jpegPosition(
          new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer()),
        )
      : null;
  const image = await load(file);
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if (!width || !height)
    throw new Error(
      t("Cette image ne peut pas être lue. Essayez une photo JPEG ou PNG."),
    );
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context)
    throw new Error(t("Ce navigateur ne peut pas réduire la photo."));
  let side = PHOTO_MAX_SIDE;
  let best: Blob | null = null;
  let size = { width: 0, height: 0 };
  // Smaller and smaller until the photo is light enough (almost always at
  // the first try).
  for (
    let round = 0;
    round < 5 && !(best && best.size <= PHOTO_TARGET_BYTES);
    round++
  ) {
    const scale = Math.min(1, side / Math.max(width, height));
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    // A transparent picture gets a white ground (JPEG has no transparency).
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.82, 0.72, 0.62]) {
      const blob = await encode(canvas, quality);
      if (!blob) break;
      best = blob;
      size = { width: canvas.width, height: canvas.height };
      if (blob.size <= PHOTO_TARGET_BYTES) break;
    }
    side = Math.round(side * 0.75);
  }
  if (!best) throw new Error(t("Ce navigateur ne peut pas réduire la photo."));
  const url = await dataUrl(best);
  if (
    !url.startsWith("data:image/jpeg;base64,") ||
    url.length > PHOTO_MAX_CHARS
  )
    throw new Error(t("Ce navigateur ne peut pas réduire la photo."));
  return {
    photo: { image: url, ...size },
    position,
  };
}

/** Image files among dropped or pasted items. */
export function imageFiles(list: FileList | DataTransferItemList | null) {
  const out: File[] = [];
  if (!list) return out;
  for (const item of Array.from(list as ArrayLike<File | DataTransferItem>)) {
    const file =
      item instanceof File
        ? item
        : item.kind === "file"
          ? item.getAsFile()
          : null;
    if (file && (!file.type || file.type.startsWith("image/"))) out.push(file);
  }
  return out;
}
