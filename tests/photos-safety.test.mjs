import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import {
  addEntry,
  archive,
  deleteEntry,
  emptyFields,
  journalSchema,
  newJournal,
  packJournal,
  parseArchive,
  workspaceSchema,
} from "../shared/journal.ts";
import { opsSchema, removeRecords, upsert } from "../shared/ops.ts";
import { attachPhotos, photosOf, pictureOf } from "../shared/photos.ts";
import { blobKey } from "../shared/blobs.ts";
import { parseTolerant } from "../shared/tolerant.ts";
import {
  digest,
  mergeJournal,
  mergeWorkspace,
  sliceJournal,
  stampJournal,
} from "../shared/sync.ts";
import { versionVector } from "../shared/stamps.ts";
import { setLocalNode } from "../shared/hlc.ts";
import { deriveKey, encrypt } from "../shared/crypto.ts";
import {
  PROTOCOL,
  Reassembler,
  newRoomCode,
  roomKeys,
  sealFrames,
} from "../shared/room.ts";
import { handle } from "../server/app.mjs";
import { attachRelay } from "../server/relay.mjs";
import { openVault, sealVault } from "../src/journal/vault.ts";
import { applyChange, diffOps } from "../src/modules/map/undo.ts";

// Photos: what a post accepts from another one, how removals and
// concurrent changes meet, the local vault, and a session full of photos
// reaching a post that just joined.

/** A JPEG data URL of about `bytes` bytes (JPEG signature, then noise). */
const jpeg = (bytes = 3000) =>
  `data:image/jpeg;base64,${Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    randomBytes(bytes),
  ]).toString("base64")}`;
const shot = (bytes) => ({ image: jpeg(bytes), width: 1600, height: 1200 });
const at = (minute) =>
  new Date(Date.UTC(2026, 8, 24, 10, minute)).toISOString();
const NODES = { A: "posteaaa", B: "postebbb", C: "postecc1" };
function change(before, after, minute, by = "A") {
  setLocalNode(NODES[by]);
  return stampJournal(before, after, at(minute), by);
}
const withOps = (journal, ops) =>
  journalSchema.parse({ ...journal, ops: opsSchema.parse(ops) });
const message = (subject) => ({
  receivedAt: at(0),
  from: "Alpha",
  to: "PC",
  via: "Radio",
  priority: "Normal",
  category: "",
  subject,
  body: "",
  location: "",
  coordinates: "",
  replyNeeded: false,
  replyBy: "",
  status: "Nouveau",
  entryId: "",
  handledBy: "",
  notes: "",
  tags: [],
});
/** A journal with one entry, then one message (both steps kept). */
function steps() {
  const start = change(undefined, newJournal("Crue de l’Arve"), 0);
  const withEntry = change(
    start,
    addEntry(start, { ...emptyFields(), message: "Pont fissuré" }, "A"),
    1,
  );
  const withMessage = change(
    withEntry,
    withOps(withEntry, upsert(withEntry.ops, "messages", message("Eau"), "A")),
    2,
  );
  return { withEntry, withMessage };
}
const base = () => steps().withMessage;
const entryOf = (j) => `entry:${j.entries[0].id}`;
const messageOf = (j) => `message:${j.ops.messages[0].id}`;
const attach = (j, target, photos, minute, by = "A") =>
  change(
    j,
    withOps(j, attachPhotos(j.ops, target, photos, by, at(minute))),
    minute,
    by,
  );
/** A journal as another post sends it (packed, through JSON). */
const wire = (j) => JSON.parse(JSON.stringify(packJournal(j)));

// ---------- What a post accepts ----------

