import { useCallback, useEffect, useRef, useState } from "react";
import {
  decrypt,
  decryptWith,
  deriveKey,
  encryptVault,
  type VaultKey,
  type VaultRecord,
} from "../../shared/crypto";
import {
  packWorkspace,
  workspaceSchema,
  type Workspace,
} from "../../shared/journal";
import { localNode, setLocalNode } from "../../shared/hlc";
import { stampWorkspace } from "../../shared/sync";
import { joinPhotoBlobs, splitPhotoBlobs } from "../../shared/photos";
import {
  deleteVault,
  readPictureKeys,
  readPictures,
  readVault,
  writeVault,
  type StoredVault,
} from "./storage";
import { t } from "./i18n.ts";
/** The session keeps the id of this post in its stamps across reloads. */
function withNode(value: Workspace): Workspace {
  if (value.node) {
    setLocalNode(value.node);
    return value;
  }
  return { ...value, node: localNode() };
}
/**
 * Write a session to the vault: compressed, encrypted, images once (see
 * packWorkspace). Photo pictures, large and never changed, are sealed apart,
 * each once: `pictures` holds the keys already in the vault and is updated.
 */
async function sealVault(
  value: Workspace,
  key: VaultKey,
  pictures: Set<string>,
): Promise<VaultRecord> {
  const { workspace, pictures: all } = splitPhotoBlobs(packWorkspace(value));
  const record = await encryptVault(workspace, key);
  const add: [string, VaultRecord][] = [];
  for (const [k, picture] of Object.entries(all))
    if (!pictures.has(k)) add.push([k, await encryptVault(picture, key)]);
  const drop = [...pictures].filter((k) => all[k] === undefined);
  await writeVault(record, add, drop);
  pictures.clear();
  for (const k of Object.keys(all)) pictures.add(k);
  return record;
}
/** A session read from the vault, with its photo pictures put back. */
async function openVault(data: StoredVault, password: string) {
  const { value, vault } = await decrypt(data, password);
  const pictures: Record<string, string> = {};
  for (const [k, sealed] of await readPictures())
    try {
      const picture = await decryptWith(sealed, vault);
      if (typeof picture === "string") pictures[k] = picture;
    } catch {
      // A damaged picture: its photo shows as missing, the session opens.
    }
  return { value: joinPhotoBlobs(value, pictures), vault, pictures };
}
async function acquireWriter(): Promise<() => void> {
  if (!navigator.locks)
    throw new Error(
      t(
        "Ce navigateur ne permet pas de sécuriser les écritures entre onglets. Utilisez le mode temporaire.",
      ),
    );
  return new Promise((resolve, reject) => {
    navigator.locks
      .request("orion-journal-writer", { ifAvailable: true }, async (lock) => {
        if (!lock) {
          reject(
            new Error(
              t(
                "L’espace local est déjà ouvert dans un autre onglet. Verrouillez cet onglet avant de reprendre ici.",
              ),
            ),
          );
          return;
        }
        await new Promise<void>((release) => resolve(release));
      })
      .catch(reject);
  });
}
type Update =
  Workspace | null | ((previous: Workspace | null) => Workspace | null);
