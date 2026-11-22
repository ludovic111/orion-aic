import { DurableObject } from "cloudflare:workers";
import { LIMITS, MAX_CONTROL, PROTOCOL } from "../server/relay-limits.mjs";

// Live synchronisation relay on Cloudflare: one Durable Object holds every
// room, like the single Node process of server/relay.mjs, and speaks the
// same protocol 2 (see the comment at the top of server/relay.mjs and
// shared/room.ts). It forwards opaque, end-to-end encrypted frames and keeps
// nothing: no storage is written but the alarm that ends unjoined
// connections, and nothing is logged. When the last post leaves, the room
// is gone.
//
// WebSocket hibernation: between messages the object may be evicted from
// memory while the connections stay open. What each connection is (its id,
// address, room and join deadline) is stored on the connection itself
// (serializeAttachment), and the rooms are rebuilt from it when the object
// wakes up. Only the join counters per address live in memory alone: they
// start again from a full burst after a hibernation.
//
// Differences with the Node relay, imposed by the platform:
// - No flow control: Cloudflare buffers what a slow post has not read yet
//   and offers no way to pause a sender. LIMITS.backlog, hardBacklog and
//   stall do not apply here.
// - No WebSocket pings from the relay: Cloudflare closes dead connections
//   itself, and the posts already send each other a heartbeat every 40 s.

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
const ROOM = /^[a-f0-9]{64}$/;
const encoder = new TextEncoder();

const count = (map, key, delta) => {
  const n = (map.get(key) ?? 0) + delta;
  if (n > 0) map.set(key, n);
  else map.delete(key);
};

