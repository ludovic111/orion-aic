import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  addEntry,
  archive,
  deleteEntry,
  emptyFields,
  journalSchema,
  newJournal,
  packJournal,
  packWorkspace,
  parseArchive,
  workspaceSchema,
} from "../shared/journal.ts";
import { opsSchema, removeRecords, upsert } from "../shared/ops.ts";
import {
  MAX_PHOTOS,
  PHOTOS_PER_ITEM,
  PHOTO_MAX_CHARS,
  SESSION_PHOTO_BYTES,
  attachPhotos,
  imageBytes,
  joinPhotoBlobs,
  photoRefusal,
  photoSchema,
  photosOf,
  pictureOf,
  sessionPhotoBytes,
  splitPhotoBlobs,
} from "../shared/photos.ts";
import { blobKey } from "../shared/blobs.ts";
import { parseTolerant } from "../shared/tolerant.ts";
import {
  digest,
  mergeJournal,
  sliceJournal,
  stampJournal,
} from "../shared/sync.ts";
import { versionVector } from "../shared/stamps.ts";
import { setLocalNode } from "../shared/hlc.ts";
import { auditTrail, journalAt, restoreState } from "../shared/history.ts";
import {
  decrypt,
  decryptWith,
  deriveKey,
  encrypt,
  encryptVault,
} from "../shared/crypto.ts";
import { jpegPosition } from "../shared/exif.ts";
import { fullScope, scopedJournal } from "../src/export/scope.ts";
import {
  archiveJournal,
  buildDossier,
  tablesOf,
} from "../src/export/dossier.ts";
import { entrySheet, sheetPhotos } from "../src/print/sheet.ts";

/**
 * A JPEG data URL of `bytes` bytes: the JPEG signature, then noise (the
 * content is not decoded here).
 */
const jpeg = (bytes = 3000) =>
  `data:image/jpeg;base64,${Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff]),
    randomBytes(Math.max(0, bytes - 3)),
  ]).toString("base64")}`;
const shot = (bytes) => ({ image: jpeg(bytes), width: 1600, height: 1200 });
const at = (minute) =>
  new Date(Date.UTC(2026, 8, 24, 10, minute)).toISOString();
/** Each operator works on a post of their own. */
const NODES = { A: "posteaaa", B: "postebbb", C: "postecc1" };
/** A local change, stamped and recorded as the app does it. */
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

/** A journal with one entry and one message, recorded. */
function base() {
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
  return withMessage;
}
const entryOf = (j) => `entry:${j.entries[0].id}`;
const messageOf = (j) => `message:${j.ops.messages[0].id}`;
/** Attach photos to an item as a local change. */
const attach = (j, target, photos, minute, by = "A") =>
  change(
    j,
    withOps(j, attachPhotos(j.ops, target, photos, by, at(minute))),
    minute,
    by,
  );

test("a photo record is validated strictly", () => {
  const good = {
    id: crypto.randomUUID(),
    createdAt: at(0),
    updatedAt: at(0),
    by: "A",
    target: `entry:${crypto.randomUUID()}`,
    image: jpeg(),
    width: 1600,
    height: 900,
  };
  assert.equal(photoSchema.parse(good).caption, "");
  assert.ok(
    photoSchema.safeParse({ ...good, image: `blob:${"a".repeat(64)}` }).success,
  );
  const refused = [
    { ...good, image: "data:image/png;base64,AAAA" },
    { ...good, image: "data:image/svg+xml;base64,PHN2Zz4=" },
    { ...good, image: "https://example.org/x.jpg" },
    { ...good, image: jpeg(460_000) },
    { ...good, target: `resource:${crypto.randomUUID()}` },
    { ...good, target: "entry:1" },
    { ...good, width: 0 },
    { ...good, caption: "x".repeat(301) },
    { ...good, exif: { gps: [46.2, 6.1] } },
  ];
  for (const value of refused)
    assert.equal(
      photoSchema.safeParse(value).success,
      false,
      JSON.stringify(Object.keys(value)),
    );
  assert.ok(jpeg(440_000).length <= PHOTO_MAX_CHARS);
});

