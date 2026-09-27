import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { handle } from "../server/app.mjs";
import { attachRelay } from "../server/relay.mjs";
import {
  PROTOCOL,
  Reassembler,
  newRoomCode,
  roomKeys,
  sealFrames,
} from "../shared/room.ts";
import { tick } from "../shared/hlc.ts";
import {
  isExchangeKey,
  newExchangeKey,
  openRekey,
  pickRotation,
  rekeySchema,
  rotationOutcome,
  sealRekey,
} from "../shared/rekey.ts";
import {
  FORGET_MS,
  ONLINE_MS,
  ROLL_CALL_MS,
  SETTLE_MS,
  afterRotation,
  compareSummaries,
  needCode,
  noteComparison,
  notePost,
  postsView,
  rollCall,
  rotationRecipients,
} from "../shared/posts.ts";

// Changing the session code (shared/rekey.ts) and « Postes connectés »
// (shared/posts.ts): keys announced per connection, the new code sealed for
// each post that stays, a removed post that cannot read it, concurrent
// changes decided alike everywhere, rejoining by hand, online / last seen /
// up to date.

const stampAt = (ms, node = "aaaaaaaa") => tick("", ms, node);
const T0 = Date.parse("2026-09-27T10:00:00.000Z");

/** A post as seen by the others: a relay id and a key per connection. */
async function member(relay) {
  return { relay, key: await newExchangeKey() };
}
const recipient = (m) => ({ relay: m.relay, kx: m.key.publicKey });

// ---------- Keys ----------

test("each connection announces an ECDH P-256 key; the first one of a connection is kept", async () => {
  const one = await newExchangeKey();
  const two = await newExchangeKey();
  assert.ok(isExchangeKey(one.publicKey));
  assert.equal(one.publicKey.length, 87);
  assert.notEqual(one.publicKey, two.publicKey);
  assert.equal(one.privateKey.extractable, false);
  assert.equal(one.privateKey.algorithm.name, "ECDH");
  assert.equal(one.privateKey.algorithm.namedCurve, "P-256");

  let record = notePost(
    undefined,
    "relay001",
    { name: "Logistique", kx: one.publicKey },
    T0,
  );
  assert.equal(record.kx, one.publicKey);
  // Another key on the same connection is ignored (pinned).
  record = notePost(record, "relay001", { kx: two.publicKey }, T0 + 1000);
  assert.equal(record.kx, one.publicKey);
  // Garbage is never taken as a key, nor a malformed node.
  const junk = notePost(
    undefined,
    "relay002",
    { kx: "not-a-key", node: "../../x" },
    T0,
  );
  assert.equal(junk.kx, "");
  assert.equal(junk.node, "");
  assert.equal(
    notePost(junk, "relay002", { kx: two.publicKey }, T0).kx,
    two.publicKey,
  );
});

// ---------- Delivery ----------

test("the new code is sealed for each post that stays, and each box opens only for its post", async () => {
  const a = await member("aaaaaaaa");
  const b = await member("bbbbbbbb");
  const c = await member("cccccccc");
  const code = newRoomCode();
  const body = await sealRekey({
    code,
    stamp: stampAt(T0),
    from: a.relay,
    recipients: [b, c, a].map(recipient),
  });
  assert.equal(rekeySchema.parse(body).id, body.id);
  // The sender itself gets no box; B and C one each.
  assert.deepEqual(body.boxes.map((x) => x.to).sort(), [b.relay, c.relay]);
  assert.equal(await openRekey(body, b), code);
  assert.equal(await openRekey(body, c), code);
  // B's key with C's relay id (or the reverse) opens nothing.
  assert.equal(await openRekey(body, { relay: c.relay, key: b.key }), null);
  assert.equal(await openRekey(body, { relay: b.relay, key: c.key }), null);
  // Nothing readable travels: the code is in no field.
  const flat = code.replace(/-/g, "");
  assert.ok(!JSON.stringify(body).includes(code));
  assert.ok(!JSON.stringify(body).includes(flat));
  // A post without a valid key is skipped, never sent the code otherwise.
  const old = await sealRekey({
    code,
    stamp: stampAt(T0),
    from: a.relay,
    recipients: [{ relay: "dddddddd", kx: "" }, recipient(b)],
  });
  assert.deepEqual(
    old.boxes.map((x) => x.to),
    [b.relay],
  );
});