export function useWorkspace() {
  const [workspace, setRaw] = useState<Workspace | null>(null);
  // Journals changed on this post since the last synchronisation message.
  const dirty = useRef(new Set<string>());
  const [localTick, setLocalTick] = useState(0);
  /** Local change: stamped for the synchronisation. */
  const setWorkspace = useCallback((update: Update) => {
    setRaw((previous) => {
      const next = typeof update === "function" ? update(previous) : update;
      if (!next || !previous || next === previous) return next;
      const stamped = stampWorkspace(previous, next);
      const before = new Map(previous.journals.map((j) => [j.id, j]));
      for (const j of stamped.journals)
        if (before.get(j.id) !== j) dirty.current.add(j.id);
      if (stamped.gone !== previous.gone) dirty.current.add("*");
      return stamped;
    });
    setLocalTick((t) => t + 1);
  }, []);
  /** Change received from another post: applied as is. */
  const applyRemote = useCallback(
    (update: (previous: Workspace) => Workspace) =>
      setRaw((previous) => (previous ? update(previous) : previous)),
    [],
  );
  const takeDirty = useCallback(() => {
    const ids = [...dirty.current];
    dirty.current.clear();
    return ids;
  }, []);
  const [vaultKey, setVaultKey] = useState<VaultKey | null>(null);
  const [stored, setStored] = useState<StoredVault | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<
    "temporary" | "saving" | "saved" | "error"
  >("temporary");
  const [error, setError] = useState("");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const writer = useRef<(() => void) | null>(null);
  const queue = useRef(Promise.resolve());
  const latest = useRef(workspace);
  latest.current = workspace;
  const saved = useRef<Workspace | null>(null);
  // Keys of the photo pictures already in the vault.
  const pictures = useRef(new Set<string>());
  useEffect(() => {
    readVault()
      .then((value) => setStored(value ?? null))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
    return () => writer.current?.();
  }, []);
  useEffect(() => {
    if (!workspace || !vaultKey) return;
    let live = true;
    setSaveState("saving");
    const timer = setTimeout(() => {
      saveTimer.current = null;
      queue.current = queue.current
        .catch(() => {})
        .then(async () => {
          const ciphertext = await sealVault(
            workspace,
            vaultKey,
            pictures.current,
          );
          saved.current = workspace;
          setStored(ciphertext);
          if (live) {
            setSaveState("saved");
            setError("");
          }
        })
        .catch((err) => {
          if (live) {
            setSaveState("error");
            setError(err.message);
          }
        });
    }, 250);
    saveTimer.current = timer;
    return () => {
      live = false;
      clearTimeout(timer);
      if (saveTimer.current === timer) saveTimer.current = null;
    };
  }, [workspace, vaultKey]);
  useEffect(() => {
    const before = (event: BeforeUnloadEvent) => {
      if (latest.current && (!vaultKey || saved.current !== latest.current)) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, [vaultKey]);
  const start = useCallback((value: Workspace) => {
    setRaw(withNode(workspaceSchema.parse(value)));
    setSaveState("temporary");
    setError("");
  }, []);
  async function startProtected(value: Workspace, password: string) {
    const parsed = withNode(workspaceSchema.parse(value));
    const release = await acquireWriter();
    try {
      if (await readVault())
        throw new Error(
          t(
            "Une session de reprise existe déjà. Reprenez-la ou exportez-la avant de créer une autre session protégée.",
          ),
        );
      const key = await deriveKey(password);
      pictures.current = new Set(await readPictureKeys());
      const ciphertext = await sealVault(parsed, key, pictures.current);
      writer.current = release;
      saved.current = parsed;
      setStored(ciphertext);
      setVaultKey(key);
      setRaw(parsed);
      setSaveState("saved");
      setError("");
      void navigator.storage?.persist?.().catch(() => {});
    } catch (err) {
      release();
      throw err;
    }
  }
  async function protect(password: string) {
    const release = await acquireWriter();
    try {
      if (await readVault())
        throw new Error(
          t(
            "Un espace chiffré existe déjà sur ce poste. Exportez cette session puis déverrouillez l’espace existant pour y importer le journal.",
          ),
        );
      const key = await deriveKey(password);
      const value = latest.current;
      if (!value) throw new Error(t("Aucun espace à sauvegarder."));
      pictures.current = new Set(await readPictureKeys());
      const ciphertext = await sealVault(value, key, pictures.current);
      writer.current = release;
      saved.current = value;
      setStored(ciphertext);
      setVaultKey(key);
      setSaveState("saved");
      void navigator.storage?.persist?.().catch(() => {});
    } catch (err) {
      release();
      throw err;
    }
  }
  async function unlock(password: string) {
    const release = await acquireWriter();
    try {
      const data = await readVault();
      if (!data) throw new Error(t("Aucun espace local enregistré."));
      const { value, vault, pictures: read } = await openVault(data, password);
      // Older sessions are brought up to date by the schema (stamps, images
      // kept once, message numbers).
      const parsed = withNode(workspaceSchema.parse(value));
      pictures.current = new Set(Object.keys(read));
      writer.current = release;
      saved.current = parsed;
      setVaultKey(vault);
      setRaw(parsed);
      setSaveState("saved");
      setError("");
    } catch (err) {
      release();
      throw err;
    }
  }
  async function close() {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    await queue.current;
    if (vaultKey && latest.current && latest.current !== saved.current) {
      const snapshot = latest.current;
      const ciphertext = await sealVault(snapshot, vaultKey, pictures.current);
      saved.current = snapshot;
      setStored(ciphertext);
    }
    pictures.current = new Set();
    setRaw(null);
    latest.current = null;
    saved.current = null;
    setVaultKey(null);
    writer.current?.();
    writer.current = null;
    setSaveState("temporary");
  }
  async function finish() {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    await queue.current;
    if (vaultKey) await deleteVault();
    pictures.current = new Set();
    setRaw(null);
    latest.current = null;
    saved.current = null;
    setVaultKey(null);
    if (vaultKey) setStored(null);
    writer.current?.();
    writer.current = null;
    setSaveState("temporary");
  }
  async function forget() {
    if (workspace)
      throw new Error(t("Verrouillez l’espace avant de l’effacer."));
    const release = await acquireWriter();
    try {
      await deleteVault();
      setStored(null);
    } finally {
      release();
    }
  }
  return {
    workspace,
    setWorkspace,
    applyRemote,
    takeDirty,
    localTick,
    stored,
    loading,
    error,
    saveState,
    persistent: !!vaultKey,
    start,
    startProtected,
    protect,
    unlock,
    close,
    finish,
    forget,
  };
}