test("older sessions open without photos; newer fields are dropped when synchronised", () => {
  const j = newJournal("Ancien");
  const old = JSON.parse(JSON.stringify(j));
  delete old.ops.photos;
  assert.deepEqual(journalSchema.parse(old).ops.photos, []);
  const target = `entry:${crypto.randomUUID()}`;
  const newer = JSON.parse(
    JSON.stringify(withOps(j, attachPhotos(j.ops, target, [shot()], "A"))),
  );
  newer.ops.photos[0].thumbnail = "data:image/jpeg;base64,AAAA";
  assert.equal(journalSchema.safeParse(newer).success, false);
  const tolerant = parseTolerant(journalSchema, newer);
  assert.ok(tolerant.success);
  assert.equal(tolerant.data.ops.photos.length, 1);
  assert.equal("thumbnail" in tolerant.data.ops.photos[0], false);
});

test("a picture is kept once, referred to by its hash in the history and when stored", async () => {
  const j = base();
  const photo = shot(5000);
  // As the app does it: records changed, the journal not parsed again.
  const next = change(
    j,
    { ...j, ops: attachPhotos(j.ops, entryOf(j), [photo], "A", at(3)) },
    3,
  );
  const [p] = photosOf(next.ops, entryOf(j));
  assert.equal(p.image, photo.image);
  const key = blobKey(photo.image);
  assert.equal(next.blobs[key], photo.image);
  const events = next.history.filter((e) => e.scope === "ops.photos");
  assert.equal(events.length, 1);
  assert.equal(events[0].state.image, `blob:${key}`);
  assert.equal(events[0].state.target, entryOf(j));
  const packed = JSON.stringify(packJournal(next));
  assert.equal(packed.split(photo.image).length - 1, 1, "stored once");
  const back = journalSchema.parse(JSON.parse(packed));
  assert.equal(photosOf(back.ops, entryOf(j))[0].image, photo.image);
  assert.equal(
    pictureOf(photosOf(back.ops, entryOf(j))[0], back.blobs),
    photo.image,
  );
  // The post that took it and a post that received it agree.
  assert.equal(await digest(next), await digest(back));
});

test("limits: photos per item, size of a photo, room of the session", () => {
  const j = base();
  const workspace = { journals: [j] };
  const target = entryOf(j);
  assert.equal(photoRefusal(workspace, j.ops, target, [shot()]), null);
  const many = Array.from({ length: PHOTOS_PER_ITEM + 1 }, () => shot(100));
  assert.match(photoRefusal(workspace, j.ops, target, many), /au plus/);
  const full = withOps(
    j,
    attachPhotos(j.ops, target, many.slice(0, PHOTOS_PER_ITEM), "A"),
  );
  assert.match(
    photoRefusal({ journals: [full] }, full.ops, target, [shot(100)]),
    /maximum/,
  );
  assert.match(
    photoRefusal(workspace, j.ops, target, [{ image: jpeg(470_000) }]),
    /trop lourde/,
  );
  assert.match(
    photoRefusal(workspace, j.ops, target, [
      { image: "data:image/png;base64,AAAA" },
    ]),
    /trop lourde/,
  );
  // The room of the session counts every journal, each picture once.
  const big = shot(430_000);
  assert.ok(Math.abs(imageBytes(big.image) - 430_000) < 3);
  const photos = [];
  let n = 0;
  while ((n + 1) * 430_000 <= SESSION_PHOTO_BYTES) {
    photos.push(shot(430_000));
    n++;
  }
  // Spread over messages of two journals (12 per item at most).
  const second = newJournal("Autre");
  let opsA = j.ops;
  let opsB = second.ops;
  photos.forEach((p, i) => {
    const target = `message:${crypto.randomUUID()}`;
    if (i % 2) opsA = attachPhotos(opsA, target, [p], "A");
    else opsB = attachPhotos(opsB, target, [p], "A");
  });
  const a = withOps(j, opsA);
  const b = withOps(second, opsB);
  const session = { journals: [a, b] };
  assert.ok(sessionPhotoBytes(session) <= SESSION_PHOTO_BYTES);
  assert.equal(photoRefusal(session, a.ops, target, [shot(10)]), null);
  assert.match(
    photoRefusal(session, a.ops, target, [shot(430_000)]),
    /Plus de place pour les photos : 40 Mo/,
  );
  // The same picture in two journals counts once.
  const copy = withOps(second, attachPhotos(second.ops, target, [big], "A"));
  const twice = withOps(j, attachPhotos(j.ops, target, [big], "A"));
  assert.equal(
    sessionPhotoBytes({ journals: [copy, twice] }),
    imageBytes(big.image),
  );
  // The schema bounds a journal whatever the posts did.
  assert.ok(MAX_PHOTOS * 430_000 > SESSION_PHOTO_BYTES * 2);
});

