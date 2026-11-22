// Protocol 2 of the live synchronisation relay: its number and limits. Used
// by the Node relay (server/relay.mjs: local network, Docker) and by the
// Cloudflare Durable Object (worker/relay.mjs: orionaic.xyz). No dependency.

export const PROTOCOL = 2;
/** Largest text (control) message. */
export const MAX_CONTROL = 4096;
export const LIMITS = {
  /** Largest frame: clients split messages into parts of 192 KiB. */
  payload: 1024 * 1024,
  peersPerRoom: 64,
  rooms: 2000,
  /** One address may be a whole command post behind one NAT. */
  socketsPerIp: 96,
  roomsPerIp: 16,
  /** Joins per address: a burst of 30, then one every 2 s. */
  joinBurst: 30,
  joinRefillMs: 2000,
  /** Bytes waiting for one post above which its senders are paused. */
  backlog: 2 * 1024 * 1024,
  /** Bytes waiting for one post above which it is disconnected. */
  hardBacklog: 16 * 1024 * 1024,
  /** Longest congestion of one post (ms) before it is disconnected. */
  stall: 45_000,
  joinTimeout: 10_000,
};
