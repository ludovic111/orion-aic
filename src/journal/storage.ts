import type { Encrypted, VaultRecord } from "../../shared/crypto";
import { t } from "./i18n.ts";
// The name stays: sessions saved by earlier versions open from the same
// database. The vault holds the record "workspace": a VaultRecord (2.1,
// compressed, raw bytes) or an Encrypted envelope written before 2.1; and
// one record per photo picture, "photo:<sha256>", sealed with the same key
// and written once (shared/photos.ts, splitPhotoBlobs).
const DATABASE = "orion-journal-v1";
export type StoredVault = Encrypted | VaultRecord;
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("vault");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        new Error(
          t(
            "Le navigateur refuse le stockage local. Exportez une copie avant de quitter.",
          ),
        ),
      );
  });
}
async function transaction<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("vault", mode);
    const request = action(tx.objectStore("vault"));
    tx.oncomplete = () => {
      db.close();
      resolve(request.result);
    };
    tx.onabort = tx.onerror = () => {
      db.close();
      const quota = (tx.error ?? request.error)?.name === "QuotaExceededError";
      reject(
        new Error(
          quota
            ? t(
                "Espace de stockage du navigateur plein : la sauvegarde locale a échoué. Exportez une copie, puis libérez de l’espace (anciens journaux, images).",
              )
            : t(
                "Sauvegarde locale impossible. Exportez une copie avant de quitter.",
              ),
        ),
      );
    };
  });
}
export const readVault = () =>
  transaction<StoredVault | undefined>("readonly", (store) =>
    store.get("workspace"),
  );
/** Every record, the session and its photos (the whole vault is erased). */
export const deleteVault = () =>
  transaction("readwrite", (store) => store.clear());

const PHOTO = "photo:";
const photos = () => IDBKeyRange.bound(PHOTO, `${PHOTO}\uffff`);
/** Keys (sha256) of the photo pictures stored. */
export const readPictureKeys = async () =>
  (
    await transaction<IDBValidKey[]>("readonly", (store) =>
      store.getAllKeys(photos()),
    )
  ).map((k) => String(k).slice(PHOTO.length));
/** Photo pictures stored, sealed, by key (sha256). */
export async function readPictures(): Promise<[string, unknown][]> {
  const keys = await readPictureKeys();
  const values = await transaction<unknown[]>("readonly", (store) =>
    store.getAll(photos()),
  );
  return keys.map((k, i) => [k, values[i]]);
}
/**
 * Write the session, the photo pictures it does not have yet and forget the
 * ones it no longer uses, all at once: the vault never refers to a picture
 * it does not hold.
 */
export const writeVault = (
  value: StoredVault,
  add: [string, VaultRecord][] = [],
  drop: string[] = [],
) =>
  transaction("readwrite", (store) => {
    for (const [key, record] of add) store.put(record, `${PHOTO}${key}`);
    for (const key of drop) store.delete(`${PHOTO}${key}`);
    return store.put(value, "workspace");
  });