test("a removed post cannot read the new code, even with every box in hand", async () => {
  const a = await member("aaaaaaaa");
  const b = await member("bbbbbbbb");
  const r = await member("rrrrrrrr");
  const code = newRoomCode();
  const body = await sealRekey({
    code,
    stamp: stampAt(T0),
    from: a.relay,
    // Listed as a recipient by mistake: still left out, since removed.
    recipients: [b, r].map(recipient),
    removed: [r.relay],
    names: ["Tablette 3"],
  });
  assert.deepEqual(
    body.boxes.map((x) => x.to),
    [b.relay],
  );
  assert.equal(await openRekey(body, r), null);
  // Its own key against every box, under any recipient id.
  for (const box of body.boxes)
    assert.equal(await openRekey(body, { relay: box.to, key: r.key }), null);
  // Altering what is authenticated (stamp, removed list, recipient) breaks
  // the box for the post that stays, too.
  assert.equal(await openRekey({ ...body, stamp: stampAt(T0 + 1) }, b), null);
  assert.equal(await openRekey({ ...body, removed: [] }, b), null);
  assert.equal(
    await openRekey({ ...body, boxes: [{ ...body.boxes[0], to: r.relay }] }, r),
    null,
  );
  assert.equal(await openRekey(body, b), code);
  assert.equal(rotationOutcome(body, r.relay, null), "removed");
  assert.equal(rotationOutcome(body, b.relay, code), "follow");
  assert.equal(rotationOutcome(body, "cccccccc", null), "missed");
});

test("a change of code replayed to a later connection opens nothing", async () => {
  const a = await member("aaaaaaaa");
  const b = await member("bbbbbbbb");
  const body = await sealRekey({
    code: newRoomCode(),
    stamp: stampAt(T0),
    from: a.relay,
    recipients: [recipient(b)],
  });
  // B reconnects: new relay id and new key pair.
  const again = await member("bbbbbbb2");
  assert.equal(await openRekey(body, again), null);
  assert.equal(await openRekey(body, { relay: b.relay, key: again.key }), null);
});

// ---------- Concurrent changes ----------

function permutations(list) {
  if (list.length <= 1) return [list];
  return list.flatMap((x, i) =>
    permutations([...list.slice(0, i), ...list.slice(i + 1)]).map((p) => [
      x,
      ...p,
    ]),
  );
}

test("concurrent changes of code: the same winner whatever the order", () => {
  const change = (id, from, ms, removed = []) => ({
    id: id.padEnd(32, "0"),
    from,
    stamp: stampAt(ms, from),
    removed,
  });
  // Highest stamp wins, then highest id.
  const early = change("a1", "aaaaaaaa", T0);
  const late = change("b1", "bbbbbbbb", T0 + 500);
  for (const order of permutations([early, late]))
    assert.equal(pickRotation(order), late);
  const tieA = { ...early, stamp: late.stamp, id: "c".repeat(32) };
  const tieB = { ...late, id: "d".repeat(32) };
  for (const order of permutations([tieA, tieB]))
    assert.equal(pickRotation(order), tieB);

  // The chief removes R; R changes the code at the same time with a later
  // stamp (even one far in the future): R's change is void.
  const chief = change("e1", "cccccccc", T0, ["rrrrrrrr"]);
  const rogue = change("f1", "rrrrrrrr", T0 + 3_600_000);
  const other = change("a2", "bbbbbbbb", T0 - 1000);
  for (const order of permutations([chief, rogue, other]))
    assert.equal(pickRotation(order), chief);

  // Two posts removing each other: nothing stands, the highest stamp wins.
  const x = change("11", "xxxxxxxx", T0, ["yyyyyyyy"]);
  const y = change("22", "yyyyyyyy", T0 + 10, ["xxxxxxxx"]);
  for (const order of permutations([x, y]))
    assert.equal(pickRotation(order), y);

  // A change whose author removes itself is ignored.
  const self = change("33", "zzzzzzzz", T0 + 99_999, ["zzzzzzzz"]);
  assert.equal(pickRotation([self, early]), early);
  assert.equal(pickRotation([self]), undefined);
  assert.equal(pickRotation([]), undefined);
});

