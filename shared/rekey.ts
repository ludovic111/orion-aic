import { z } from "zod";
import { fromB64url, toB64url } from "./signature.ts";
import { PEER_ID, normalizeCode, validCode } from "./room.ts";
import { NODE, canonicalStamp, tick } from "./hlc.ts";

// Changing the session code while working (« Changer le code de session »,
// « Retirer ce poste »): a new code is drawn and handed to the posts that
// stay, and only to them, so that a lost tablet or a post that left receives
// nothing new. Everything here is pure (Web Crypto, no network) and tested
// in tests/sync-rekey.test.mjs; src/sync/useSync.ts does the sending.
//
// Keys. On every connection to the relay, a post draws an ECDH P-256 key
// pair (Web Crypto, private key not extractable, never stored) and announces
// its public key (`kx`) in its hello, encrypted with the session key like
// every message. A post keeps the first key announced by each relay
// connection: a later, different key from the same connection is ignored.
//
// Change. The post that changes the code draws the new code, an id, an HLC
// stamp and a one-time ECDH key pair, and sends one `rekey` message to the
// room. For each post that stays (online, with an announced key, not
// removed), it holds a box: the new code encrypted with AES-256-GCM under
//
//   HKDF-SHA-256(ECDH(one-time private key, key of that post),
//                salt "orion-aic/rekey/v1",
//                info id | sender | recipient | one-time key | recipient key)
//
// with, as associated data, the id, the stamp, the sender, the recipient
// and the removed connections. A removed post, like the relay, holds no
// private key that opens any box. Nothing is ever sent under the session
// key alone: a post without an announced key gets no box (no downgrade).
//
// Freshness. Keys change on every connection, so a box only opens on the
// connection it was made for: a recorded `rekey` replayed later opens
// nothing. The relay writes the sender of every frame; a `rekey` whose
// `from` is not its sender is ignored (a post cannot pass off another's).
//
// Concurrent changes. Every post applies pickRotation() to all the `rekey`
// messages seen in the room, and keeps listening to the old room for a
// while, so that all come to the same winner: a change whose author another
// change does not keep (removed, back on a new connection, unknown to it),
// or that keeps a post another change removes, is void; then the highest
// stamp wins (then the highest id). A removed post that answers within that
// while, even from a new connection, cannot win. A post that is not given
// the winning code stops synchronising: removed, or missed (it must type
// the new code).

export const REKEY_INFO = "orion-aic/rekey/v1";
const ECDH = { name: "ECDH", namedCurve: "P-256" } as const;
const utf8 = (s: string) => new TextEncoder().encode(s);

/** Raw P-256 public key (65 bytes) in base64url: 87 characters. */
const KX = /^[A-Za-z0-9_-]{87}$/;
export const isExchangeKey = (value: unknown): value is string =>
  typeof value === "string" && KX.test(value);

/** Key pair of one connection: public key announced, private key kept. */
export type ExchangeKey = { publicKey: string; privateKey: CryptoKey };

export async function newExchangeKey(): Promise<ExchangeKey> {
  const pair = (await crypto.subtle.generateKey(ECDH, false, [
    "deriveBits",
  ])) as CryptoKeyPair;
  const raw = await crypto.subtle.exportKey("raw", pair.publicKey);
  return {
    publicKey: toB64url(new Uint8Array(raw)),
    privateKey: pair.privateKey,
  };
}

const ROTATION_ID = /^[0-9a-f]{32}$/;
export const newRotationId = () =>
  [...crypto.getRandomValues(new Uint8Array(16))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

/** An HLC stamp (not an old ISO time): 38 characters. */
const hlcStamp = z
  .string()
  .length(38)
  .refine((s) => canonicalStamp(s) === s);

const boxSchema = z.object({
  to: z.string().regex(PEER_ID),
  iv: z.string().regex(/^[A-Za-z0-9_-]{16}$/),
  // {"code":…,"id":…,"to":…} + tag: about 150 characters.
  ct: z
    .string()
    .max(400)
    .regex(/^[A-Za-z0-9_-]+$/),
});

/** What a `rekey` message carries, besides the usual v, peer and name. */
export const rekeySchema = z.object({
  id: z.string().regex(ROTATION_ID),
  stamp: hlcStamp,
  /** Relay id of the sender (checked against the frame). */
  from: z.string().regex(PEER_ID),
  /** Relay ids of the removed connections. */
  removed: z.array(z.string().regex(PEER_ID)).max(64),
  /** Posts removed (node ids and names), shown to the others. */
  nodes: z.array(z.string().regex(NODE)).max(64),
  names: z.array(z.string().max(120)).max(64),
  /** One-time public key of the sender. */
  epub: z.string().regex(KX),
  boxes: z.array(boxSchema).max(64),
});
export type RekeyBody = z.infer<typeof rekeySchema>;

const aad = (
  b: Pick<RekeyBody, "id" | "stamp" | "from" | "removed">,
  to: string,
) =>
  utf8(
    [
      REKEY_INFO,
      b.id,
      b.stamp,
      b.from,
      to,
      [...b.removed].sort().join(","),
    ].join("\n"),
  );

async function boxKey(
  privateKey: CryptoKey,
  publicKey: string,
  info: string,
): Promise<CryptoKey> {
  const pub = await crypto.subtle.importKey(
    "raw",
    fromB64url(publicKey) as BufferSource,
    ECDH,
    false,
    [],
  );
  const shared = await crypto.subtle.deriveBits(
    { name: "ECDH", public: pub },
    privateKey,
    256,
  );
  const hkdf = await crypto.subtle.importKey("raw", shared, "HKDF", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: utf8(REKEY_INFO),
      info: utf8(info),
    },
    hkdf,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
const infoOf = (
  b: Pick<RekeyBody, "id" | "from" | "epub">,
  to: string,
  kx: string,
) => [REKEY_INFO, b.id, b.from, to, b.epub, kx].join("\n");

/** One post that stays: its relay id and the key it announced. */
export type Recipient = { relay: string; kx: string };

/**
 * The `rekey` message giving `code` to each recipient, and to nobody else.
 * Recipients listed in `removed`, or without a valid key, are left out.
 */
export async function sealRekey(options: {
  code: string;
  stamp: string;
  from: string;
  recipients: Recipient[];
  removed?: string[];
  nodes?: string[];
  names?: string[];
  id?: string;
}): Promise<RekeyBody> {
  const code = normalizeCode(options.code);
  if (!validCode(code)) throw new Error("Invalid session code.");
  const removed = [...new Set(options.removed ?? [])];
  const one = (await crypto.subtle.generateKey(ECDH, false, [
    "deriveBits",
  ])) as CryptoKeyPair;
  const body: RekeyBody = {
    id: options.id ?? newRotationId(),
    stamp: options.stamp,
    from: options.from,
    removed,
    nodes: [...new Set(options.nodes ?? [])],
    names: [...new Set(options.names ?? [])],
    epub: toB64url(
      new Uint8Array(await crypto.subtle.exportKey("raw", one.publicKey)),
    ),
    boxes: [],
  };
  const seen = new Set<string>();
  for (const r of options.recipients) {
    if (
      removed.includes(r.relay) ||
      r.relay === body.from ||
      seen.has(r.relay) ||
      !PEER_ID.test(r.relay) ||
      !isExchangeKey(r.kx)
    )
      continue;
    let key: CryptoKey;
    try {
      key = await boxKey(one.privateKey, r.kx, infoOf(body, r.relay, r.kx));
    } catch {
      // Not a point of the curve: that connection gets nothing, and cannot
      // stop the others from getting the code.
      continue;
    }
    seen.add(r.relay);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: aad(body, r.relay) },
      key,
      utf8(JSON.stringify({ code, id: body.id, to: r.relay })),
    );
    body.boxes.push({
      to: r.relay,
      iv: toB64url(iv),
      ct: toB64url(new Uint8Array(ct)),
    });
  }
  return rekeySchema.parse(body);
}

