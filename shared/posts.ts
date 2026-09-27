import type { Summary } from "./protocol.ts";
import type { VersionVector } from "./stamps.ts";
import { NODE } from "./hlc.ts";
import { isExchangeKey } from "./rekey.ts";

// « Postes connectés »: what this post knows of the other posts of the
// session, from their hellos and presence messages (src/sync/useSync.ts).
// Kept in memory only, while the page is open: names and functions are
// never written to the browser storage in clear.
//
// A post is identified by its node (the id written in its stamps, kept with
// its session), so that it keeps one row across reconnections; a
// connection is identified by its relay id. Everything a post says of
// itself (name, function, node) is declarative (see SECURITY.md).

/** Hello interval of useSync. */
export const HEARTBEAT = 40_000;
/** Online: a message within two hellos and a bit. */
export const ONLINE_MS = 2.2 * HEARTBEAT;
/** Data that differs for less than this is catching up, not behind. */
export const SETTLE_MS = 120_000;
/** Posts not seen for this long are forgotten. */
export const FORGET_MS = 12 * 3_600_000;

/** One connection of another post. */
export type PostRecord = {
  /** Relay id of the connection. */
  relay: string;
  /** Node of the post ("" for an older version that does not send it). */
  node: string;
  name: string;
  /** Function and cell chosen on that post (Réglages → Ce poste). */
  role: string;
  cell: string;
  module: string;
  /** Key announced for a change of code ("" = cannot follow one). */
  kx: string;
  /** First and latest message of this connection. */
  since: number;
  at: number;
  /** When it said goodbye (page closed, sync stopped). */
  left: number;
  /** When a change of code made us leave the room it was in. */
  rotated: number;
  /** When it did not answer a roll call (the relay counted one post less). */
  lost: number;
  /** Removed by a change of code. */
  removed: boolean;
  /** Its data compared with ours, at its latest hello. */
  checked: number;
  differSince: number | null;
  lacks: boolean;
};

export const newRecord = (relay: string, now: number): PostRecord => ({
  relay,
  node: "",
  name: "",
  role: "",
  cell: "",
  module: "",
  kx: "",
  since: now,
  at: now,
  left: 0,
  rotated: 0,
  lost: 0,
  removed: false,
  checked: 0,
  differSince: null,
  lacks: false,
});

/**
 * A message from a connection: what it says of itself. The first key a
 * connection announces is kept (a later, different one is ignored).
 */
export function notePost(
  previous: PostRecord | undefined,
  relay: string,
  said: Partial<
    Pick<PostRecord, "node" | "name" | "role" | "cell" | "module" | "kx">
  >,
  now: number,
): PostRecord {
  const base = previous ?? newRecord(relay, now);
  const text = (v: unknown, max = 120) =>
    typeof v === "string" ? v.slice(0, max) : undefined;
  return {
    ...base,
    node:
      typeof said.node === "string" && NODE.test(said.node)
        ? said.node
        : base.node,
    name: text(said.name) ?? base.name,
    role: text(said.role) ?? base.role,
    cell: text(said.cell) ?? base.cell,
    module: text(said.module, 40) ?? base.module,
    kx: base.kx || (isExchangeKey(said.kx) ? said.kx : ""),
    at: now,
    left: 0,
    lost: 0,
  };
}

export type Comparison = {
  /** Same data. */
  same: boolean;
  /** It lacks changes we have. */
  lacks: boolean;
  /** We lack changes it has. */
  ahead: boolean;
};

const newer = (a: VersionVector = {}, b: VersionVector = {}) =>
  Object.entries(a).some(([n, s]) => s > (b[n] ?? ""));

/** Our journals against those a post announced in its hello. */
export function compareSummaries(
  mine: Summary,
  theirs: Summary,
  gone: Record<string, string> = {},
): Comparison {
  let lacks = false;
  let ahead = false;
  for (const [id, m] of Object.entries(mine)) {
    const t = theirs[id];
    if (!t) {
      lacks = true;
      continue;
    }
    if (t.d === m.d) continue;
    const l = newer(m.w, t.w);
    const a = newer(t.w, m.w);
    lacks ||= l;
    ahead ||= a;
    // Different, with the same stamps (older data): count it as lacking.
    if (!l && !a) lacks = true;
  }
  for (const id of Object.keys(theirs))
    if (!mine[id] && !gone[id]) ahead = true;
  return { same: !lacks && !ahead, lacks, ahead };
}

/** Its hello compared with our data. */
export function noteComparison(
  record: PostRecord,
  comparison: Comparison,
  now: number,
): PostRecord {
  return {
    ...record,
    checked: now,
    differSince: comparison.same ? null : (record.differSince ?? now),
    lacks: comparison.lacks,
  };
}

export type PostSync =
  /** Same data at its latest hello. */
  | "same"
  /** Different for a short while: the changes are on their way. */
  | "catching-up"
  /** It lacks our changes for a while. */
  | "behind"
  /** We lack its changes for a while. */
  | "ahead"
  /** Not compared (offline, or no hello yet). */
  | "unknown";

export type PostView = {
  key: string;
  relay: string;
  node: string;
  name: string;
  role: string;
  cell: string;
  module: string;
  online: boolean;
  /** Said goodbye (page closed) rather than lost. */
  left: boolean;
  removed: boolean;
  /** Connected since / last message. */
  since: number;
  lastSeen: number;
  sync: PostSync;
  /** Can follow a change of code (announced a key). */
  canFollow: boolean;
  /** Another online post bears the same name or node: check before removing. */
  twin: boolean;
  /** Was online when a change of code left its room: on its way to the new one. */
  switching: boolean;
};