// ---------- Postes connectés ----------

test("online, last seen, up to date: computed from hellos, one row per post", () => {
  const summary = (d, w) => ({ j1: { d, w } });
  const mine = summary("same", {
    aaaaaaaa: "2026-09-27T10:00:00.000Z.0001.aaaaaaaa",
  });
  const same = compareSummaries(mine, mine);
  assert.deepEqual(same, { same: true, lacks: false, ahead: false });
  const behind = compareSummaries(mine, summary("old", {}));
  assert.equal(behind.lacks, true);
  assert.equal(behind.ahead, false);
  const ahead = compareSummaries(
    mine,
    summary("new", {
      aaaaaaaa: "2026-09-27T10:00:00.000Z.0001.aaaaaaaa",
      bbbbbbbb: "2026-09-27T10:01:00.000Z.0000.bbbbbbbb",
    }),
  );
  assert.deepEqual(ahead, { same: false, lacks: false, ahead: true });
  // A journal it lacks, one we do not have (unless removed here).
  assert.equal(compareSummaries(mine, {}).lacks, true);
  assert.equal(compareSummaries({}, mine).ahead, true);
  assert.equal(compareSummaries({}, mine, { j1: "x" }).same, true);

  // B says hello and is up to date; C differs.
  let b = notePost(
    undefined,
    "bbbbbbbb",
    { node: "nodebbbb", name: "Chef PC", role: "Chef PC", module: "journal" },
    T0,
  );
  b = noteComparison(b, same, T0);
  let c = notePost(
    undefined,
    "cccccccc",
    { node: "nodecccc", name: "Logistique" },
    T0,
  );
  c = noteComparison(c, behind, T0);
  let rows = postsView([b, c], T0 + 1000);
  assert.deepEqual(
    rows.map((r) => [r.name, r.online, r.sync]),
    [
      ["Chef PC", true, "same"],
      ["Logistique", true, "catching-up"],
    ],
  );
  // Still different two minutes later, at its next hello: behind, and
  // listed before those up to date.
  c = noteComparison(
    notePost(c, "cccccccc", {}, T0 + SETTLE_MS),
    behind,
    T0 + SETTLE_MS,
  );
  b = notePost(b, "bbbbbbbb", {}, T0 + SETTLE_MS);
  rows = postsView([b, c], T0 + SETTLE_MS + 1000);
  assert.deepEqual(
    rows.map((r) => [r.name, r.sync]),
    [
      ["Logistique", "behind"],
      ["Chef PC", "same"],
    ],
  );
  // B stops talking: offline after two missed hellos, first in the list,
  // with the time it was last seen.
  const later = T0 + SETTLE_MS + ONLINE_MS + 1;
  c = notePost(c, "cccccccc", {}, later - 1);
  rows = postsView([b, c], later);
  assert.equal(rows[0].name, "Chef PC");
  assert.equal(rows[0].online, false);
  assert.equal(rows[0].lastSeen, T0 + SETTLE_MS);
  assert.equal(rows[0].sync, "unknown");
  // B comes back on a new connection: one row, online.
  const b2 = notePost(
    undefined,
    "bbbbbbb2",
    { node: "nodebbbb", name: "Chef PC" },
    later,
  );
  rows = postsView([b, b2, c], later);
  assert.deepEqual(rows.map((r) => [r.relay, r.online]).sort(), [
    ["bbbbbbb2", true],
    ["cccccccc", true],
  ]);
  // Goodbye: left, not lost. Forgotten after twelve hours.
  rows = postsView([{ ...c, left: later }], later + 1);
  assert.equal(rows[0].left, true);
  assert.equal(rows[0].online, false);
  assert.equal(postsView([c], later + FORGET_MS + 1).length, 0);
  // Roll call (the relay counts one post less): who does not answer within
  // the delay is offline at once, not after two missed hellos.
  const asked = later + 10;
  const answered = notePost(b2, "bbbbbbb2", {}, asked + 1000);
  const called = rollCall([answered, c], asked, asked + ROLL_CALL_MS);
  rows = postsView(called, asked + ROLL_CALL_MS);
  assert.deepEqual(
    rows.map((r) => [r.name, r.online, r.left]),
    [
      ["Logistique", false, false],
      ["Chef PC", true, false],
    ],
  );
  // It speaks again: online again.
  const back = notePost(called[1], "cccccccc", {}, asked + 9000);
  assert.equal(postsView([back], asked + 9000)[0].online, true);
  // Two online posts with the same name are flagged.
  const twin = notePost(
    undefined,
    "dddddddd",
    { node: "nodedddd", name: "chef pc " },
    later,
  );
  rows = postsView([b2, twin], later);
  assert.ok(rows.every((r) => r.twin));
});