/**
 * The new code in a `rekey` message for the connection `relay` holding
 * `key`, or null (no box for it, altered, or not a session code).
 */
export async function openRekey(
  body: RekeyBody,
  me: { relay: string; key: ExchangeKey },
): Promise<string | null> {
  if (body.removed.includes(me.relay)) return null;
  const box = body.boxes.find((b) => b.to === me.relay);
  if (!box) return null;
  try {
    const key = await boxKey(
      me.key.privateKey,
      body.epub,
      infoOf(body, me.relay, me.key.publicKey),
    );
    const plain = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: fromB64url(box.iv) as BufferSource,
        additionalData: aad(body, me.relay),
      },
      key,
      fromB64url(box.ct) as BufferSource,
    );
    const value = JSON.parse(new TextDecoder().decode(plain)) as {
      code?: unknown;
      id?: unknown;
      to?: unknown;
    };
    if (value.id !== body.id || value.to !== me.relay) return null;
    const code = normalizeCode(String(value.code ?? ""));
    return validCode(code) ? code : null;
  } catch {
    return null;
  }
}

/** What decides between concurrent changes of code. */
export type RotationMeta = Pick<
  RekeyBody,
  "id" | "stamp" | "from" | "removed"
> & { boxes: readonly { to: string }[] };

/** The connections a change keeps: its author and those given the code. */
const kept = (c: RotationMeta) =>
  new Set([
    c.from,
    ...c.boxes.map((b) => b.to).filter((to) => !c.removed.includes(to)),
  ]);

/**
 * The change of code every post keeps among those seen in one room, the
 * same whatever the order they arrived in. A change whose author removes
 * itself is ignored. A change is void when another change does not keep its
 * author (a post removed, or that came back on a new connection, or that
 * was not known to it), or removes a post it keeps. Among those that stand,
 * the highest stamp, then the highest id, wins. When none stands (e.g. two
 * posts removing each other), there is no winner: each post keeps the
 * change it already follows. A removed post that answers a change cannot
 * win, whatever its stamp.
 */
export function pickRotation<C extends RotationMeta>(
  list: readonly C[],
): C | undefined {
  const sane = list.filter((c) => !c.removed.includes(c.from));
  const keeps = new Map(sane.map((c) => [c, kept(c)]));
  const standing = sane.filter((c) =>
    sane.every(
      (d) =>
        d === c ||
        (keeps.get(d)!.has(c.from) &&
          ![...keeps.get(c)!].some((x) => d.removed.includes(x))),
    ),
  );
  let best: C | undefined;
  for (const c of standing)
    if (
      !best ||
      c.stamp > best.stamp ||
      (c.stamp === best.stamp && c.id > best.id)
    )
      best = c;
  return best;
}

/**
 * Stamp of a new change after `last` (the latest change followed): later
 * than it, or a fresh one if it is so far in the future that the next
 * stamp would not be a stamp any more.
 */
export function nextRotationStamp(
  last: string,
  now: number,
  node: string,
): string {
  const next = tick(last || undefined, now, node);
  return hlcStamp.safeParse(next).success ? next : tick(undefined, now, node);
}

/**
 * What the winning change means for the connection `relay`: follow it
 * (the code is known), removed, or missed (not removed, but not given the
 * code: it must be typed).
 */
export function rotationOutcome(
  winner: RotationMeta,
  relay: string,
  code: string | null,
): "follow" | "removed" | "missed" {
  if (winner.removed.includes(relay)) return "removed";
  return code ? "follow" : "missed";
}