test("removing a photo drops its picture; its history keeps who, when and what, not the image", () => {
  const j = base();
  const photo = shot(4000);
  const added = attach(j, entryOf(j), [photo], 3);
  const [p] = added.ops.photos;
  const removed = change(
    added,
    withOps(added, removeRecords(added.ops, [p.id])),
    10,
    "B",
  );
  const stored = journalSchema.parse(
    JSON.parse(JSON.stringify(packJournal(removed))),
  );
  assert.equal(stored.ops.photos.length, 0);
  assert.equal(stored.blobs[blobKey(photo.image)], undefined, "picture gone");
  const trail = auditTrail(stored).filter((i) => i.scope === "ops.photos");
  assert.deepEqual(
    trail.map((i) => [i.action, i.by]),
    [
      ["remove", "B"],
      ["create", "A"],
    ],
  );
  // The time machine shows the photo was there, without its picture.
  const before = journalAt(stored, Date.parse(at(5)));
  assert.equal(before.ops.photos.length, 1);
  assert.equal(pictureOf(before.ops.photos[0], before.blobs), "");
  assert.throws(
    () => restoreState(stored, trail[1], "C"),
    /image n’est plus conservée/,
  );
  // While the photo lives, the time machine shows its picture.
  const earlier = journalAt(added, Date.parse(at(5)));
  assert.equal(pictureOf(earlier.ops.photos[0], earlier.blobs), photo.image);
});

test("removing an entry or a message removes its photos", () => {
  const j = base();
  const withPhotos = attach(
    attach(j, entryOf(j), [shot(), shot()], 3),
    messageOf(j),
    [shot()],
    4,
  );
  assert.equal(withPhotos.ops.photos.length, 3);
  const noEntry = change(
    withPhotos,
    deleteEntry(withPhotos, withPhotos.entries[0].id, "A", "Doublon"),
    5,
  );
  assert.deepEqual(
    noEntry.ops.photos.map((p) => p.target),
    [messageOf(j)],
  );
  const noMessage = change(
    noEntry,
    withOps(noEntry, removeRecords(noEntry.ops, [noEntry.ops.messages[0].id])),
    6,
  );
  const stored = journalSchema.parse(
    JSON.parse(JSON.stringify(packJournal(noMessage))),
  );
  assert.equal(stored.ops.photos.length, 0);
  assert.equal(Object.keys(stored.blobs).length, 0, "no picture left behind");
});

test("two posts adding photos at the same time converge; a later removal wins", async () => {
  const origin = base();
  const pa = shot(3000);
  const pb = shot(3500);
  const a = attach(origin, entryOf(origin), [pa], 3, "A");
  const b = attach(origin, messageOf(origin), [pb], 3, "B");
  const ab = mergeJournal(a, b);
  const ba = mergeJournal(b, a);
  assert.equal(await digest(ab), await digest(ba));
  assert.equal(await digest(mergeJournal(ab, ab)), await digest(ab));
  assert.equal(ab.ops.photos.length, 2);
  assert.equal(ab.blobs[blobKey(pa.image)], pa.image);
  assert.equal(ab.blobs[blobKey(pb.image)], pb.image);
  // What B lacks travels with its picture; merging it gives the same.
  const slice = sliceJournal(a, versionVector(b));
  assert.ok(slice.ops.photos.length === 1);
  assert.equal(slice.blobs[blobKey(pa.image)], pa.image);
  const received = parseTolerant(
    journalSchema,
    JSON.parse(JSON.stringify(packJournal(slice))),
  );
  assert.ok(received.success);
  assert.equal(await digest(mergeJournal(b, received.data)), await digest(ab));
  // A removes B's photo after seeing it: the removal wins everywhere.
  const photoB = ab.ops.photos.find((p) => p.target === messageOf(origin));
  // As the app does it (updateOps): the records change, the journal is not
  // parsed again; the picture goes at once all the same.
  const removed = change(
    ab,
    { ...ab, ops: removeRecords(ab.ops, [photoB.id]) },
    8,
  );
  assert.equal(removed.blobs[blobKey(pb.image)], undefined);
  const everywhere = mergeJournal(b, removed);
  assert.equal(await digest(removed), await digest(everywhere));
  assert.equal(everywhere.ops.photos.length, 1);
  assert.equal(everywhere.blobs[blobKey(pb.image)], undefined);
  assert.equal(
    await digest(everywhere),
    await digest(mergeJournal(removed, b)),
  );
  // A caption changed later on another post wins over the older one.
  const [kept] = everywhere.ops.photos;
  const seen = mergeJournal(b, a);
  const captioned = change(
    seen,
    withOps(
      seen,
      upsert(seen.ops, "photos", { ...kept, caption: "Pile nord" }, "B"),
    ),
    9,
    "B",
  );
  const final = mergeJournal(everywhere, captioned);
  assert.equal(
    final.ops.photos.find((p) => p.id === kept.id).caption,
    "Pile nord",
  );
  assert.equal(final.ops.photos.find((p) => p.id === kept.id).image, pa.image);
});