test("recipients of a change of code, and who must be given it by hand", async () => {
  const kb = await newExchangeKey();
  const kc = await newExchangeKey();
  const b = notePost(
    undefined,
    "bbbbbbbb",
    { node: "nodebbbb", name: "B", kx: kb.publicKey },
    T0,
  );
  const r = notePost(
    undefined,
    "rrrrrrrr",
    { node: "noderrrr", name: "R", kx: kc.publicKey },
    T0,
  );
  const old = notePost(
    undefined,
    "oooooooo",
    { node: "nodeoooo", name: "Old" },
    T0,
  );
  const away = notePost(
    undefined,
    "wwwwwwww",
    { node: "nodewwww", name: "Away", kx: kb.publicKey },
    T0 - ONLINE_MS - 1,
  );
  const all = [b, r, old, away];
  assert.deepEqual(rotationRecipients(all, T0, ["rrrrrrrr"]), [
    { relay: "bbbbbbbb", kx: kb.publicKey },
  ]);
  // After the change: everyone left the old room, R is removed.
  const at = T0 + 10;
  const marked = afterRotation(all, { relays: ["rrrrrrrr"], nodes: [] }, at);
  // Those online left the old room (on their way); « Away » was offline.
  assert.deepEqual(
    marked.map((m) => [m.name, m.rotated]),
    [
      ["B", at],
      ["R", at],
      ["Old", at],
      ["Away", 0],
    ],
  );
  const rows = postsView(marked, at + 30_000);
  assert.deepEqual(
    rows.filter((v) => v.removed).map((v) => v.name),
    ["R"],
  );
  // B follows and comes back in the new room; the others must type the code.
  const back = notePost(
    undefined,
    "bbbbbbb2",
    { node: "nodebbbb", name: "B" },
    at + 1000,
  );
  const after = postsView([...marked, back], at + 30_000);
  assert.deepEqual(
    needCode(after, at)
      .map((v) => v.name)
      .sort(),
    ["Away", "Old"],
  );
  // An offline post removed by name only (lost tablet, not connected).
  const lost = afterRotation([away], { relays: [], nodes: ["nodewwww"] }, at);
  assert.equal(postsView(lost, at + 1)[0].removed, true);
});

// ---------- Over the relay ----------

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

