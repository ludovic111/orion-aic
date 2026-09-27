import type { Journal, Workspace } from "./journal.ts";
import { digest, isSlice, sliceJournal } from "./sync.ts";
import { versionVector, type VersionVector } from "./stamps.ts";
import { later } from "./hlc.ts";

// Decisions of the synchronisation protocol (used by src/sync/useSync.ts),
// kept free of the network so that they can be tested.
//
// - A hello carries, per journal, its digest and its version vector.
// - The answer to a hello is, per journal that differs: only what the peer
//   lacks (sliceJournal against its vector). A peer whose digest did not
//   move since our last partial answer (its vector claimed more than it
//   had, e.g. after a lost message) gets the whole journal, at most once a
//   minute.
// - A journal the peer does not have at all goes whole, from one post only:
//   the peer asks for it (`want` in a hello to that post alone, the first
//   post whose hello lists it), and asks another post if nothing came from
//   the first for ASK_TIMEOUT. Without it, a post joining a session of 40 MB
//   received 40 MB from every other post at once. A hello without `want`
//   comes from an earlier version, which asks nothing: every post sends it
//   the journals it lacks, as before.
// - A local change leaves as the difference with what was already sent.

export type Summary = Record<string, { d: string; w: VersionVector }>;
/** What this post remembers of one peer. */
export type PeerMemory = {
  /** Digest the peer had when we last sent it a partial journal. */
  partial: Map<string, string>;
  /** When we last sent it a whole journal. */
  whole: Map<string, number>;
};
export const newMemory = (): PeerMemory => ({
  partial: new Map(),
  whole: new Map(),
});
export const FULL_INTERVAL = 60_000;

export async function summarise(journals: Journal[]): Promise<Summary> {
  return Object.fromEntries(
    await Promise.all(
      journals.map(
        async (j) =>
          [j.id, { d: await digest(j), w: versionVector(j) }] as const,
      ),
    ),
  );
}

/**
 * What to send a peer after its hello, whether we differ at all, and the
 * journals it has that we lack (`lacking`, to ask for).
 * `want`: the journals the peer asks us for (undefined: a hello of an
 * earlier version, which gets every journal it lacks).
 * `awaited`: journals we lack and already asked of another post; they do
 * not count as a difference (nothing to tell this peer about them).
 */
export async function answerHello(
  journals: Journal[],
  gone: Workspace["gone"],
  theirs: Summary,
  memory: PeerMemory,
  now = Date.now(),
  want?: string[],
  awaited: (id: string) => boolean = () => false,
): Promise<{ send: Journal[]; differ: boolean; lacking: string[] }> {
  const send: Journal[] = [];
  let differ = false;
  for (const j of journals) {
    const t = theirs[j.id];
    const mine = await digest(j);
    if (t && t.d === mine) continue;
    differ = true;
    if (!t) {
      if (!want || want.includes(j.id)) send.push(j);
      continue;
    }
    const stale =
      memory.partial.get(j.id) === t.d &&
      now - (memory.whole.get(j.id) ?? -Infinity) > FULL_INTERVAL;
    if (stale) {
      send.push(j);
      memory.whole.set(j.id, now);
    } else {
      const slice = sliceJournal(j, t.w ?? {});
      if (slice) send.push(slice);
    }
    memory.partial.set(j.id, t.d);
  }
  // Journals the peer has and we do not (unless removed here).
  const own = new Set(journals.map((j) => j.id));
  const lacking = Object.keys(theirs).filter(
    (id) => !own.has(id) && !gone?.[id],
  );
  if (lacking.some((id) => !awaited(id))) differ = true;
  return { send, differ, lacking };
}

/** A journal this post lacks, asked of one post (relay id). */
export type Ask = { peer: string; at: number };
/**
 * An ask is given up when nothing came from that post for this long (no
 * part of a message in progress): the journal is asked again, of the first
 * post whose hello lists it.
 */
export const ASK_TIMEOUT = 30_000;

/**
 * The post journal `id` is being received from: asked recently, or parts
 * still arriving from it (`lastPart`: when the last part of a message in
 * progress came from a post, 0 if none). A given-up ask is forgotten.
 */
export function asked(
  asks: Map<string, Ask>,
  id: string,
  lastPart: (peer: string) => number,
  now = Date.now(),
): Ask | undefined {
  const ask = asks.get(id);
  if (!ask) return undefined;
  if (now - Math.max(ask.at, lastPart(ask.peer)) < ASK_TIMEOUT) return ask;
  asks.delete(id);
  return undefined;
}

/**
 * Which of the journals we lack to ask of `from`: those not being received
 * from another post already. Records the asks.
 */
export function pickAsks(
  lacking: string[],
  from: string,
  asks: Map<string, Ask>,
  lastPart: (peer: string) => number,
  now = Date.now(),
): string[] {
  const out: string[] = [];
  for (const id of lacking) {
    if (asked(asks, id, lastPart, now)) continue;
    asks.set(id, { peer: from, at: now });
    out.push(id);
  }
  return out;
}

/** Journals asked of `peer`, forgotten (it left): ask another post. */
export function dropAsks(asks: Map<string, Ask>, peer: string): boolean {
  let dropped = false;
  for (const [id, ask] of asks)
    if (ask.peer === peer) {
      asks.delete(id);
      dropped = true;
    }
  return dropped;
}

/** Latest stamps of two vectors. */
export const vvMax = (a: VersionVector = {}, b: VersionVector = {}) => {
  const out = { ...a };
  for (const [n, s] of Object.entries(b)) out[n] = later(out[n], s);
  return out;
};

/**
 * The local changes of `ids` not sent yet: a slice against what was
 * announced, or the whole journal the first time. Updates `announced`.
 */
export function localChanges(
  journals: Journal[],
  ids: string[],
  announced: Map<string, VersionVector>,
): Journal[] {
  const out: Journal[] = [];
  // A journal removed here and added again leaves whole.
  const present = new Set(journals.map((j) => j.id));
  for (const id of [...announced.keys()])
    if (!present.has(id)) announced.delete(id);
  for (const j of journals) {
    if (!ids.includes(j.id)) continue;
    const sent = announced.get(j.id);
    const part = sent ? sliceJournal(j, sent) : j;
    if (part) out.push(part);
    announced.set(j.id, vvMax(sent, versionVector(j)));
  }
  return out;
}

/** Ids of the journals of a message that are only parts (slices). */
export const partialIds = (journals: Journal[]) =>
  journals.filter(isSlice).map((j) => j.id);

/**
 * Journals of a received message that can be merged: a part of a journal
 * this post does not have would show an incomplete journal; it is left out
 * (`missing`), and the sender is asked for the whole one.
 */
export function usable(
  localIds: Iterable<string>,
  journals: Journal[],
  partial: string[] = [],
): { journals: Journal[]; missing: string[] } {
  const own = new Set(localIds);
  const parts = new Set(partial);
  const missing = journals
    .filter((j) => parts.has(j.id) && !own.has(j.id))
    .map((j) => j.id);
  return {
    journals: missing.length
      ? journals.filter((j) => !missing.includes(j.id))
      : journals,
    missing,
  };
}

/** What the others were told by a received message. */
export function noteReceived(
  journals: Journal[],
  announced: Map<string, VersionVector>,
) {
  for (const j of journals)
    announced.set(j.id, vvMax(announced.get(j.id), versionVector(j)));
}