test("archives keep the photos: export, encrypted round trip, import and merge", async () => {
  const j = base();
  const photo = shot(6000);
  const withPhoto = attach(j, entryOf(j), [photo], 3);
  // Plain archive.
  const text = JSON.stringify(archive(withPhoto));
  assert.equal(text.split(photo.image).length - 1, 1);
  const back = parseArchive(JSON.parse(text)).journal;
  assert.equal(photosOf(back.ops, entryOf(j))[0].image, photo.image);
  // Encrypted .orionaic envelope.
  const password = "phrase de test fictive uniquement";
  const sealed = await encrypt(archive(withPhoto), await deriveKey(password));
  const opened = parseArchive(
    (await decrypt(JSON.parse(JSON.stringify(sealed)), password)).value,
  ).journal;
  assert.equal(photosOf(opened.ops, entryOf(j))[0].image, photo.image);
  // Merged into the journal of another post (as the import does).
  const other = change(undefined, newJournal("Autre poste"), 0, "B");
  const merged = mergeJournal({ ...other, id: opened.id }, opened);
  assert.equal(merged.ops.photos.length, 1);
  assert.equal(pictureOf(merged.ops.photos[0], merged.blobs), photo.image);
  // An archive of part of the operation keeps only the pictures of its part.
  const both = attach(withPhoto, messageOf(j), [shot(2000)], 4);
  const onlyMessages = archiveJournal(both, {
    ...fullScope(),
    sections: ["messages", "trace"],
  });
  assert.deepEqual(
    onlyMessages.ops.photos.map((p) => p.target),
    [messageOf(j)],
  );
  assert.equal(Object.keys(onlyMessages.blobs).length, 1);
  assert.equal(
    JSON.stringify(archive(onlyMessages)).includes(photo.image),
    false,
  );
  const whole = scopedJournal(both, fullScope());
  assert.equal(whole.ops.photos.length, 2);
  assert.equal(Object.keys(whole.blobs).length, 2);
});

test("the local vault keeps pictures apart and puts them back before parsing", () => {
  const j = base();
  const photo = shot(8000);
  const withPhoto = attach(j, entryOf(j), [photo], 3);
  const workspace = workspaceSchema.parse({
    version: 1,
    author: "A",
    activeId: withPhoto.id,
    journals: [withPhoto],
  });
  const { workspace: light, pictures } = splitPhotoBlobs(
    packWorkspace(workspace),
  );
  const lightText = JSON.stringify(light);
  assert.equal(lightText.includes(photo.image), false);
  assert.deepEqual(Object.values(pictures), [photo.image]);
  const read = workspaceSchema.parse(
    joinPhotoBlobs(JSON.parse(lightText), pictures),
  );
  assert.equal(read.journals[0].ops.photos[0].image, photo.image);
  // Without its pictures, a session still opens (the photos show as missing).
  const missing = workspaceSchema.parse(JSON.parse(lightText));
  assert.equal(
    pictureOf(missing.journals[0].ops.photos[0], missing.journals[0].blobs),
    "",
  );
  // A session without photos is left as it is.
  const plain = packWorkspace(
    workspaceSchema.parse({ ...workspace, journals: [j] }),
  );
  assert.equal(splitPhotoBlobs(plain).workspace, plain);
});