test("a photo's picture must be a JPEG whose hash is its key, also by reference", () => {
  const j = attach(base(), entryOf(base()), [shot(2000)], 3);
  const good = wire(j);
  const [p] = good.ops.photos;
  assert.match(p.image, /^blob:/);
  assert.ok(journalSchema.safeParse(good).success);
  assert.ok(parseTolerant(journalSchema, good).success);

  /** The same journal with the picture of its photo replaced. */
  const replaced = (picture, key = blobKey(picture)) => {
    const out = structuredClone(good);
    out.ops.photos[0].image = `blob:${key}`;
    out.blobs = { [key]: picture };
    return out;
  };
  const svg = `data:image/svg+xml;base64,${Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
  ).toString("base64")}`;
  const png = `data:image/png;base64,${Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3,
  ]).toString("base64")}`;
  // Declared as a JPEG, but HTML inside.
  const html = `data:image/jpeg;base64,${Buffer.from(
    "<html><script>alert(1)</script></html>",
  ).toString("base64")}`;
  const refused = {
    "an SVG": replaced(svg),
    "a PNG": replaced(png),
    "no JPEG signature": replaced(html),
    // Another picture under the key of this one: its hash is not the key.
    "a picture under another key": replaced(jpeg(1500), p.image.slice(5)),
  };
  for (const [what, value] of Object.entries(refused)) {
    assert.equal(journalSchema.safeParse(value).success, false, what);
    assert.equal(parseTolerant(journalSchema, value).success, false, what);
  }
  // Inline (not by reference): the same rules.
  const inline = structuredClone(good);
  inline.ops.photos[0].image = html;
  inline.blobs = {};
  assert.equal(journalSchema.safeParse(inline).success, false);
  // A photo whose picture is no longer kept is still accepted (removed on
  // another post, or damaged): it shows as missing.
  const missing = structuredClone(good);
  missing.blobs = {};
  const parsed = journalSchema.parse(missing);
  assert.equal(pictureOf(parsed.ops.photos[0], parsed.blobs), "");
});

// ---------- Removals and concurrent changes ----------

test("a photo added to an entry removed meanwhile on another post does not linger", async () => {
  const origin = base();
  const a = change(
    origin,
    deleteEntry(origin, origin.entries[0].id, "A", "Doublon"),
    5,
    "A",
  );
  const photo = shot(2500);
  const b = attach(origin, entryOf(origin), [photo], 5, "B");
  const ab = mergeJournal(a, b);
  const ba = mergeJournal(b, a);
  for (const j of [ab, ba]) {
    assert.deepEqual(j.ops.photos, [], "no photo of a removed entry");
    assert.equal(j.blobs[blobKey(photo.image)], undefined, "nor its picture");
  }
  assert.equal(await digest(ab), await digest(ba));
  // Through the wire (what B sends A), the same.
  const received = parseTolerant(journalSchema, wire(b));
  assert.ok(received.success);
  assert.deepEqual(mergeJournal(a, received.data).ops.photos, []);

  // A message removed on A while B adds a photo to it: the same.
  const noMessage = change(
    origin,
    withOps(origin, removeRecords(origin.ops, [origin.ops.messages[0].id])),
    6,
    "A",
  );
  const onMessage = attach(origin, messageOf(origin), [shot(2000)], 6, "B");
  assert.deepEqual(mergeJournal(noMessage, onMessage).ops.photos, []);
  assert.deepEqual(mergeJournal(onMessage, noMessage).ops.photos, []);
  // But a message changed after its removal comes back, with its photo.
  const edited = change(
    onMessage,
    withOps(
      onMessage,
      upsert(
        onMessage.ops,
        "messages",
        { ...onMessage.ops.messages[0], notes: "Rappeler" },
        "B",
      ),
    ),
    8,
    "B",
  );
  const back = mergeJournal(noMessage, edited);
  assert.equal(back.ops.messages.length, 1);
  assert.equal(back.ops.photos.length, 1);
  assert.equal(
    await digest(back),
    await digest(mergeJournal(edited, noMessage)),
  );
});

test("a photo that arrives before the item it illustrates is kept", () => {
  const { withEntry, withMessage } = steps();
  const b = attach(withMessage, messageOf(withMessage), [shot(2000)], 5, "B");
  // Only the photo: this post has not received the message yet.
  const onlyPhoto = sliceJournal(b, versionVector(withMessage));
  assert.equal(onlyPhoto.ops.messages.length, 0);
  assert.equal(onlyPhoto.ops.photos.length, 1);
  const c = mergeJournal(withEntry, onlyPhoto);
  assert.equal(c.ops.photos.length, 1);
  const later = mergeJournal(c, withMessage);
  assert.equal(later.ops.messages.length, 1);
  assert.equal(photosOf(later.ops, messageOf(withMessage)).length, 1);
});

