import {
  decrypt,
  decryptWith,
  encryptVault,
  type VaultKey,
  type VaultRecord,
} from "../../shared/crypto.ts";
import { packWorkspace, type Workspace } from "../../shared/journal.ts";
import { joinPhotoBlobs, splitPhotoBlobs } from "../../shared/photos.ts";
import { blobKey } from "../../shared/blobs.ts";
import { readPictures, writeVault, type StoredVault } from "./storage.ts";

// Sealing a session into the local vault and opening it again (the
// IndexedDB side is in ./storage.ts; tests pass their own store).

/**
 * Write a session to the vault: compressed, encrypted, images once (see
 * packWorkspace). Photo pictures, large and never changed, are sealed apart,
 * each once: `pictures` holds the keys already in the vault and is updated
 * once the write succeeded (a failed write leaves them to write again).
 */
export async function sealVault(
  value: Workspace,
  key: VaultKey,
  pictures: Set<string>,
  write = writeVault,
): Promise<VaultRecord> {
  const { workspace, pictures: all } = splitPhotoBlobs(packWorkspace(value));
  const record = await encryptVault(workspace, key);
  const add: [string, VaultRecord][] = [];
  for (const [k, picture] of Object.entries(all))
    if (!pictures.has(k)) add.push([k, await encryptVault(picture, key)]);
  const drop = [...pictures].filter((k) => all[k] === undefined);
  await write(record, add, drop);
  pictures.clear();
  for (const k of Object.keys(all)) pictures.add(k);
  return record;
}

/** A session read from the vault, with its photo pictures put back. */
export async function openVault(
  data: StoredVault,
  password: string,
  read = readPictures,
) {
  const { value, vault } = await decrypt(data, password);
  const pictures: Record<string, string> = {};
  for (const [k, sealed] of await read())
    try {
      const picture = await decryptWith(sealed, vault);
      // A record is sealed apart from its key: only the picture whose hash
      // is that key is its picture (a record moved or swapped is not).
      if (typeof picture === "string" && blobKey(picture) === k)
        pictures[k] = picture;
    } catch {
      // A damaged picture: its photo shows as missing, the session opens.
    }
  return { value: joinPhotoBlobs(value, pictures), vault, pictures };
}
