import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { getLang, onLang } from "../../shared/i18n/core.ts";
import { t } from "./i18n.ts";
import {
  journalSchema,
  packJournal,
  type Journal,
  type Workspace,
} from "../../shared/journal";
import {
  conflicts as conflictsOf,
  digest,
  mergeWorkspace,
  type Conflict,
} from "../../shared/sync";
import { versionVector, type VersionVector } from "../../shared/stamps";
import { stampSchema } from "../../shared/hlc";
import {
  answerHello,
  localChanges,
  newMemory,
  noteReceived,
  partialIds,
  summarise,
  usable,
  type PeerMemory,
  type Summary,
} from "../../shared/protocol";
import { parseTolerant } from "../../shared/tolerant";
import {
  ephemeralWire,
  isEphemeral,
  readEphemeral,
  type EphemeralWire,
} from "../../shared/ephemeral";
import {
  PEER_ID,
  PROTOCOL,
  Reassembler,
  newRoomCode,
  roomKeys,
  sealFrames,
  type RoomKeys,
} from "../../shared/room";
import { localNode } from "../../shared/hlc";
import {
  newExchangeKey,
  nextRotationStamp,
  openRekey,
  pickRotation,
  rekeySchema,
  rotationOutcome,
  sealRekey,
  type ExchangeKey,
  type RekeyBody,
} from "../../shared/rekey";
import {
  FORGET_MS,
  HEARTBEAT,
  ROLL_CALL_MS,
  afterRotation,
  rollCall,
  compareSummaries,
  noteComparison,
  notePost,
  postsView,
  removedRelays,
  rotationRecipients,
  type PostRecord,
} from "../../shared/posts";
import { readPost } from "../post/store";

// Live synchronisation of a session between posts, through the relay of the
// site (or of a post serving the local network). Messages are end-to-end
// encrypted with the session code; the relay forwards them and stores nothing.
//
// Protocol (version PROTOCOL, in every message):
// - hello: who I am, and for each journal its digest and version vector
//   (latest stamp seen of each post). Sent to everyone on connection and
//   every 40 s; answered, to the sender only, when something differs.
// - state: journals, whole or only what the recipient lacks (sliceJournal
//   against its version vector), and the removed journals. A peer whose
//   digest did not move after a partial state gets the whole journal.
// - presence, bye. Hellos and presence also carry the node (stable id of
//   the post), its function and cell, and a public key for a change of
//   code (kx, one per connection): « Postes connectés » (shared/posts.ts).
// - rekey: a change of code, the new code sealed for each post that stays
//   (shared/rekey.ts). Every post keeps the same winner among concurrent
//   changes and follows it (new room), listening to the old room for a
//   while for other changes of code only; a removed post, or one not given
//   the code, stops synchronising.
// - eph: ephemeral messages (shared/ephemeral.ts), handed to the listeners
//   of their kind and nothing else: never merged, stored or in the digests.
// Large messages are split into parts (shared/room.ts), so no frame ever
// reaches the limit of the relay.

export type SyncStatus =
  "off" | "connecting" | "live" | "retrying" | "outdated";
export type Presence = {
  peer: string;
  name: string;
  module: string;
  journal: string;
  at: number;
};
/** A journal received from another post and refused, with the reason. */
export type Rejected = {
  at: number;
  from: string;
  journal: string;
  reason: string;
};
type Wire =
  | ({
      type: "hello";
      v: number;
      peer: string;
      name: string;
      module: string;
      journal: string;
      journals: Summary;
      gone?: Record<string, string>;
      reply?: boolean;
    } & Self)
  | {
      type: "state";
      v: number;
      peer: string;
      name: string;
      journals: unknown[];
      gone?: Record<string, string>;
      digests?: Record<string, string>;
      /** Journals sent as parts (what the recipient lacks). */
      partial?: string[];
    }
  | ({
      type: "presence";
      v: number;
      peer: string;
      name: string;
      module: string;
      journal: string;
    } & Self)
  | { type: "bye"; v: number; peer: string }
  | ({ type: "rekey"; v: number; peer: string; name: string } & RekeyBody)
  | EphemeralWire;