test("a legend changed on one post while another removes the photo: the latest wins", async () => {
  const origin = attach(base(), entryOf(base()), [shot(3000)], 3);
  const [p] = origin.ops.photos;
  // Both start from the same state at the same moment: their stamps differ
  // by the id of the post, the later one wins.
  const caption = (by) =>
    change(
      origin,
      withOps(
        origin,
        upsert(origin.ops, "photos", { ...p, caption: "Pile nord" }, by),
      ),
      8,
      by,
    );
  const remove = (by) =>
    change(
      origin,
      { ...origin, ops: removeRecords(origin.ops, [p.id]) },
      8,
      by,
    );
  // The removal wins: gone everywhere, picture too.
  {
    const b = caption("B");
    const c = remove("C");
    assert.ok(c.sync.removed[p.id] > b.sync.clock[p.id]);
    for (const j of [mergeJournal(c, b), mergeJournal(b, c)]) {
      assert.equal(j.ops.photos.length, 0);
      assert.equal(Object.keys(j.blobs).length, 0);
    }
  }
  // The legend wins: the photo stays, with its picture, on both.
  {
    const a = remove("A");
    const b = caption("B");
    assert.ok(b.sync.clock[p.id] > a.sync.removed[p.id]);
    assert.equal(a.blobs[blobKey(p.image)], undefined, "dropped on A");
    const slice = parseTolerant(
      journalSchema,
      wire(sliceJournal(b, versionVector(origin))),
    );
    assert.ok(slice.success);
    const onA = mergeJournal(a, slice.data);
    const onB = mergeJournal(b, a);
    for (const j of [onA, onB]) {
      assert.equal(j.ops.photos[0].caption, "Pile nord");
      assert.equal(pictureOf(j.ops.photos[0], j.blobs), p.image);
    }
    assert.equal(await digest(onA), await digest(onB));
  }
});

test("an archive exported before a photo was removed does not bring it back", () => {
  const j = attach(base(), entryOf(base()), [shot(3000)], 3);
  const [p] = j.ops.photos;
  const old = parseArchive(JSON.parse(JSON.stringify(archive(j)))).journal;
  const removed = change(
    j,
    { ...j, ops: removeRecords(j.ops, [p.id]) },
    10,
    "B",
  );
  // As the import merges operational records (App.tsx, importJournal).
  const merged = mergeJournal(removed, old);
  assert.equal(merged.ops.photos.length, 0);
  assert.equal(merged.blobs[blobKey(p.image)], undefined);
  // The history still says who added it and who removed it.
  const photoEvents = merged.history.filter((e) => e.scope === "ops.photos");
  assert.equal(photoEvents.length, 2);
});

test("undo on the map keeps a map object and its photos together", () => {
  // A map object with a photo, as the map sheet makes them.
  const id = crypto.randomUUID();
  const origin = base();
  const withPlace = change(
    origin,
    withOps(
      origin,
      upsert(
        origin.ops,
        "places",
        {
          id,
          label: "Pile du pont",
          kind: "point",
          symbol: "b:incident",
          color: "",
          layer: "Effets",
          notes: "",
          points: [[46.2, 6.14]],
        },
        "A",
      ),
    ),
    3,
  );
  const created = { at: 1, items: diffOps(origin.ops, withPlace.ops) };
  const photo = shot(3000);
  const j = attach(withPlace, `place:${id}`, [photo], 4);
  // Removed by mistake (with its photos), then « Annuler »: the object
  // comes back with its photo and the picture.
  const removed = change(j, withOps(j, removeRecords(j.ops, [id])), 5);
  assert.equal(removed.ops.photos.length, 0);
  assert.equal(removed.blobs[blobKey(photo.image)], undefined);
  const removal = { at: 2, items: diffOps(j.ops, removed.ops) };
  const undone = applyChange(removed.ops, removal, "undo");
  const back = change(removed, withOps(removed, undone.ops), 6);
  assert.equal(back.ops.places.length, 1);
  assert.equal(photosOf(back.ops, `place:${id}`).length, 1);
  assert.equal(pictureOf(back.ops.photos[0], back.blobs), photo.image);
  // Redo removes both again.
  const redone = applyChange(back.ops, undone.change, "redo");
  assert.equal(redone.ops.places.length, 0);
  assert.equal(redone.ops.photos.length, 0);
  // Undoing the creation of an object that got a photo meanwhile (here from
  // another post) takes the photo with it: none left pointing at nothing.
  const fromB = attach(withPlace, `place:${id}`, [shot(2000)], 7, "B");
  const noPlace = applyChange(fromB.ops, created, "undo");
  assert.equal(noPlace.ops.places.length, 0);
  assert.deepEqual(noPlace.ops.photos, []);
});

// ---------- Local vault ----------

/** An in-memory stand-in for the IndexedDB vault (src/journal/storage.ts). */
function memoryVault() {
  const records = new Map();
  let writes = 0;
  let fail = null;
  return {
    records,
    writes: () => writes,
    failNext: (error) => (fail = error),
    write: async (record, add = [], drop = []) => {
      writes++;
      if (fail) {
        const error = fail;
        fail = null;
        throw error;
      }
      // One transaction: all or nothing.
      for (const [k, r] of add) records.set(`photo:${k}`, r);
      for (const k of drop) records.delete(`photo:${k}`);
      records.set("workspace", record);
    },
    read: async () =>
      [...records]
        .filter(([k]) => k.startsWith("photo:"))
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([k, v]) => [k.slice(6), v]),
  };
}
const PASSWORD = "phrase de test fictive uniquement";
const session = (journal) =>
  workspaceSchema.parse({
    version: 1,
    author: "A",
    activeId: journal.id,
    journals: [journal],
  });