export const isOnline = (r: PostRecord, now: number) =>
  !r.left && !r.lost && !r.rotated && !r.removed && now - r.at < ONLINE_MS;

/** Time given to every post to answer a roll call. */
export const ROLL_CALL_MS = 5_000;
/**
 * A roll call: when the relay counts one post less, every post is asked to
 * say hello (useSync). Those that did not answer since `asked` have dropped
 * out: shown offline at once rather than after two missed hellos.
 */
export function rollCall(
  records: Iterable<PostRecord>,
  asked: number,
  now: number,
): PostRecord[] {
  return [...records].map((r) =>
    isOnline(r, now) && r.at < asked ? { ...r, lost: now } : r,
  );
}

function syncOf(r: PostRecord, now: number): PostSync {
  if (!isOnline(r, now) || !r.checked) return "unknown";
  if (r.differSince === null) return "same";
  if (now - r.differSince < SETTLE_MS) return "catching-up";
  return r.lacks ? "behind" : "ahead";
}

const RANK: Record<string, number> = {
  offline: 0,
  behind: 1,
  ahead: 1,
  other: 2,
  removed: 3,
};

/**
 * The rows of « Postes connectés »: one per post (per node), or one per
 * connection when a post is connected twice. Offline posts come first (a
 * post that dropped out shows at once), then those behind, then the others
 * by name; removed posts last.
 */
export function postsView(
  records: Iterable<PostRecord>,
  now: number,
): PostView[] {
  const groups = new Map<string, PostRecord[]>();
  for (const r of records) {
    if (now - r.at > FORGET_MS) continue;
    const key = r.node || `relay:${r.relay}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const rows: PostRecord[] = [];
  for (const list of groups.values()) {
    const online = list.filter((r) => isOnline(r, now));
    if (online.length) rows.push(...online);
    else
      rows.push(
        list.reduce((a, b) =>
          b.removed !== a.removed ? (b.removed ? b : a) : b.at > a.at ? b : a,
        ),
      );
  }
  const onlineRows = rows.filter((r) => isOnline(r, now));
  const views = rows.map((r): PostView => {
    const online = isOnline(r, now);
    const name = r.name.trim().toLowerCase();
    return {
      key: `${r.node || r.relay}:${r.relay}`,
      relay: r.relay,
      node: r.node,
      name: r.name,
      role: r.role,
      cell: r.cell,
      module: r.module,
      online,
      left: !!r.left && !r.removed,
      removed: r.removed,
      since: r.since,
      lastSeen: r.at,
      sync: syncOf(r, now),
      canFollow: !!r.kx,
      switching: !!r.rotated && !r.removed,
      twin:
        online &&
        onlineRows.some(
          (o) =>
            o !== r &&
            ((!!r.node && o.node === r.node) ||
              (!!name && o.name.trim().toLowerCase() === name)),
        ),
    };
  });
  const rank = (v: PostView) =>
    v.removed
      ? RANK.removed
      : !v.online
        ? RANK.offline
        : v.sync === "behind" || v.sync === "ahead"
          ? RANK.behind
          : RANK.other;
  return views.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      a.name.localeCompare(b.name) ||
      a.key.localeCompare(b.key),
  );
}

/**
 * The posts a change of code is given to: online, with a key, not removed
 * (by connection, or by node: every connection of a removed post).
 */
export function rotationRecipients(
  records: Iterable<PostRecord>,
  now: number,
  removed: string[] = [],
  nodes: string[] = [],
): { relay: string; kx: string }[] {
  return [...records]
    .filter(
      (r) =>
        isOnline(r, now) &&
        r.kx &&
        !removed.includes(r.relay) &&
        !(r.node && nodes.includes(r.node)),
    )
    .map((r) => ({ relay: r.relay, kx: r.kx }));
}

/**
 * The connections a removal leaves out: those chosen, and every connection
 * online of the posts removed (same node), so that a post connected twice
 * (a reconnection, or on purpose) gets nothing on its other connection.
 * At most 64, like the room.
 */
export function removedRelays(
  records: Iterable<PostRecord>,
  now: number,
  remove: { relays?: string[]; nodes?: string[] },
): string[] {
  const nodes = remove.nodes ?? [];
  const out = new Set(remove.relays ?? []);
  for (const r of records)
    if (r.node && nodes.includes(r.node) && isOnline(r, now)) out.add(r.relay);
  return [...out].slice(0, 64);
}

/**
 * After a change of code: the connections online in the old room left it;
 * those removed (by relay id or node) are marked so.
 */
export function afterRotation(
  records: Iterable<PostRecord>,
  removed: { relays: string[]; nodes: string[] },
  now: number,
): PostRecord[] {
  return [...records].map((r) => ({
    ...r,
    rotated: r.rotated || (isOnline(r, now) ? now : 0),
    removed:
      r.removed ||
      removed.relays.includes(r.relay) ||
      (!!r.node && removed.nodes.includes(r.node)),
  }));
}

/**
 * Posts that were not online when the code changed and were not removed:
 * they must be given the new code by hand. Offline rows seen before `at`.
 */
export function needCode(views: PostView[], at: number): PostView[] {
  return views.filter((v) => !v.online && !v.removed && v.lastSeen <= at);
}