/** What a post says of itself in its hellos and presence messages. */
type Self = { node?: string; role?: string; cell?: string; kx?: string };

/** A change of code seen in a room, with the code when given to us. */
type Candidate = RekeyBody & { code: string | null; by: string };
/** The changes of code of the room just left, listened to for a while. */
type Rotation = {
  socket: WebSocket;
  relay: string;
  candidates: Map<string, Candidate>;
  chosen: string;
  timer?: ReturnType<typeof setTimeout>;
};
/** How long the old room is listened to after a change of code. */
const GRACE = 60_000;

/** A change of code, as this post lived it. */
export type RekeyEvent = {
  /** follow: switch to `code`; removed / missed: stop synchronising. */
  kind: "follow" | "removed" | "missed";
  code?: string;
  /** Operator of the post that changed the code. */
  by: string;
  /** Posts removed (names). */
  names: string[];
  /** Made by this post. */
  own: boolean;
  at: number;
};

function finishRotation(state: Rotation) {
  clearTimeout(state.timer);
  if (state.socket.readyState <= WebSocket.OPEN) state.socket.close();
}
/** A connection that lasted this long resets the reconnection delay. */
const STABLE = 30_000;
const MAX_DELAY = 30_000;
/** Answers to one post: at most one hello per interval. */
const REPLY_INTERVAL = 3_000;
const BUFFERED = 1_000_000;

// Errors are kept as their French key and translated when shown, so that
// they follow a change of language.
type ErrorKey = Parameters<typeof t>[0] | "";
const NEWER: ErrorKey =
  "Un poste utilise une version plus récente d’orion aic — rechargez la page.";
const OLDER_PAGE: ErrorKey =
  "Cette page utilise une version plus ancienne d’orion aic — rechargez la page.";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Removed journals received: valid ids and stamps only. */
function goneOf(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const stamp = stampSchema.safeParse(v);
    if (stamp.success && /^[0-9a-f-]{36}$/.test(k)) out[k] = stamp.data;
  }
  return out;
}
const reasonOf = (issues: { path: PropertyKey[]; message: string }[]) =>
  issues
    .slice(0, 2)
    .map((i) => `${i.path.map(String).join(".") || "journal"} : ${i.message}`)
    .join(" ; ");

const seenKey = "orion-sync-conflicts-seen";
const loadSeen = (): Set<string> => {
  try {
    return new Set(JSON.parse(localStorage.getItem(seenKey) ?? "[]"));
  } catch {
    return new Set();
  }
};
/** Stable id of a conflict, to mark it as seen on this post. */
export const conflictId = (c: Conflict) =>
  c.kind === "collision"
    ? `${c.journalId}:${c.scope}:${c.number}:${c.items.length}`
    : `${c.journalId}:${c.target}:${c.kept.id}:${c.overwritten.map((o) => o.id).join(",")}`;

/** Listener of the ephemeral messages of one kind. */
export type EphemeralHandler = (
  data: unknown,
  from: { peer: string; name: string },
) => void;

