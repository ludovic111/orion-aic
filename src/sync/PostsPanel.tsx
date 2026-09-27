import { useEffect, useMemo, useState } from "react";
import { KeyRound, UserX } from "lucide-react";
import { needCode, type PostView } from "../../shared/posts";
import { ageText } from "../../shared/live";
import { formatTime } from "../../shared/i18n/core.ts";
import { Modal } from "../journal/Modal";
import { moduleInfo } from "../app/modules";
import { useApp } from "../app/context";
import { usePost } from "../post/store";
import type { RekeyEvent, useSync } from "./useSync";
import { t, tn } from "./i18n.ts";
import "./posts.css";

// « Postes connectés » (Réglages → Synchronisation): who is in the session,
// online or not, up to date or not; « Retirer ce poste » and « Changer le
// code de session » (shared/rekey.ts). Written for people who are not at
// ease with computers: plain words, one question per dialog, big buttons.

type Sync = ReturnType<typeof useSync>;

/** Offline posts right after a change of code are still switching. */
const SWITCHING_MS = 20_000;

function useNow(every: number) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(timer);
  }, [every]);
  return now;
}

const nameOf = (row: Pick<PostView, "name">) =>
  row.name.trim() || t("Poste sans nom");
/** A name between quotes, as each language writes them. */
const quoted = (name: string) => t("« {name} »", { name });
const listOf = (rows: Pick<PostView, "name">[]) =>
  rows.map((r) => quoted(nameOf(r))).join(", ");

/** Text of the journal entry written by the post that changed the code. */
export function rekeyEntryText(event: RekeyEvent) {
  return event.names.length
    ? tn(
        event.names.length,
        "Code de session changé — poste {names} retiré. Il garde ce qu’il avait déjà, mais ne reçoit plus rien de nouveau.",
        "Code de session changé — postes {names} retirés. Ils gardent ce qu’ils avaient déjà, mais ne reçoivent plus rien de nouveau.",
        { names: event.names.join(", ") },
      )
    : t("Code de session changé.");
}

/** Short message shown when the code changes (toast). */
export function rekeyToastText(event: RekeyEvent) {
  if (event.kind === "removed")
    return t("Ce poste a été retiré de la session par {by}.", {
      by: event.by || t("un autre poste"),
    });
  if (event.kind === "missed")
    return t(
      "Le code de session a changé, mais ce poste ne l’a pas reçu : demandez le nouveau code.",
    );
  return event.own
    ? t("Nouveau code de session en place.")
    : t("{by} a changé le code de session : ce poste a suivi tout seul.", {
        by: event.by || t("Un autre poste"),
      });
}

/** What happened at the last change of code, until « Compris ». */
export function RekeyNotice({ sync }: { sync: Sync }) {
  const event = sync.rekey;
  const now = useNow(5_000);
  const rows = useMemo(
    () => sync.postsAt(now),
    [sync.postsAt, sync.postsTick, now],
  );
  if (!event) return null;
  // Offline at the change: at once; online then: if not back in a while.
  const waiting =
    event.kind === "follow"
      ? needCode(rows, event.at).filter(
          (v) => !v.switching || now - event.at > SWITCHING_MS,
        )
      : [];
  const tone = event.kind === "follow" ? "hint" : "hint warn";
  return (
    <div className={`${tone} rekey-notice`} role="status">
      <strong>
        {event.kind === "removed"
          ? t("Ce poste a été retiré de la session")
          : event.kind === "missed"
            ? t("Le code de session a changé")
            : event.own
              ? t("Nouveau code de session en place")
              : t("Le code de session a changé")}
      </strong>
      {event.kind === "removed" && (
        <p>
          {t(
            "{by} a changé le code sans ce poste. Ce poste garde tout ce qu’il avait déjà, mais ne reçoit plus rien et n’envoie plus rien. Pour revenir, demandez le nouveau code et saisissez-le ci-dessous.",
            { by: event.by || t("Un autre poste") },
          )}
        </p>
      )}
      {event.kind === "missed" && (
        <p>
          {t(
            "{by} a changé le code, mais ce poste ne l’a pas reçu (il venait d’arriver, ou il utilise une ancienne version). La synchronisation est arrêtée ici. Demandez le nouveau code et saisissez-le ci-dessous.",
            { by: event.by || t("Un autre poste") },
          )}
        </p>
      )}
      {event.kind === "follow" && (
        <p>
          {event.own
            ? t("Les postes connectés sont passés au nouveau code tout seuls.")
            : t(
                "{by} a changé le code. Ce poste est passé au nouveau code tout seul : rien à faire.",
                { by: event.by || t("Un autre poste") },
              )}
        </p>
      )}
      {event.names.length > 0 && event.kind !== "removed" && (
        <p>
          {tn(
            event.names.length,
            "Retiré : {names}. Il garde ce qu’il avait déjà, mais ne reçoit plus rien de nouveau.",
            "Retirés : {names}. Ils gardent ce qu’ils avaient déjà, mais ne reçoivent plus rien de nouveau.",
            { names: event.names.map((n) => quoted(n)).join(", ") },
          )}
        </p>
      )}
      {waiting.length > 0 && (
        <p>
          {t(
            "À donner à la main (hors ligne au moment du changement) : {names}. Le nouveau code et son QR code sont affichés ci-dessus.",
            { names: listOf(waiting) },
          )}
        </p>
      )}
      <div className="action-row">
        <button onClick={sync.dismissRekey}>{t("Compris")}</button>
      </div>
    </div>
  );
}

