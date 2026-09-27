import { test } from "node:test";
import assert from "node:assert/strict";
import { newRoomCode } from "../shared/room.ts";
import { tick } from "../shared/hlc.ts";
import * as rekey from "../shared/rekey.ts";
import * as posts from "../shared/posts.ts";

// What a post removed by a change of code (shared/rekey.ts) could try to get
// the new code anyway: take over the change from another connection, keep a
// second connection of the same post, block the change with a bad key or a
// stamp at the end of time.

const { newExchangeKey, openRekey, pickRotation, rekeySchema, sealRekey } =
  rekey;
const { notePost, rotationRecipients, rotationOutcome } = {
  ...posts,
  rotationOutcome: rekey.rotationOutcome,
};

const T0 = Date.parse("2026-09-27T10:00:00.000Z");
const stampAt = (ms, node = "aaaaaaaa") => tick("", ms, node);
async function member(relay) {
  return { relay, key: await newExchangeKey() };
}
const recipient = (m) => ({ relay: m.relay, kx: m.key.publicKey });

function permutations(list) {
  if (list.length <= 1) return [list];
  return list.flatMap((x, i) =>
    permutations([...list.slice(0, i), ...list.slice(i + 1)]).map((p) => [
      x,
      ...p,
    ]),
  );
}

test("a removed post that comes back on another connection cannot take over the change of code", async () => {
  const a = await member("aaaaaaaa");
  const b = await member("bbbbbbbb");
  const r = await member("rrrrrrrr");
  // A removes R; B stays.
  const chief = await sealRekey({
    code: newRoomCode(),
    stamp: stampAt(T0),
    from: a.relay,
    recipients: [recipient(b)],
    removed: [r.relay],
  });
  // R still holds the old code: it joins the old room again on a fresh
  // connection (never removed), knows the keys of A and B from their
  // hellos, and sends its own change, stamped far in the future.
  const r3 = "rrrrrrr3";
  const rogueCode = newRoomCode();
  const rogue = await sealRekey({
    code: rogueCode,
    stamp: stampAt(T0 + 3_600_000, "rrrrrrrr"),
    from: r3,
    recipients: [recipient(a), recipient(b)],
  });
  // B can open it: the threat is real.
  assert.equal(await openRekey(rogue, b), rogueCode);
  for (const order of permutations([chief, rogue]))
    assert.equal(pickRotation(order), chief, "R's change never wins");

  // Same, removing the author of the removal in return.
  const counter = await sealRekey({
    code: rogueCode,
    stamp: stampAt(T0 + 3_600_000, "rrrrrrrr"),
    from: r3,
    recipients: [recipient(b)],
    removed: [a.relay],
  });
  for (const order of permutations([chief, counter]))
    assert.notEqual(pickRotation(order), counter);
  // And from the removed connection itself.
  const back = await sealRekey({
    code: rogueCode,
    stamp: stampAt(T0 + 3_600_000, "rrrrrrrr"),
    from: r.relay,
    recipients: [recipient(b)],
    removed: [a.relay],
  });
  for (const order of permutations([chief, back]))
    assert.notEqual(pickRotation(order), back);

  // Honest posts that change the code at the same time still agree: the
  // highest stamp wins when each keeps the other.
  const c = await member("cccccccc");
  const one = await sealRekey({
    code: newRoomCode(),
    stamp: stampAt(T0),
    from: a.relay,
    recipients: [recipient(b), recipient(c)],
  });
  const two = await sealRekey({
    code: newRoomCode(),
    stamp: stampAt(T0 + 10, "cccccccc"),
    from: c.relay,
    recipients: [recipient(a), recipient(b)],
  });
  for (const order of permutations([one, two]))
    assert.equal(pickRotation(order), two);
  // A change that keeps a post another change removes is void: the removal
  // wins over a plain change made at the same time.
  const plain = await sealRekey({
    code: newRoomCode(),
    stamp: stampAt(T0 + 10, "bbbbbbbb"),
    from: b.relay,
    recipients: [recipient(a), recipient(r)],
  });
  for (const order of permutations([chief, plain]))
    assert.equal(pickRotation(order), chief);
});

test("removing a post removes every connection it has, not only the row clicked", async () => {
  const kb = await newExchangeKey();
  const k1 = await newExchangeKey();
  const k2 = await newExchangeKey();
  // R is connected twice (a reconnection not yet timed out, or on purpose).
  const records = [
    notePost(
      undefined,
      "bbbbbbbb",
      { node: "nodebbbb", name: "B", kx: kb.publicKey },
      T0,
    ),
    notePost(
      undefined,
      "rrrrrrr1",
      { node: "noderrrr", name: "R", kx: k1.publicKey },
      T0,
    ),
    notePost(
      undefined,
      "rrrrrrr2",
      { node: "noderrrr", name: "R", kx: k2.publicKey },
      T0,
    ),
  ];
  // « Retirer ce poste » on the first row.
  const remove = { relays: ["rrrrrrr1"], nodes: ["noderrrr"] };
  assert.equal(typeof posts.removedRelays, "function");
  const removed = posts.removedRelays(records, T0, remove);
  assert.deepEqual([...removed].sort(), ["rrrrrrr1", "rrrrrrr2"]);
  const to = rotationRecipients(records, T0, removed);
  assert.deepEqual(
    to.map((x) => x.relay),
    ["bbbbbbbb"],
  );
  const body = await sealRekey({
    code: newRoomCode(),
    stamp: stampAt(T0),
    from: "aaaaaaaa",
    recipients: to,
    removed,
    nodes: remove.nodes,
  });
  assert.equal(
    await openRekey(body, { relay: "rrrrrrr2", key: k2 }),
    null,
    "the other connection of R gets nothing",
  );
  assert.equal(rotationOutcome(body, "rrrrrrr2", null), "removed");
  // Even when only the node is given, no connection of it gets a box.
  assert.deepEqual(
    rotationRecipients(records, T0, [], ["noderrrr"]).map((x) => x.relay),
    ["bbbbbbbb"],
  );
});

test("a key that is not a point of the curve cannot block the change of code", async () => {
  const b = await member("bbbbbbbb");
  // 65 bytes, right length and alphabet, but not on P-256.
  const bogus = "BA" + "A".repeat(85);
  assert.ok(rekey.isExchangeKey(bogus));
  const body = await sealRekey({
    code: newRoomCode(),
    stamp: stampAt(T0),
    from: "aaaaaaaa",
    recipients: [{ relay: "xxxxxxxx", kx: bogus }, recipient(b)],
  });
  assert.deepEqual(
    body.boxes.map((x) => x.to),
    ["bbbbbbbb"],
  );
});

test("a stamp at the end of time seen in a change cannot block the next change", () => {
  assert.equal(typeof rekey.nextRotationStamp, "function");
  const last = "9999-12-31T23:59:59.999Z.ffff.zzzzzzzz";
  const stamp = rekey.nextRotationStamp(last, T0, "aaaaaaaa");
  assert.ok(rekeySchema.shape.stamp.safeParse(stamp).success, stamp);
  // Otherwise, later than what was seen.
  const seen = stampAt(T0 + 5000, "bbbbbbbb");
  assert.ok(rekey.nextRotationStamp(seen, T0, "aaaaaaaa") > seen);
});