export class Relay extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.limits = LIMITS;
    /** Open connection → { id, ip, room, deadline }. */
    this.posts = new Map();
    /** Room → its connections. */
    this.rooms = new Map();
    /** Address → open connections. */
    this.sockets = new Map();
    /** Address → Map(room → its connections from that address). */
    this.roomsByIp = new Map();
    /** Address → { tokens, at }: joins allowed. */
    this.joins = new Map();
    // Back from hibernation: the connections are still open.
    for (const ws of ctx.getWebSockets()) {
      const post = ws.deserializeAttachment();
      if (post && !post.closed) this.track(ws, post);
    }
  }

  track(ws, post) {
    this.posts.set(ws, post);
    count(this.sockets, post.ip, 1);
    if (!post.room) return;
    const peers = this.rooms.get(post.room) ?? new Set();
    peers.add(ws);
    this.rooms.set(post.room, peers);
    const own = this.roomsByIp.get(post.ip) ?? new Map();
    count(own, post.room, 1);
    this.roomsByIp.set(post.ip, own);
  }

  async fetch(request) {
    const L = this.limits;
    const ip = request.headers.get("CF-Connecting-IP") ?? "";
    if ((this.sockets.get(ip) ?? 0) >= L.socketsPerIp)
      return new Response(null, { status: 429 });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    const id = [...crypto.getRandomValues(new Uint8Array(8))]
      .map((b) => ALPHABET[b % 36])
      .join("");
    const post = { id, ip, room: null, deadline: Date.now() + L.joinTimeout };
    server.serializeAttachment(post);
    this.track(server, post);
    // An unjoined connection is closed after LIMITS.joinTimeout.
    const alarm = await this.ctx.storage.getAlarm();
    if (alarm === null || alarm > post.deadline)
      await this.ctx.storage.setAlarm(post.deadline);
    return new Response(null, { status: 101, webSocket: client });
  }

  async alarm() {
    const now = Date.now();
    let next = Infinity;
    for (const [ws, post] of this.posts)
      if (!post.room) {
        if (post.deadline <= now) this.fail(ws, "timeout");
        else next = Math.min(next, post.deadline);
      }
    this.forgetJoins(now);
    if (next < Infinity) await this.ctx.storage.setAlarm(next);
  }

  /** Forget idle, refilled join counters. */
  forgetJoins(now) {
    const L = this.limits;
    for (const [ip, bucket] of this.joins)
      if (now - bucket.at > L.joinBurst * L.joinRefillMs) this.joins.delete(ip);
  }

  allowJoin(ip) {
    const L = this.limits;
    const now = Date.now();
    if (this.joins.size > 1024) this.forgetJoins(now);
    const bucket = this.joins.get(ip) ?? { tokens: L.joinBurst, at: now };
    bucket.tokens = Math.min(
      L.joinBurst,
      bucket.tokens + (now - bucket.at) / L.joinRefillMs,
    );
    bucket.at = now;
    this.joins.set(ip, bucket);
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }

  write(ws, data) {
    try {
      ws.send(data);
    } catch {
      this.close(ws, 1011);
    }
  }

  send(ws, value) {
    this.write(ws, JSON.stringify(value));
  }

  fail(ws, code, close = 1008) {
    this.send(ws, { t: "error", code, v: PROTOCOL });
    this.close(ws, close);
  }

  close(ws, code = 1000) {
    if (!this.posts.has(ws)) return;
    const post = this.posts.get(ws);
    try {
      // Not counted again if the object wakes up before the socket is gone.
      ws.serializeAttachment({ ...post, closed: true });
      ws.close(code);
    } catch {
      // Already closed by the other side.
    }
    this.leave(ws);
  }

  leave(ws) {
    const post = this.posts.get(ws);
    if (!post) return;
    this.posts.delete(ws);
    count(this.sockets, post.ip, -1);
    if (!post.room) return;
    const own = this.roomsByIp.get(post.ip);
    if (own) {
      count(own, post.room, -1);
      if (!own.size) this.roomsByIp.delete(post.ip);
    }
    const peers = this.rooms.get(post.room);
    if (!peers) return;
    peers.delete(ws);
    if (!peers.size) this.rooms.delete(post.room);
    else this.announce(post.room);
  }

  announce(room) {
    const peers = this.rooms.get(room);
    if (!peers) return;
    const message = JSON.stringify({ t: "peers", n: peers.size });
    for (const ws of [...peers]) this.write(ws, message);
  }

  join(ws, post, value) {
    const L = this.limits;
    if (value.v !== PROTOCOL) return this.fail(ws, "version");
    const room = String(value.room ?? "");
    if (!ROOM.test(room)) return this.fail(ws, "room");
    if (!this.allowJoin(post.ip)) return this.fail(ws, "rate", 1013);
    const peers = this.rooms.get(room);
    const own = this.roomsByIp.get(post.ip);
    if ((peers?.size ?? 0) >= L.peersPerRoom)
      return this.fail(ws, "full", 1013);
    if (
      !peers &&
      (this.rooms.size >= L.rooms || (own?.size ?? 0) >= L.roomsPerIp)
    )
      return this.fail(ws, "busy", 1013);
    post.room = room;
    post.deadline = 0;
    ws.serializeAttachment(post);
    count(this.sockets, post.ip, -1);
    this.track(ws, post);
    this.send(ws, { t: "welcome", id: post.id, v: PROTOCOL });
    this.announce(room);
  }

  /** Content is opaque: only the kind and the recipient are read. */
  forward(ws, post, message) {
    const bytes = new Uint8Array(message);
    if (!post.room || bytes.length < 21 || bytes[0] !== 1) return;
    const to = bytes.subarray(1, 9);
    const everyone = to.every((b) => b === 0);
    const target = everyone ? "" : String.fromCharCode(...to);
    for (let i = 0; i < 8; i++) bytes[1 + i] = post.id.charCodeAt(i);
    for (const other of [...(this.rooms.get(post.room) ?? [])])
      if (other !== ws && (everyone || this.posts.get(other)?.id === target))
        this.write(other, bytes);
  }

  webSocketMessage(ws, message) {
    const post = this.posts.get(ws);
    if (!post) return;
    if (typeof message === "string") {
      if (
        message.length > MAX_CONTROL ||
        encoder.encode(message).length > MAX_CONTROL
      )
        return this.close(ws, 1009);
      let value;
      try {
        value = JSON.parse(message);
      } catch {
        return this.close(ws, 1003);
      }
      if (post.room || value?.t !== "join") return;
      return this.join(ws, post, value);
    }
    if (message.byteLength > this.limits.payload) return this.close(ws, 1009);
    this.forward(ws, post, message);
  }

  webSocketClose(ws) {
    this.close(ws, 1000);
  }

  webSocketError(ws) {
    this.close(ws, 1011);
  }
}