test("the vault writes each picture once, with the session, and retries after a failed write", async () => {
  const key = await deriveKey(PASSWORD);
  const one = shot(6000);
  const j = attach(base(), entryOf(base()), [one], 3);
  const vault = memoryVault();
  const pictures = new Set();
  await sealVault(session(j), key, pictures, vault.write);
  assert.equal(vault.writes(), 1);
  assert.deepEqual([...pictures], [blobKey(one.image)]);
  // A second photo, and the browser's storage is full: nothing is written,
  // the picture is still to write.
  const two = shot(5000);
  const j2 = attach(j, entryOf(j), [two], 4);
  const full = new Error("QuotaExceededError");
  vault.failNext(full);
  await assert.rejects(
    sealVault(session(j2), key, pictures, vault.write),
    full,
  );
  assert.equal(vault.records.has(`photo:${blobKey(two.image)}`), false);
  assert.equal(pictures.has(blobKey(two.image)), false);
  await sealVault(session(j2), key, pictures, vault.write);
  assert.ok(vault.records.has(`photo:${blobKey(two.image)}`));
  // Removing a photo forgets its picture in the same write.
  const [first] = j2.ops.photos;
  const j3 = change(j2, { ...j2, ops: removeRecords(j2.ops, [first.id]) }, 5);
  const before = vault.writes();
  await sealVault(session(j3), key, pictures, vault.write);
  assert.equal(vault.writes(), before + 1);
  assert.equal(vault.records.has(`photo:${blobKey(one.image)}`), false);
  const opened = await openVault(
    vault.records.get("workspace"),
    PASSWORD,
    vault.read,
  );
  const back = workspaceSchema.parse(opened.value).journals[0];
  assert.equal(back.ops.photos.length, 1);
  assert.equal(pictureOf(back.ops.photos[0], back.blobs), two.image);
});

test("a vault saved as an envelope before photos opens, then keeps photos", async () => {
  const j = base();
  const old = await encrypt(session(j), await deriveKey(PASSWORD));
  assert.equal(old.version, 2);
  const vault = memoryVault();
  vault.records.set("workspace", JSON.parse(JSON.stringify(old)));
  const opened = await openVault(old, PASSWORD, vault.read);
  const parsed = workspaceSchema.parse(opened.value);
  assert.equal(parsed.journals[0].entries.length, 1);
  // Saved again with the key of that envelope, now with a photo.
  const photo = shot(4000);
  const withPhoto = attach(
    parsed.journals[0],
    entryOf(parsed.journals[0]),
    [photo],
    3,
  );
  const pictures = new Set(Object.keys(opened.pictures));
  await sealVault(session(withPhoto), opened.vault, pictures, vault.write);
  const again = await openVault(
    vault.records.get("workspace"),
    PASSWORD,
    vault.read,
  );
  const reread = workspaceSchema.parse(again.value).journals[0];
  assert.equal(pictureOf(reread.ops.photos[0], reread.blobs), photo.image);
});

test("a picture record moved to another key is not shown in place of another photo", async () => {
  const key = await deriveKey(PASSWORD);
  const one = shot(3000);
  const two = shot(3000);
  const j = attach(base(), entryOf(base()), [one, two], 3);
  const vault = memoryVault();
  await sealVault(session(j), key, new Set(), vault.write);
  // Someone with access to the device swaps the two sealed records: each
  // still decrypts with the key of the session.
  const k1 = `photo:${blobKey(one.image)}`;
  const k2 = `photo:${blobKey(two.image)}`;
  const r1 = vault.records.get(k1);
  vault.records.set(k1, vault.records.get(k2));
  vault.records.set(k2, r1);
  const opened = await openVault(
    vault.records.get("workspace"),
    PASSWORD,
    vault.read,
  );
  // The session opens; the photos show as missing, never swapped.
  const back = workspaceSchema.parse(opened.value).journals[0];
  const shown = back.ops.photos.map((p) => pictureOf(p, back.blobs));
  assert.deepEqual(shown, ["", ""]);
});

// ---------- Synchronisation of a session full of photos ----------