/** A post in the room of `code`: a relay id, an exchange key, messages. */
async function connect(code) {
  const keys = await roomKeys(code);
  const key = await newExchangeKey();
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
  const self = {
    socket,
    key,
    get relay() {
      return id;
    },
    send: async (value, to = "") => {
      for (const frame of await sealFrames(value, keys.key, to))
        socket.send(frame);
    },
    next: (ms = 2000) =>
      received.length
        ? Promise.resolve(received.shift())
        : new Promise((resolve) => {
            const timer = setTimeout(() => {
              waiting.splice(waiting.indexOf(done), 1);
              resolve(null);
            }, ms);
            const done = (m) => {
              clearTimeout(timer);
              resolve(m);
            };
            waiting.push(done);
          }),
    hello: () =>
      self.send({
        type: "hello",
        v: PROTOCOL,
        peer: id,
        name: id,
        kx: key.publicKey,
        journals: {},
      }),
    close: () => socket.close(),
  };
  return self;
}

test("over the relay: posts that stay follow, the removed post is left alone, an offline post rejoins by hand", async () => {
  const old = newRoomCode();
  const a = await connect(old);
  const b = await connect(old);
  const r = await connect(old);
  // Keys announced in the hellos, as every post sees them.
  const known = new Map();
  await b.hello();
  await r.hello();
  for (let i = 0; i < 2; i++) {
    const m = await a.next();
    known.set(m.from, notePost(known.get(m.from), m.from, m.value, Date.now()));
  }
  assert.equal((await r.next()).from, b.relay);
  assert.equal((await b.next()).from, r.relay);
  assert.deepEqual([...known.keys()].sort(), [b.relay, r.relay].sort());

  // A removes R.
  const code = newRoomCode();
  const body = await sealRekey({
    code,
    stamp: stampAt(Date.now(), "aaaaaaaa"),
    from: a.relay,
    recipients: rotationRecipients(known.values(), Date.now(), [r.relay]),
    removed: [r.relay],
    names: ["R"],
  });
  await a.send({ type: "rekey", v: PROTOCOL, peer: "a", name: "A", ...body });
  const atB = await b.next();
  const atR = await r.next();
  // The relay wrote the true sender; both see the change, only B reads it.
  assert.equal(atB.from, a.relay);
  assert.equal(atR.from, a.relay);
  const seenB = rekeySchema.parse(atB.value);
  assert.equal(seenB.from, atB.from);
  assert.equal(await openRekey(seenB, { relay: b.relay, key: b.key }), code);
  const seenR = rekeySchema.parse(atR.value);
  assert.equal(await openRekey(seenR, { relay: r.relay, key: r.key }), null);
  assert.equal(
    rotationOutcome(pickRotation([seenR]), r.relay, null),
    "removed",
  );

  // A and B move to the new room; R stays in the old one and writes there.
  a.close();
  b.close();
  const a2 = await connect(code);
  const b2 = await connect(code);
  await r.send({
    type: "state",
    v: PROTOCOL,
    peer: "r",
    name: "R",
    journals: [],
  });
  await a2.send({ type: "presence", v: PROTOCOL, peer: "a", name: "A" });
  const got = await b2.next();
  assert.equal(got.from, a2.relay);
  assert.equal(got.value.type, "presence");
  assert.equal(await b2.next(300), null, "nothing from the removed post");

  // C was offline: it types the new code by hand and joins the others.
  const c = await connect(code);
  await c.send({
    type: "hello",
    v: PROTOCOL,
    peer: "c",
    name: "C",
    journals: {},
  });
  assert.equal((await a2.next()).from, c.relay);
  assert.equal((await b2.next()).from, c.relay);
  // The old code only leads to R.
  const late = await connect(old);
  await r.send({ type: "presence", v: PROTOCOL, peer: "r", name: "R" });
  assert.equal((await late.next()).from, r.relay);
  assert.equal(await a2.next(200), null);
  for (const p of [a2, b2, c, r, late]) p.close();
});