function StatePills({
  row,
  now,
  rotatedAt,
}: {
  row: PostView;
  now: number;
  rotatedAt: number;
}) {
  if (row.removed) return <span className="pill muted">{t("Retiré")}</span>;
  if (!row.online) {
    if (rotatedAt && row.lastSeen <= rotatedAt)
      return row.switching && now - rotatedAt < SWITCHING_MS ? (
        <span className="pill">{t("Passe au nouveau code…")}</span>
      ) : (
        <span className="pill warn">{t("N’a pas le nouveau code")}</span>
      );
    return (
      <span className="pill warn">
        {row.left ? t("A quitté") : t("Hors ligne")} ·{" "}
        {ageText(now - row.lastSeen)}
      </span>
    );
  }
  return (
    <>
      <span className="pill ok">{t("En ligne")}</span>
      {row.sync === "same" && <span className="pill ok">{t("À jour")}</span>}
      {row.sync === "catching-up" && (
        <span className="pill">{t("Mise à jour…")}</span>
      )}
      {row.sync === "behind" && (
        <span className="pill warn">{t("En retard")}</span>
      )}
      {row.sync === "ahead" && (
        <span className="pill warn">{t("Pas à jour ici")}</span>
      )}
    </>
  );
}

function PostRow({
  row,
  now,
  rotatedAt,
  onRemove,
}: {
  row: PostView;
  now: number;
  rotatedAt: number;
  onRemove?: () => void;
}) {
  const what = [row.role, row.cell].filter(Boolean).join(" · ");
  const where = row.online && row.module ? moduleInfo(row.module).short : "";
  return (
    <li
      className={`post-row ${row.removed ? "removed" : row.online ? "" : "off"}`}
    >
      <span
        className="post-avatar"
        aria-hidden
        style={{
          ["--h" as string]: ((nameOf(row).charCodeAt(0) || 63) * 47) % 360,
        }}
      >
        {nameOf(row).slice(0, 2).toUpperCase()}
      </span>
      <div className="post-main">
        <strong>{nameOf(row)}</strong>
        <small className="muted">
          {[what || t("Fonction non choisie"), where]
            .filter(Boolean)
            .join(" · ")}
        </small>
        <div className="post-pills">
          <StatePills row={row} now={now} rotatedAt={rotatedAt} />
        </div>
        <small className="muted">
          {row.online
            ? t("Connecté depuis {time}", { time: formatTime(row.since) })
            : t("Vu pour la dernière fois à {time}", {
                time: formatTime(row.lastSeen),
              })}
        </small>
        {row.sync === "behind" && (
          <small className="post-note">
            {t(
              "Il lui manque des changements depuis plus de 2 minutes. Vérifiez sa connexion (Wi-Fi, réseau).",
            )}
          </small>
        )}
        {row.sync === "ahead" && (
          <small className="post-note">
            {t(
              "Ses derniers changements n’arrivent pas sur ce poste depuis plus de 2 minutes. Vérifiez la connexion des deux postes.",
            )}
          </small>
        )}
        {row.online && !row.canFollow && (
          <small className="post-note">
            {t(
              "Ancienne version d’orion aic : si le code change, il faudra le saisir à la main sur ce poste.",
            )}
          </small>
        )}
        {row.twin && (
          <small className="post-note">
            {t(
              "Un autre poste porte le même nom : vérifiez de quel appareil il s’agit avant de retirer.",
            )}
          </small>
        )}
      </div>
      {onRemove && !row.removed && (
        <button className="danger post-remove" onClick={onRemove}>
          <UserX size={16} />
          {t("Retirer ce poste")}
        </button>
      )}
    </li>
  );
}