test("parts of a message given up are not kept: they never crowd out another message", async () => {
  const { key } = await roomKeys(newRoomCode());
  const limit = 1_000_000;
  const parts = new Reassembler(key, limit);
  const text = (chars) =>
    randomBytes(Math.ceil((chars * 3) / 4)).toString("base64");
  const one = { big: text(905_000) };
  const two = { big: text(1_420_000) };
  const first = await sealFrames(one, key, "postaaaa");
  const second = await sealFrames(two, key, "postbbbb");
  assert.equal(first.length, 4);
  assert.equal(second.length, 6);
  for (const f of first.slice(0, 3))
    assert.equal(await parts.accept(f), undefined);
  assert.equal(await parts.accept(second[0]), undefined);
  assert.equal(await parts.accept(second[1]), undefined);
  // Over the limit: this message is given up.
  await assert.rejects(parts.accept(second[2]), /trop volumineux/);
  // Its next parts are ignored…
  for (const f of second.slice(3))
    assert.equal(await parts.accept(f), undefined);
  // …so the other message still completes.
  const done = await parts.accept(first[3]);
  assert.equal(done?.from, "postaaaa");
  assert.equal(done.value.big, one.big);
});

let server, relay, port;
before(async () => {
  server = createServer(handle);
  relay = attachRelay(server);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  port = server.address().port;
});
after(() => {
  relay.close();
  server.close();
});
/** A post joined to the room of `code` (as tests/sync-relay.test.mjs). */
async function post(code) {
  const keys = await roomKeys(code);
  const socket = new WebSocket(`ws://127.0.0.1:${port}/sync`);
  socket.binaryType = "arraybuffer";
  const parts = new Reassembler(keys.key);
  const received = [];
  const waiting = [];
  let id = "";
  let queue = Promise.resolve();
  const welcome = new Promise((resolve) =>
    socket.addEventListener("message", (event) => {
      if (typeof event.data === "string") {
        const data = JSON.parse(event.data);
        if (data.t === "welcome") {
          id = data.id;
          resolve();
        }
        return;
      }
      const bytes = new Uint8Array(event.data);
      queue = queue.then(async () => {
        const message = await parts.accept(bytes).catch(() => "unreadable");
        if (!message) return;
        const w = waiting.shift();
        if (w) w(message);
        else received.push(message);
      });
    }),
  );
  await new Promise((r) => socket.addEventListener("open", r, { once: true }));
  socket.send(JSON.stringify({ t: "join", room: keys.room, v: PROTOCOL }));
  await welcome;
  return {
    socket,
    id: () => id,
    send: async (value, to = "") => {
      for (const frame of await sealFrames(value, keys.key, to)) {
        while (socket.bufferedAmount > 1_000_000)
          await new Promise((r) => setTimeout(r, 5));
        socket.send(frame);
      }
    },
    next: () =>
      received.length
        ? Promise.resolve(received.shift())
        : new Promise((r) => waiting.push(r)),
  };
}

test("a session with 40 MB of photos reaches a post that just joined", async () => {
  let j = base();
  const target = entryOf(j);
  // About 40 MB of pictures (the room of a session), 12 per item at most.
  const photos = Array.from({ length: 96 }, () => shot(430_000));
  let ops = j.ops;
  for (let i = 0; i < photos.length; i += 12) {
    const withEntry = addEntry(
      { ...j, ops },
      { ...emptyFields(), message: `Photos ${i / 12}` },
      "A",
    );
    ops = attachPhotos(
      withEntry.ops,
      i ? `entry:${withEntry.entries.at(-1).id}` : target,
      photos.slice(i, i + 12),
      "A",
      at(4),
    );
    j = { ...withEntry, ops };
  }
  j = change(base(), journalSchema.parse(j), 4);
  assert.equal(j.ops.photos.length, 96);
  const code = newRoomCode();
  const a = await post(code);
  const b = await post(code);
  // B has nothing yet: A answers its hello with the whole journal.
  await a.send(
    {
      type: "state",
      v: PROTOCOL,
      peer: "a",
      name: "A",
      journals: [packJournal(j)],
    },
    b.id(),
  );
  const message = await b.next();
  assert.notEqual(message, "unreadable");
  // As the post receiving it does (src/sync/useSync.ts).
  const parsed = parseTolerant(journalSchema, message.value.journals[0]);
  assert.ok(parsed.success);
  const local = session(newJournal("Rejoint"));
  const merged = mergeWorkspace(local, { journals: [parsed.data] });
  const got = merged.journals.find((x) => x.id === j.id);
  assert.equal(got.ops.photos.length, 96);
  assert.ok(got.ops.photos.every((p) => pictureOf(p, got.blobs)));
  assert.equal(await digest(got), await digest(j));
  a.socket.close();
  b.socket.close();
});
