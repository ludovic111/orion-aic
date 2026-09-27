import {
  DATA_PHOTO,
  PHOTO_MAX_CHARS,
  PHOTOS_PER_ITEM,
  SESSION_PHOTO_BYTES,
  photoSchema,
  type Photo,
} from "./photo-schema.ts";
import { BLOB_REF, blobKey, keyOfRef } from "./blobs.ts";
import type { Journal, Workspace } from "./journal.ts";
import type { Ops } from "./ops.ts";
import { t } from "./i18n/photos.ts";

// Photos of entries, messages and map objects: which item shows which
// photos, the limits, attaching them, and keeping their pictures apart in
// the local vault. The schema and the limits: shared/photo-schema.ts.

export * from "./photo-schema.ts";

/** A photo reduced on this post, not yet attached. */
export type NewPhoto = {
  image: string;
  width: number;
  height: number;
  caption?: string;
};

const MB = 1024 * 1024;

/** Bytes of a picture from its data URL (base64); 0 for a reference. */
export function imageBytes(image: string): number {
  if (!image.startsWith("data:")) return 0;
  const data = image.slice(image.indexOf(",") + 1);
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
}

const byTarget = new WeakMap<Photo[], Map<string, Photo[]>>();
/** Photos of an item ("entry:<id>"…), in the order they were added. */
export function photosOf(ops: Pick<Ops, "photos">, target: string): Photo[] {
  let index = byTarget.get(ops.photos);
  if (!index) {
    index = new Map();
    for (const p of ops.photos) {
      const list = index.get(p.target);
      if (list) list.push(p);
      else index.set(p.target, [p]);
    }
    for (const list of index.values())
      list.sort(
        (a, b) =>
          a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
      );
    byTarget.set(ops.photos, index);
  }
  return index.get(target) ?? [];
}

/** Picture of a photo: its data URL, or "" when it is no longer kept. */
export function pictureOf(
  photo: Pick<Photo, "image">,
  blobs: Journal["blobs"],
): string {
  if (photo.image.startsWith("data:")) return photo.image;
  return BLOB_REF.test(photo.image) ? (blobs[keyOfRef(photo.image)] ?? "") : "";
}

/** Size of the pictures of a session, each counted once (bytes). */
export function sessionPhotoBytes(
  workspace: Pick<Workspace, "journals">,
): number {
  const seen = new Set<string>();
  let total = 0;
  for (const j of workspace.journals)
    for (const p of j.ops.photos) {
      const picture = pictureOf(p, j.blobs);
      if (!picture) continue;
      const key = p.image.startsWith("data:")
        ? blobKey(p.image)
        : keyOfRef(p.image);
      if (seen.has(key)) continue;
      seen.add(key);
      total += imageBytes(picture);
    }
  return total;
}

/**
 * Why these photos cannot be added to `target` now, in words for the
 * operator; null when they can.
 */
export function photoRefusal(
  workspace: Pick<Workspace, "journals">,
  ops: Pick<Ops, "photos">,
  target: string,
  adding: Pick<NewPhoto, "image">[],
): string | null {
  const already = photosOf(ops, target).length;
  if (already + adding.length > PHOTOS_PER_ITEM)
    return already >= PHOTOS_PER_ITEM
      ? t("Déjà {n} photos ici : c’est le maximum.", { n: PHOTOS_PER_ITEM })
      : t("{n} photos au plus par élément.", { n: PHOTOS_PER_ITEM });
  for (const p of adding)
    if (p.image.length > PHOTO_MAX_CHARS || !DATA_PHOTO.test(p.image))
      return t("Cette photo est trop lourde. Essayez-en une autre.");
  const used = sessionPhotoBytes(workspace);
  const more = adding.reduce((n, p) => n + imageBytes(p.image), 0);
  if (used + more > SESSION_PHOTO_BYTES)
    return t(
      "Plus de place pour les photos : {max} Mo au plus par session. Retirez des photos inutiles pour en ajouter d’autres.",
      { max: SESSION_PHOTO_BYTES / MB },
    );
  return null;
}

/** Share of the session's room for photos already used (0 to 1). */
export const photoRoomUsed = (workspace: Pick<Workspace, "journals">) =>
  Math.min(1, sessionPhotoBytes(workspace) / SESSION_PHOTO_BYTES);

/** The records with these photos attached to `target`. */
export function attachPhotos(
  ops: Ops,
  target: string,
  photos: NewPhoto[],
  author: string,
  at = new Date().toISOString(),
): Ops {
  if (!photos.length) return ops;
  // One millisecond apart: they keep the order they were chosen in.
  const start = Date.parse(at);
  const added = photos.map((p, i) => {
    const when = new Date(start + i).toISOString();
    return photoSchema.parse({
      id: crypto.randomUUID(),
      createdAt: when,
      updatedAt: when,
      by: author,
      target,
      image: p.image,
      width: p.width,
      height: p.height,
      caption: p.caption ?? "",
    });
  });
  return { ...ops, photos: [...ops.photos, ...added] };
}

// ---------- Local vault ----------
// The session is written again after every change; its photos, large and
// never modified, are written once each, apart (src/journal/storage.ts).

type Packed = Pick<Workspace, "journals"> & Record<string, unknown>;

/**
 * A packed workspace (packWorkspace) without the pictures of its photos,
 * and these pictures by key.
 */
export function splitPhotoBlobs<W extends Packed>(
  workspace: W,
): { workspace: W; pictures: Record<string, string> } {
  const pictures: Record<string, string> = {};
  let changed = false;
  const journals = workspace.journals.map((j) => {
    const keys = new Set<string>();
    for (const p of j.ops.photos)
      if (BLOB_REF.test(p.image) && j.blobs[keyOfRef(p.image)])
        keys.add(keyOfRef(p.image));
    // A picture also used by something else (a symbol) stays in place.
    for (const s of j.ops.symbols)
      if (BLOB_REF.test(s.image)) keys.delete(keyOfRef(s.image));
    if (!keys.size) return j;
    changed = true;
    const blobs: Record<string, string> = {};
    for (const [k, v] of Object.entries(j.blobs))
      if (keys.has(k)) pictures[k] = v;
      else blobs[k] = v;
    return { ...j, blobs };
  });
  return {
    workspace: changed ? { ...workspace, journals } : workspace,
    pictures,
  };
}

/**
 * Put the pictures kept apart back into a workspace read from the vault,
 * before it is parsed. Anything unexpected is left for the schema to judge.
 */
export function joinPhotoBlobs(
  value: unknown,
  pictures: Record<string, string>,
): unknown {
  if (!value || typeof value !== "object") return value;
  const journals = (value as { journals?: unknown }).journals;
  if (!Array.isArray(journals) || !Object.keys(pictures).length) return value;
  return {
    ...value,
    journals: journals.map((j) => {
      const photos = (j as { ops?: { photos?: unknown } })?.ops?.photos;
      if (!Array.isArray(photos)) return j;
      const blobs = {
        ...((j as { blobs?: Record<string, string> }).blobs ?? {}),
      };
      let changed = false;
      for (const p of photos) {
        const image = (p as { image?: unknown })?.image;
        if (typeof image !== "string" || !BLOB_REF.test(image)) continue;
        const key = keyOfRef(image);
        if (pictures[key] && blobs[key] === undefined) {
          blobs[key] = pictures[key];
          changed = true;
        }
      }
      return changed ? { ...j, blobs } : j;
    }),
  };
}