/** A JPEG header with an EXIF GPS block (46° 11′ N, 6° 8′ 24″ E). */
function jpegWithPosition({ south = false, little = true } = {}) {
  const tiff = new DataView(new ArrayBuffer(128));
  const L = little;
  tiff.setUint16(0, little ? 0x4949 : 0x4d4d);
  tiff.setUint16(2, 42, L);
  tiff.setUint32(4, 8, L);
  tiff.setUint16(8, 1, L);
  tiff.setUint16(10, 0x8825, L);
  tiff.setUint16(12, 4, L);
  tiff.setUint32(14, 1, L);
  tiff.setUint32(18, 26, L);
  let o = 26;
  tiff.setUint16(o, 4, L);
  o += 2;
  const entry = (tag, type, count, value) => {
    tiff.setUint16(o, tag, L);
    tiff.setUint16(o + 2, type, L);
    tiff.setUint32(o + 4, count, L);
    if (typeof value === "string") tiff.setUint8(o + 8, value.charCodeAt(0));
    else tiff.setUint32(o + 8, value, L);
    o += 12;
  };
  entry(1, 2, 2, south ? "S" : "N");
  entry(2, 5, 3, 80);
  entry(3, 2, 2, "E");
  entry(4, 5, 3, 104);
  const rationals = (at, list) =>
    list.forEach(([n, d], i) => {
      tiff.setUint32(at + i * 8, n, L);
      tiff.setUint32(at + i * 8 + 4, d, L);
    });
  rationals(80, [
    [46, 1],
    [11, 1],
    [0, 1],
  ]);
  rationals(104, [
    [6, 1],
    [8, 1],
    [24, 1],
  ]);
  const body = new Uint8Array(tiff.buffer);
  const out = new Uint8Array(2 + 10 + body.length + 4);
  const view = new DataView(out.buffer);
  view.setUint16(0, 0xffd8);
  view.setUint16(2, 0xffe1);
  view.setUint16(4, 8 + body.length);
  out.set([0x45, 0x78, 0x69, 0x66, 0, 0], 6);
  out.set(body, 12);
  view.setUint16(12 + body.length, 0xffda);
  return out;
}

test("the position written by a camera is read, never invented", () => {
  const expected = { lat: 46.183333, lng: 6.14 };
  assert.deepEqual(jpegPosition(jpegWithPosition()), expected);
  assert.deepEqual(jpegPosition(jpegWithPosition({ little: false })), expected);
  assert.equal(jpegPosition(jpegWithPosition({ south: true })).lat, -46.183333);
  // Not a JPEG, no EXIF, truncated, noise: nothing.
  assert.equal(jpegPosition(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), null);
  assert.equal(
    jpegPosition(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2])),
    null,
  );
  assert.equal(jpegPosition(jpegWithPosition().slice(0, 60)), null);
  assert.equal(jpegPosition(new Uint8Array(randomBytes(4000))), null);
});

test("a photo sealed apart opens with the key of the session only", async () => {
  const key = await deriveKey("phrase de test fictive uniquement");
  const picture = jpeg(20_000);
  const sealed = await encryptVault(picture, key);
  assert.equal(await decryptWith(sealed, key), picture);
  const other = await deriveKey("une autre phrase de test fictive");
  await assert.rejects(decryptWith(sealed, other), /invalide|incorrecte/);
  const bad = { ...sealed, data: sealed.data.slice() };
  bad.data[3] ^= 1;
  await assert.rejects(decryptWith(bad, key), /endommagé/);
});

test("the A4 form of an entry prints its photos; the dossier lists them", async () => {
  const j = base();
  const photo = shot(2000);
  const withPhoto = attach(
    j,
    entryOf(j),
    [{ ...photo, caption: "Pile nord" }],
    3,
  );
  const sheet = entrySheet(withPhoto, withPhoto.entries[0]);
  assert.equal(sheet.photos.length, 1);
  assert.equal(sheet.photos[0].src, photo.image);
  assert.equal(sheet.photos[0].caption, "Pile nord");
  assert.deepEqual(sheetPhotos(withPhoto, messageOf(j)), []);
  const d = await buildDossier(withPhoto, fullScope(), { author: "Test" });
  const photos = tablesOf(d).find(
    (x) => x.table.id === "entries-photos",
  )?.table;
  assert.deepEqual(photos.rows, [["#001", "1", "Pile nord"]]);
  // No photo, no table.
  const none = await buildDossier(j, fullScope(), { author: "Test" });
  assert.equal(
    tablesOf(none).some((x) => x.table.id.endsWith("-photos")),
    false,
  );
});