export function useSync(options: {
  code: string | null;
  workspace: Workspace | null;
  author: string;
  module: string;
  localTick: number;
  takeDirty: () => string[];
  applyRemote: (update: (previous: Workspace) => Workspace) => void;
  onJoin?: (remote: Pick<Workspace, "journals" | "gone">) => void;
  onRemoteEntries?: (journalId: string, entryIds: string[]) => void;
  /** The session code changed (follow: keep `code`; else drop the code). */
  onRekey?: (event: RekeyEvent) => void;
}) {
  const [status, setStatus] = useState<SyncStatus>("off");
  const [relayCount, setRelayCount] = useState(0);
  const [peers, setPeers] = useState<Presence[]>([]);
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [error, setError] = useState<ErrorKey>("");
  // Re-render on a change of language (the error is translated when shown).
  useSyncExternalStore(onLang, getLang, getLang);
  const [rejected, setRejected] = useState<Rejected[]>([]);
  const latest = useRef(options);
  latest.current = options;
  const peerId = useRef(crypto.randomUUID());
  const channel = useRef<{
    socket: WebSocket;
    keys: RoomKeys;
    send: (wire: Wire, to?: string) => Promise<void>;
    /** Relay id of this connection. */
    relay: string;
    /** A change of code made here, handled like one received. */
    adopt: (candidate: Candidate) => void;
  } | null>(null);
  const joined = useRef(false);
  // What every post has been sent (or sent us), by journal: a local change
  // leaves as the difference.
  const announced = useRef(new Map<string, VersionVector>());
  const flushRef = useRef<(() => Promise<void>) | null>(null);
  // Ephemeral messages: listeners by kind.
  const ephemeral = useRef(new Map<string, Set<EphemeralHandler>>());
  // « Postes connectés »: what is known of each connection (memory only).
  const records = useRef(new Map<string, PostRecord>());
  const [postsTick, setPostsTick] = useState(0);
  const bump = useCallback(() => setPostsTick((n) => n + 1), []);
  // The next code comes from a change of code: keep what is known.
  const keepPosts = useRef(false);
  const rotation = useRef<Rotation | null>(null);
  const lastRotation = useRef("");
  const [rekey, setRekey] = useState<RekeyEvent | null>(null);
  const [liveSince, setLiveSince] = useState(0);

  const reject = useCallback((item: Omit<Rejected, "at">) => {
    setRejected((list) => [{ ...item, at: Date.now() }, ...list].slice(0, 50));
  }, []);

  const { code } = options;
  useEffect(() => {
    if (!code) {
      setStatus("off");
      setPeers([]);
      setRelayCount(0);
      return;
    }
    let stopped = false;
    let retry = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let stableTimer: ReturnType<typeof setTimeout> | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    joined.current = false;
    // A code typed by hand: other posts. After a change of code: the same
    // posts, now in another room.
    if (!keepPosts.current) records.current.clear();
    keepPosts.current = false;
    bump();
    // Key pair of the current connection (a change of code is sealed for it).
    let exchange: ExchangeKey | null = null;
    // Per peer (relay id): last hello answered, what was sent to it.
    const replied = new Map<string, number>();
    const memory = new Map<string, PeerMemory>();
    const names = new Map<string, string>();

    const workspace = () => latest.current.workspace;
    const journals = () => workspace()?.journals ?? [];
    const summary = () => summarise(journals());
    const base = () => ({
      v: PROTOCOL,
      peer: peerId.current,
      name: latest.current.author,
    });
    const self = (): Self => {
      const post = readPost();
      return {
        node: localNode(),
        role: post.role,
        cell: post.cell,
        kx: exchange?.publicKey,
      };
    };
    const hello = async (reply: boolean, to = "") => {
      const ch = channel.current;
      if (!ch) return;
      await ch.send(
        {
          ...base(),
          ...self(),
          type: "hello",
          module: latest.current.module,
          journal: workspace()?.activeId ?? "",
          journals: await summary(),
          gone: workspace()?.gone,
          reply,
        },
        to,
      );
    };
    const sendState = async (list: Journal[], to = "") => {
      const ch = channel.current;
      const ws = workspace();
      if (!ch || !ws) return;
      const digests = Object.fromEntries(
        await Promise.all(list.map(async (j) => [j.id, await digest(j)])),
      );
      await ch.send(
        {
          ...base(),
          type: "state",
          journals: list.map(packJournal),
          gone: ws.gone,
          digests,
          partial: partialIds(list),
        },
        to,
      );
      setLastSync(Date.now());
    };
    const seen = (p: Omit<Presence, "at">) =>
      setPeers((list) => [
        ...list.filter((x) => x.peer !== p.peer),
        { ...p, at: Date.now() },
      ]);
    /** What a connection says of itself (« Postes connectés »). */
    const note = (from: string, wire: Partial<Presence> & Self) => {
      records.current.set(
        from,
        notePost(records.current.get(from), from, wire, Date.now()),
      );
      bump();
    };

    /** What peer `from` lacks, after its hello. */
    async function answer(
      wire: Extract<Wire, { type: "hello" }>,
      from: string,
    ) {
      const peer = memory.get(from) ?? newMemory();
      memory.set(from, peer);
      const { send, differ } = await answerHello(
        journals(),
        workspace()?.gone,
        wire.journals ?? {},
        peer,
      );
      if (send.length) await sendState(send, from);
      const last = replied.get(from) ?? 0;
      if (!wire.reply || (differ && Date.now() - last > REPLY_INTERVAL)) {
        replied.set(from, Date.now());
        await hello(true, from);
      }
    }

    function versionOf(wire: { v?: unknown }) {
      const v = typeof wire.v === "number" ? wire.v : 1;
      if (v > PROTOCOL) {
        setStatus("outdated");
        setError(NEWER);
        return false;
      }
      return true;
    }

    async function receive(wire: Wire, from: string) {
      if (!wire || typeof wire !== "object" || wire.peer === peerId.current)
        return;
      if (!versionOf(wire)) return;
      if (isEphemeral(wire)) {
        const message = readEphemeral(wire);
        if (!message) return;
        for (const handler of ephemeral.current.get(message.kind) ?? [])
          handler(message.data, { peer: message.peer, name: message.name });
        return;
      }
      if ("name" in wire && typeof wire.name === "string")
        names.set(from, wire.name);
      const known = records.current.get(from);
      if (known) {
        records.current.set(from, { ...known, at: Date.now(), lost: 0 });
        if (known.lost) bump();
      }
      if (wire.type === "rekey") {
        await rekeyed(wire, from);
        return;
      }
      if (wire.type === "bye") {
        setPeers((list) => list.filter((x) => x.peer !== wire.peer));
        if (known) {
          records.current.set(from, { ...known, left: Date.now() });
          bump();
        }
        return;
      }
      if (wire.type === "presence") {
        seen(wire);
        note(from, wire);
        return;
      }
      if (wire.type === "hello") {
        seen(wire);
        note(from, wire);
        // Up to date? Its journals against ours, at its hello.
        const record = records.current.get(from);
        if (record) {
          const comparison = compareSummaries(
            await summary(),
            wire.journals ?? {},
            workspace()?.gone,
          );
          records.current.set(
            from,
            noteComparison(
              records.current.get(from) ?? record,
              comparison,
              Date.now(),
            ),
          );
          bump();
        }
        const gone = goneOf(wire.gone);
        if (Object.keys(gone).length && workspace())
          await apply([], gone, from, {});
        await answer(wire, from);
        return;
      }
      if (wire.type !== "state") return;
      const list: Journal[] = [];
      for (const raw of wire.journals ?? []) {
        const parsed = parseTolerant(journalSchema, raw);
        if (parsed.success) list.push(parsed.data as Journal);
        else {
          const title =
            raw && typeof raw === "object" && "title" in raw
              ? String((raw as { title: unknown }).title).slice(0, 80)
              : t("journal");
          reject({
            from: wire.name || names.get(from) || t("Poste inconnu"),
            journal: title,
            reason: reasonOf(parsed.error.issues),
          });
        }
      }
      const local = workspace();
      const { journals: whole, missing } = usable(
        (local?.journals ?? []).map((j) => j.id),
        list,
        Array.isArray(wire.partial) ? wire.partial.map(String) : [],
      );
      await apply(whole, goneOf(wire.gone), from, wire.digests ?? {});
      // Parts of journals this post lacks: ask for the whole ones.
      if (missing.length) {
        replied.set(from, Date.now());
        await hello(true, from);
      }
    }

    /** A change of code received in the room of the connection `via`. */
    async function rekeyed(
      raw: unknown,
      from: string,
      via: { socket: WebSocket; relay: string } | null = channel.current,
      key = exchange,
    ) {
      const parsed = rekeySchema.safeParse(raw);
      // The relay writes the sender: a post cannot pass off another's.
      if (!parsed.success || parsed.data.from !== from || !via) return;
      const body = parsed.data;
      const code =
        key && via.relay
          ? await openRekey(body, { relay: via.relay, key })
          : null;
      const by =
        raw && typeof raw === "object" && "name" in raw
          ? String((raw as { name: unknown }).name).slice(0, 120)
          : "";
      consider(via.socket, via.relay, { ...body, code, by });
    }

    /**
     * Every change of code seen in the room of `socket` (received, or made
     * here): the same winner on every post, followed at once; a better one
     * arriving while the old room is still listened to is followed too.
     */
    function consider(socket: WebSocket, relay: string, candidate: Candidate) {
      let state = rotation.current;
      if (!state || state.socket !== socket) {
        if (state) finishRotation(state);
        state = { socket, relay, candidates: new Map(), chosen: "" };
        rotation.current = state;
      }
      if (state.candidates.has(candidate.id) || state.candidates.size >= 32)
        return;
      state.candidates.set(candidate.id, candidate);
      // No winner (changes that void each other): keep the one followed.
      const winner = pickRotation([...state.candidates.values()]);
      if (!winner || winner.id === state.chosen) return;
      // Only a change followed counts for the stamp of the next one (a void
      // one, stamped at the end of time, must not block it).
      if (winner.stamp > lastRotation.current)
        lastRotation.current = winner.stamp;
      const first = !state.chosen;
      state.chosen = winner.id;
      // This room is left: nothing more is sent to it, and only changes of
      // code are read from it, for a while.
      if (channel.current?.socket === socket) channel.current = null;
      clearTimeout(state.timer);
      const current = state;
      state.timer = setTimeout(() => {
        finishRotation(current);
        if (rotation.current === current) rotation.current = null;
      }, GRACE);
      const now = Date.now();
      const removed = { relays: winner.removed, nodes: winner.nodes };
      const marked = first
        ? afterRotation(records.current.values(), removed, now)
        : [...records.current.values()].map((r) =>
            removed.relays.includes(r.relay) ||
            (!!r.node && removed.nodes.includes(r.node))
              ? { ...r, removed: true }
              : r,
          );
      for (const r of marked) records.current.set(r.relay, r);
      bump();
      const kind = rotationOutcome(winner, relay, winner.code);
      keepPosts.current = kind === "follow";
      const event: RekeyEvent = {
        kind,
        code: winner.code ?? undefined,
        by: winner.by,
        names: winner.names,
        own: winner.from === relay,
        at: now,
      };
      setRekey(event);
      latest.current.onRekey?.(event);
    }

    async function apply(
      list: Journal[],
      gone: Record<string, string>,
      from: string,
      digests: Record<string, string>,
    ) {
      const local = workspace();
      if (!local) {
        if (!joined.current && list.length && latest.current.onJoin) {
          joined.current = true;
          latest.current.onJoin({ journals: list, gone });
          setLastSync(Date.now());
        }
        return;
      }
      let merged: Workspace;
      try {
        merged = mergeWorkspace(local, { journals: list, gone });
      } catch (err) {
        reject({
          from: names.get(from) || t("Poste inconnu"),
          journal: list.map((j) => j.title).join(", ") || t("session"),
          reason: (err as Error).message,
        });
        return;
      }
      if (!list.length && merged.journals.length === local.journals.length)
        if (JSON.stringify(merged.gone) === JSON.stringify(local.gone)) return;
      latest.current.applyRemote((previous) =>
        mergeWorkspace(previous, { journals: list, gone }),
      );
      setLastSync(Date.now());
      // What the others were told by this message.
      noteReceived(list, announced.current);
      // Entries that just arrived from another post.
      for (const j of merged.journals) {
        const before = local.journals.find((x) => x.id === j.id);
        if (!before) continue;
        const known = new Set(before.entries.map((e) => e.id));
        const fresh = j.entries
          .filter((e) => !known.has(e.id))
          .map((e) => e.id);
        if (fresh.length) latest.current.onRemoteEntries?.(j.id, fresh);
      }
      // Still different from the sender: tell it what we have.
      let differ = false;
      for (const [id, d] of Object.entries(digests)) {
        const mine = merged.journals.find((x) => x.id === id);
        if (mine && (await digest(mine)) !== d) differ = true;
      }
      const last = replied.get(from) ?? 0;
      if (differ && Date.now() - last > REPLY_INTERVAL) {
        replied.set(from, Date.now());
        await hello(true, from);
      }
    }

    /** Local changes: what the other posts were not sent yet. */
    async function flush() {
      const ch = channel.current;
      const ws = workspace();
      if (!ch || !ws) return;
      const ids = latest.current.takeDirty();
      if (!ids.length) return;
      const list = localChanges(ws.journals, ids, announced.current);
      if (list.length || ids.includes("*")) await sendState(list);
    }
    flushRef.current = flush;

    async function connect() {
      if (stopped) return;
      setStatus(retry ? "retrying" : "connecting");
      let keys: RoomKeys;
      try {
        keys = await roomKeys(code!);
      } catch {
        setError("Chiffrement indisponible : ouvrez orion aic en HTTPS.");
        setStatus("off");
        return;
      }
      if (stopped) return;
      // A new key pair on every connection: a change of code sealed for an
      // earlier connection opens nothing (no replay).
      let key: ExchangeKey | null = null;
      try {
        key = await newExchangeKey();
      } catch {
        // No ECDH here: this post cannot follow a change of code by itself.
      }
      exchange = key;
      if (stopped) return;
      const scheme = location.protocol === "https:" ? "wss" : "ws";
      // The room id goes in the first message, never in the URL (proxies
      // log URLs).
      const socket = new WebSocket(`${scheme}://${location.host}/sync`);
      socket.binaryType = "arraybuffer";
      const parts = new Reassembler(keys.key);
      let queue = Promise.resolve();
      let fatal = false;
      let relay = "";
      // Other posts in the room, as the relay counts them.
      let count = 0;
      const send = async (wire: Wire, to = "") => {
        if (socket.readyState !== WebSocket.OPEN) return;
        const frames = await sealFrames(wire, keys.key, to);
        for (const frame of frames) {
          while (
            socket.readyState === WebSocket.OPEN &&
            socket.bufferedAmount > BUFFERED
          )
            await sleep(25);
          if (socket.readyState !== WebSocket.OPEN) return;
          socket.send(frame);
        }
      };
      socket.addEventListener("open", () => {
        if (stopped) return socket.close();
        socket.send(
          JSON.stringify({ t: "join", room: keys.room, v: PROTOCOL }),
        );
      });
      socket.addEventListener("message", (event) => {
        // A room left after a change of code: its counts and errors are
        // not those of the current room.
        const leftRoom =
          rotation.current?.socket === socket && !!rotation.current.chosen;
        if (typeof event.data === "string") {
          if (leftRoom) return;
          let data: {
            t?: string;
            n?: number;
            id?: string;
            code?: string;
            v?: number;
          };
          try {
            data = JSON.parse(event.data);
          } catch {
            return;
          }
          if (data.t === "peers") {
            const others = Math.max(0, (data.n ?? 1) - 1);
            // One post less: roll call, so that the one that dropped out
            // shows at once (the others answer a hello without `reply`).
            if (others < count && channel.current?.socket === socket) {
              const asked = Date.now();
              void hello(false);
              setTimeout(() => {
                if (stopped) return;
                for (const r of rollCall(
                  records.current.values(),
                  asked,
                  Date.now(),
                ))
                  records.current.set(r.relay, r);
                bump();
              }, ROLL_CALL_MS);
            }
            count = others;
            setRelayCount(others);
          } else if (data.t === "welcome") {
            relay = PEER_ID.test(data.id ?? "") ? data.id! : "";
            channel.current = {
              socket,
              keys,
              send,
              relay,
              adopt: (candidate) => consider(socket, relay, candidate),
            };
            setStatus("live");
            setLiveSince(Date.now());
            setError("");
            // The delay goes back to its minimum once the link holds.
            clearTimeout(stableTimer);
            stableTimer = setTimeout(() => {
              retry = 0;
            }, STABLE);
            // Changes made offline first, then what the others lack (the
            // hellos compare everything else).
            void flush().then(() => {
              for (const j of journals())
                if (!announced.current.has(j.id))
                  announced.current.set(j.id, versionVector(j));
              return hello(false);
            });
            clearInterval(heartbeat);
            heartbeat = setInterval(() => {
              void hello(true);
              setPeers((list) =>
                list.filter((p) => Date.now() - p.at < 2.2 * HEARTBEAT),
              );
              for (const [id, r] of records.current)
                if (Date.now() - r.at > FORGET_MS) records.current.delete(id);
              bump();
            }, HEARTBEAT);
          } else if (data.t === "error") {
            if (data.code === "version") {
              fatal = true;
              setStatus("outdated");
              setError((data.v ?? 0) > PROTOCOL ? OLDER_PAGE : NEWER);
            } else if (data.code === "rate" || data.code === "busy")
              setError(
                "Relais saturé : nouvelle tentative de connexion dans quelques secondes.",
              );
            else if (data.code === "full")
              setError("Session complète : 64 postes au plus sur le relais.");
          }
          return;
        }
        const bytes = new Uint8Array(event.data as ArrayBuffer);
        queue = queue.then(async () => {
          let message: { from: string; value: unknown } | undefined;
          try {
            message = await parts.accept(bytes);
          } catch {
            setError(
              "Message illisible reçu : un autre poste utilise-t-il un autre code ?",
            );
            return;
          }
          if (!message || !PEER_ID.test(message.from)) return;
          // A room left after a change of code: other changes of code only.
          const left = rotation.current;
          if (left?.socket === socket && left.chosen) {
            const value = message.value as { type?: unknown } | null;
            if (value?.type === "rekey")
              await rekeyed(value, message.from, { socket, relay }, key);
            return;
          }
          try {
            await receive(message.value as Wire, message.from);
          } catch (err) {
            reject({
              from: names.get(message.from) || t("Poste inconnu"),
              journal: t("message"),
              reason: (err as Error).message,
            });
          }
        });
      });
      socket.addEventListener("close", () => {
        if (channel.current?.socket === socket) channel.current = null;
        clearInterval(heartbeat);
        clearTimeout(stableTimer);
        if (rotation.current?.socket === socket) rotation.current = null;
        if (stopped) return;
        setRelayCount(0);
        if (fatal) return;
        setStatus("retrying");
        retry++;
        // Exponential, with jitter so that posts do not come back together.
        const delay = Math.min(MAX_DELAY, 800 * 2 ** Math.min(retry, 6));
        retryTimer = setTimeout(
          connect,
          delay / 2 + Math.random() * (delay / 2),
        );
      });
    }
    void connect();
    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      clearTimeout(stableTimer);
      clearInterval(heartbeat);
      flushRef.current = null;
      const ch = channel.current;
      if (ch) {
        void ch
          .send({ type: "bye", v: PROTOCOL, peer: peerId.current })
          .finally(() => ch.socket.close());
      }
      channel.current = null;
      // Another code, other posts: nothing was sent to them yet.
      announced.current.clear();
      setStatus("off");
      setPeers([]);
    };
  }, [code, reject]);

  // Local changes leave shortly after the last keystroke. Offline, they
  // wait (nothing is taken) and leave on reconnection.
  const { localTick } = options;
  useEffect(() => {
    if (!code) return;
    const timer = setTimeout(() => {
      if (channel.current) void flushRef.current?.();
    }, 300);
    return () => clearTimeout(timer);
  }, [localTick, code]);

  // Where this post is working, for the other posts.
  const { module, workspace } = options;
  const activeId = workspace?.activeId ?? "";
  useEffect(() => {
    const ch = channel.current;
    if (!ch) return;
    const post = readPost();
    void ch.send({
      type: "presence",
      v: PROTOCOL,
      peer: peerId.current,
      name: latest.current.author,
      module,
      journal: activeId,
      node: localNode(),
      role: post.role,
      cell: post.cell,
    });
  }, [module, activeId, status]);

  // The room left after a change of code is not listened to once gone.
  useEffect(
    () => () => {
      if (rotation.current) finishRotation(rotation.current);
      rotation.current = null;
    },
    [],
  );

  // What the merges did (numbers shared, concurrent changes), computed
  // once the session is quiet.
  const [found, setFound] = useState<Conflict[]>([]);
  const journalsNow = workspace?.journals;
  useEffect(() => {
    if (!journalsNow) {
      setFound([]);
      return;
    }
    const timer = setTimeout(
      () => setFound(journalsNow.flatMap((j) => conflictsOf(j))),
      1200,
    );
    return () => clearTimeout(timer);
  }, [journalsNow]);
  const [seenIds, setSeenIds] = useState(loadSeen);
  const markSeen = useCallback((ids: string[]) => {
    setSeenIds((previous) => {
      const next = new Set([...previous, ...ids]);
      try {
        localStorage.setItem(seenKey, JSON.stringify([...next].slice(-2000)));
      } catch {
        // Private window: the mark lasts until the page closes.
      }
      return next;
    });
  }, []);
  const conflictCount = useMemo(
    () =>
      found.filter((c) => !seenIds.has(conflictId(c))).length + rejected.length,
    [found, seenIds, rejected],
  );

  /**
   * Send an ephemeral message to the connected posts (or to the post of
   * relay id `to`); false when not connected (nothing is kept for later).
   */
  const sendEphemeral = useCallback(
    async (kind: string, data: unknown, to = "") => {
      const ch = channel.current;
      if (!ch) return false;
      await ch.send(
        ephemeralWire(
          { v: PROTOCOL, peer: peerId.current, name: latest.current.author },
          kind,
          data,
        ),
        to,
      );
      return true;
    },
    [],
  );
  /** Listen to the ephemeral messages of `kind`; returns the unsubscribe. */
  const onEphemeral = useCallback((kind: string, handler: EphemeralHandler) => {
    const map = ephemeral.current;
    const set = map.get(kind) ?? new Set<EphemeralHandler>();
    set.add(handler);
    map.set(kind, set);
    return () => {
      set.delete(handler);
      if (!set.size) map.delete(kind);
    };
  }, []);

  /**
   * Change the session code: a new code, sealed for each post online now
   * except the removed ones, then followed here like one received. Posts
   * removed by name only (offline) are named in the message and the
   * journal. Throws when not connected.
   */
  const rotate = useCallback(
    async (
      remove: { relays?: string[]; nodes?: string[]; names?: string[] } = {},
    ) => {
      const ch = channel.current;
      if (!ch || !ch.relay)
        throw new Error(t("Pas de connexion : réessayez dans un instant."));
      const now = Date.now();
      const nodes = (remove.nodes ?? []).filter((n) => n !== localNode());
      // Every connection of a removed post, not only the row clicked.
      const relays = removedRelays(records.current.values(), now, {
        relays: remove.relays,
        nodes,
      }).filter((r) => r !== ch.relay);
      const code = newRoomCode();
      const body = await sealRekey({
        code,
        stamp: nextRotationStamp(lastRotation.current, now, localNode()),
        from: ch.relay,
        recipients: rotationRecipients(
          records.current.values(),
          now,
          relays,
          nodes,
        ),
        removed: relays,
        nodes,
        names: remove.names ?? [],
      });
      // The code may have changed meanwhile (a change received): stop.
      if (channel.current !== ch)
        throw new Error(t("Le code de session vient de changer."));
      await ch.send({
        ...body,
        type: "rekey",
        v: PROTOCOL,
        peer: peerId.current,
        name: latest.current.author,
      });
      ch.adopt({ ...body, code, by: latest.current.author });
      return code;
    },
    [],
  );
  const dismissRekey = useCallback(() => setRekey(null), []);
  // Rows of « Postes connectés » at `now` (postsTick changes with every
  // message that tells something new about them).
  const postsAt = useCallback(
    (now: number) => postsView(records.current.values(), now),
    [],
  );

  return {
    postsAt,
    postsTick,
    rotate,
    rekey,
    dismissRekey,
    liveSince,
    relay: channel.current?.relay ?? "",
    status,
    relayCount,
    peers,
    lastSync,
    error: error ? t(error) : "",
    peerId: peerId.current,
    conflicts: found,
    rejected,
    conflictCount,
    seen: seenIds,
    markSeen,
    clearRejected: () => setRejected([]),
    sendEphemeral,
    onEphemeral,
  };
}
