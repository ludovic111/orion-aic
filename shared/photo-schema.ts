import { z } from "zod";
import { BLOB_REF } from "./blobs.ts";
import { t } from "./i18n/photos.ts";

// Photos attached to a journal entry, a message or a map object. A photo is
// a record of its own (ops.photos): adding or removing one never rewrites
// the item it illustrates, it synchronises, merges and enters the history
// like any other record. The picture itself, re-encoded on the post that
// took it (JPEG, metadata dropped), is kept once in journal.blobs under its
// SHA-256 (shared/blobs.ts), like the images of custom map symbols.

/** Kinds of items a photo can illustrate ("entry:<id>"…). */
export const PHOTO_TARGETS = ["entry", "message", "place"] as const;
export type PhotoTarget = (typeof PHOTO_TARGETS)[number];
export const PHOTO_TARGET =
  /^(entry|message|place):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/**
 * A photo as stored: a JPEG data URL (re-encoded, without metadata), whose
 * bytes start with the JPEG signature (FF D8 FF, "/9j/" in base64).
 */
export const DATA_PHOTO =
  /^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*={0,2}$/;

// ---------- Limits ----------

/** Longest side of a photo once reduced (pixels). */
export const PHOTO_MAX_SIDE = 1600;
/** Size aimed at when reducing a photo (bytes). */
export const PHOTO_TARGET_BYTES = 350_000;
/** Largest photo accepted, as stored (characters of its data URL, ≈ 440 KB). */
export const PHOTO_MAX_CHARS = 600_000;
/** Photos on one entry, message or map object. */
export const PHOTOS_PER_ITEM = 12;
/** Photos of a session, all journals together (bytes, ≈ 120 photos). */
export const SESSION_PHOTO_BYTES = 40 * 1024 * 1024;
/**
 * Photos a journal may hold (schema). Higher than what one session may add
 * (SESSION_PHOTO_BYTES), so that two posts adding photos at the same time
 * still merge.
 */
export const MAX_PHOTOS = 1000;
/** Largest file a post agrees to read and reduce (bytes). */
export const PHOTO_MAX_FILE = 40 * 1024 * 1024;

const instant = z.iso.datetime({ offset: true });

export const photoSchema = z
  .object({
    id: z.uuid(),
    createdAt: instant,
    updatedAt: instant,
    by: z.string().max(120),
    // Item illustrated: "entry:<id>", "message:<id>" or "place:<id>".
    target: z.string().regex(PHOTO_TARGET),
    // Data URL, or "blob:<sha256>" when stored or transmitted (the picture
    // is kept once in journal.blobs). A removed photo leaves no picture:
    // its history refers to one that no longer exists.
    image: z
      .string()
      .max(PHOTO_MAX_CHARS)
      .refine((v) => DATA_PHOTO.test(v) || BLOB_REF.test(v), {
        error: () => t("Photo invalide."),
      }),
    width: z.number().int().min(1).max(8192),
    height: z.number().int().min(1).max(8192),
    // Short legend, optional.
    caption: z.string().max(300).default(""),
  })
  .strict();
export type Photo = z.infer<typeof photoSchema>;