/** The confirmation of a change of code, in plain words. */
function RotateDialog({
  sync,
  row,
  rows,
  silent,
  onClose,
}: {
  sync: Sync;
  row: PostView | null;
  rows: PostView[];
  silent: number;
  onClose: () => void;
}) {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const others = rows.filter((r) => r !== row && !r.removed);
  const offline = others.filter((r) => !r.online);
  const oldVersion = others.filter((r) => r.online && !r.canFollow);
  const live = sync.status === "live";
  const confirm = async () => {
    setBusy(true);
    setError("");
    try {
      await sync.rotate(
        row
          ? {
              relays: row.online ? [row.relay] : [],
              nodes: row.node ? [row.node] : [],
              names: [nameOf(row)],
            }
          : {},
      );
      toast(
        row
          ? t("« {name} » est retiré. Nouveau code en place.", {
              name: nameOf(row),
            })
          : t("Nouveau code de session en place."),
      );
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  return (
    <Modal
      title={
        row
          ? t("Retirer « {name} » ?", { name: nameOf(row) })
          : t("Changer le code de session ?")
      }
      onClose={onClose}
    >
      <div className="stack rotate-dialog">
        <ul className="rotate-points">
          {row && (
            <li>
              {t(
                "« {name} » garde ce qu’il a déjà reçu, mais ne recevra plus rien de nouveau et ne pourra plus rien envoyer aux autres.",
                { name: nameOf(row) },
              )}
            </li>
          )}
          <li>
            {t(
              "Un nouveau code est créé. Les postes en ligne le reçoivent tout seuls et continuent sans rien faire.",
            )}
          </li>
          {offline.length > 0 && (
            <li>
              {tn(
                offline.length,
                "Hors ligne en ce moment : {names}. Il devra saisir le nouveau code à la main (il s’affichera ici, avec le QR code).",
                "Hors ligne en ce moment : {names}. Ils devront saisir le nouveau code à la main (il s’affichera ici, avec le QR code).",
                { names: listOf(offline) },
              )}
            </li>
          )}
          {oldVersion.length > 0 && (
            <li>
              {tn(
                oldVersion.length,
                "Ancienne version : {names}. Il devra aussi saisir le nouveau code à la main.",
                "Ancienne version : {names}. Ils devront aussi saisir le nouveau code à la main.",
                { names: listOf(oldVersion) },
              )}
            </li>
          )}
          {silent > 0 && (
            <li>
              {tn(
                silent,
                "{n} connexion sans nom ne recevra pas le nouveau code.",
                "{n} connexions sans nom ne recevront pas le nouveau code.",
              )}
            </li>
          )}
          <li>
            {t(
              "Le changement est noté au journal. Le code, lui, n’est jamais écrit au journal.",
            )}
          </li>
        </ul>
        {row?.twin && (
          <p className="hint warn">
            {t(
              "Un autre poste porte le même nom : vérifiez de quel appareil il s’agit avant de retirer.",
            )}
          </p>
        )}
        {!live && (
          <p className="hint warn">
            {t(
              "Pas de connexion pour l’instant : attendez « Connecté » pour changer le code.",
            )}
          </p>
        )}
        {error && <p className="error">{error}</p>}
        <div className="action-row rotate-actions">
          <button onClick={onClose} disabled={busy}>
            {t("Annuler")}
          </button>
          <button
            className={row ? "danger solid" : "primary"}
            onClick={() => void confirm()}
            disabled={busy || !live}
          >
            {row ? <UserX size={16} /> : <KeyRound size={16} />}
            {busy
              ? t("Changement en cours…")
              : row
                ? t("Retirer et changer le code")
                : t("Changer le code")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** « Postes connectés »: every post of the session, and changing the code. */
export function PostsPanel({ sync }: { sync: Sync }) {
  const { workspace } = useApp();
  const [post] = usePost();
  const now = useNow(10_000);
  const rows = useMemo(
    () => sync.postsAt(now),
    [sync.postsAt, sync.postsTick, now],
  );
  const [confirm, setConfirm] = useState<{ row: PostView | null } | null>(null);
  const live = sync.status === "live";
  const online = rows.filter((r) => r.online);
  // Connections that never said who they are (older version, or a post
  // listening without introducing itself), once the hellos had time.
  const silent =
    live && now - sync.liveSince > 15_000
      ? Math.max(0, sync.relayCount - online.length)
      : 0;
  const rotatedAt = sync.rekey?.kind === "follow" ? sync.rekey.at : 0;
  const self = [post.role, post.cell].filter(Boolean).join(" · ");
  return (
    <section className="stack posts-panel">
      <span className="label">
        {t("Postes connectés")} ·{" "}
        {tn(online.length + (live ? 1 : 0), "{n} en ligne", "{n} en ligne")}
      </span>
      <ul className="posts-list">
        <li className="post-row self">
          <span
            className="post-avatar"
            aria-hidden
            style={{
              ["--h" as string]:
                ((workspace.author.charCodeAt(0) || 63) * 47) % 360,
            }}
          >
            {workspace.author.slice(0, 2).toUpperCase()}
          </span>
          <div className="post-main">
            <strong>
              {workspace.author}{" "}
              <span className="muted">{t("(ce poste)")}</span>
            </strong>
            <small className="muted">{self || t("Fonction non choisie")}</small>
            <div className="post-pills">
              {live ? (
                <span className="pill ok">{t("En ligne")}</span>
              ) : (
                <span className="pill warn">{t("Pas connecté")}</span>
              )}
            </div>
          </div>
        </li>
        {rows.map((row) => (
          <PostRow
            key={row.key}
            row={row}
            now={now}
            rotatedAt={rotatedAt}
            onRemove={() => setConfirm({ row })}
          />
        ))}
      </ul>
      {!rows.length && (
        <p className="muted">
          {t(
            "Aucun autre poste pour l’instant. Donnez le code aux autres postes : ils apparaîtront ici.",
          )}
        </p>
      )}
      {silent > 0 && (
        <p className="hint warn">
          {tn(
            silent,
            "{n} connexion ne s’est pas présentée (ancienne version d’orion aic, ou appareil inconnu). Si personne ne l’attend, changez le code.",
            "{n} connexions ne se sont pas présentées (ancienne version d’orion aic, ou appareils inconnus). Si personne ne les attend, changez le code.",
          )}
        </p>
      )}
      <div className="card stack rotate-card">
        <strong>{t("Tablette perdue ? Poste parti ?")}</strong>
        <p className="muted">
          {t(
            "Changez le code de session : les postes connectés passent au nouveau code tout seuls. Le poste retiré garde ce qu’il a déjà, mais ne reçoit plus rien.",
          )}
        </p>
        <button
          className="rotate-button"
          disabled={!live}
          onClick={() => setConfirm({ row: null })}
        >
          <KeyRound size={16} />
          {t("Changer le code de session")}
        </button>
        {!live && (
          <small className="muted">
            {t(
              "Pas de connexion pour l’instant : attendez « Connecté » pour changer le code.",
            )}
          </small>
        )}
      </div>
      {confirm && (
        <RotateDialog
          sync={sync}
          row={confirm.row}
          rows={rows}
          silent={silent}
          onClose={() => setConfirm(null)}
        />
      )}
    </section>
  );
}
