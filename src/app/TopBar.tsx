import { ChevronDown, History, Search } from "lucide-react";
import type { Journal } from "../../shared/journal";
import { Brand } from "../ui/Mark";
import { Clock } from "../ui/Clock";
import type { useSync } from "../sync/useSync";
import { moduleInfo } from "./modules";
import { enumLabel } from "../../shared/i18n/enums.ts";
import { t, tn } from "./i18n.ts";

type Sync = ReturnType<typeof useSync>;

/**
 * Top bar of the shell: journal switch, search, status in plain words
 * (shared or not, saved or not), the clock and the menu of the post. The
 * rarer actions (time machine, presentation, theme) are in that menu and in
 * the search (⌘K).
 */
export function TopBar({
  journal,
  author,
  sync,
  saveState,
  persistent,
  online,
  viewAt,
  onJournalMenu,
  onOperatorMenu,
  onPalette,
  onSync,
  onSave,
  onTimeMachine,
}: {
  journal: Journal;
  author: string;
  sync: Sync;
  saveState: string;
  persistent: boolean;
  online: boolean;
  viewAt: number | null;
  onJournalMenu: (anchor: HTMLElement) => void;
  onOperatorMenu: (anchor: HTMLElement) => void;
  onPalette: () => void;
  onSync: () => void;
  /** Where the session is kept (Réglages → Session et journal). */
  onSave: () => void;
  /** Leave the time machine (shown only while in the past). */
  onTimeMachine: () => void;
}) {
  const peersShown = sync.peers.slice(0, 4);
  return (
    <header className="bar">
      <Brand />
      <button
        className="journal-switch"
        onClick={(e) => onJournalMenu(e.currentTarget)}
        title={t("Journaux de la session")}
        aria-haspopup="menu"
      >
        <span className={`state-dot ${journal.closedAt ? "closed" : ""}`} />
        <strong>{journal.title}</strong>
        <small>
          {journal.closedAt ? t("Clôturé") : enumLabel(journal.mode)}
        </small>
        <ChevronDown size={14} />
      </button>
      <button
        className="command-trigger"
        onClick={onPalette}
        aria-label={t("Rechercher ou agir partout (⌘K)")}
        title={t("Rechercher ou agir partout (⌘K)")}
      >
        <Search size={15} />
        <span>
          {t("Rechercher")}
          <span className="wide">{t("… ou agir partout")}</span>
        </span>
        <kbd>⌘K</kbd>
      </button>
      <div className="bar-status">
        <button
          className={`status-chip ${sync.status === "live" ? "live" : sync.status === "retrying" || sync.status === "outdated" ? "warn" : ""}`}
          onClick={onSync}
          title={
            sync.status === "off"
              ? t(
                  "Cette session n’est que sur ce poste. Cliquer pour la partager avec d’autres postes.",
                )
              : sync.status === "outdated"
                ? sync.error
                : [
                    sync.status === "live"
                      ? t("Synchronisation active")
                      : t("Synchronisation en reconnexion"),
                    tn(
                      sync.relayCount,
                      "{n} autre(s) poste(s) (1)",
                      "{n} autre(s) poste(s)",
                    ),
                    ...(sync.conflictCount
                      ? [
                          tn(
                            sync.conflictCount,
                            "{n} fusion(s) à voir (1)",
                            "{n} fusion(s) à voir",
                          ),
                        ]
                      : []),
                  ].join(" · ")
          }
        >
          <span className={`radar ${sync.status === "live" ? "" : "idle"}`} />
          <span className="status-text">
            {sync.status === "off"
              ? t("Non partagé")
              : sync.status === "outdated"
                ? t("Recharger")
                : sync.status === "live"
                  ? tn(sync.relayCount + 1, "{n} poste", "{n} postes")
                  : t("Reconnexion")}
          </span>
          {sync.conflictCount > 0 && (
            <span className="mono">· {sync.conflictCount}</span>
          )}
          {peersShown.length > 0 && (
            <span className="avatars">
              {peersShown.map((p) => (
                <span
                  key={p.peer}
                  title={`${p.name} · ${moduleInfo(p.module).short}`}
                  style={{
                    ["--h" as string]: (p.name.charCodeAt(0) * 47) % 360,
                  }}
                >
                  {p.name.slice(0, 2).toUpperCase()}
                </span>
              ))}
            </span>
          )}
        </button>
        <button
          className={`status-chip ${saveState === "error" ? "crit" : persistent ? "ok hide-narrow" : "warn save-warn"}`}
          onClick={onSave}
          title={
            saveState === "error"
              ? t(
                  "L’enregistrement sur ce poste a échoué : exportez une copie maintenant.",
                )
              : persistent
                ? t(
                    "Enregistré et chiffré sur ce poste : rien n’est perdu en fermant l’onglet.",
                  )
                : t(
                    "Rien n’est gardé sur ce poste : fermer l’onglet efface la session. Cliquer pour la protéger ou l’exporter.",
                  )
          }
        >
          <span className="dot" />
          {saveState === "error"
            ? t("Échec sauvegarde")
            : saveState === "saving"
              ? t("Sauvegarde…")
              : persistent
                ? t("Enregistré")
                : t("Non enregistré")}
        </button>
        {!online && (
          <span
            className="status-chip warn hide-narrow"
            title={t("Hors ligne")}
          >
            <span className="dot" />
            {t("Hors ligne")}
          </span>
        )}
        <Clock />
        {viewAt !== null && (
          <button className="past-exit" onClick={onTimeMachine}>
            <History size={15} />
            {t("Revenir au direct")}
          </button>
        )}
        <button
          className="operator"
          onClick={(e) => onOperatorMenu(e.currentTarget)}
          title={t("Menu : réglages, affichage, session")}
          aria-label={t("Menu de {name} : réglages, affichage, session", {
            name: author,
          })}
          aria-haspopup="menu"
        >
          <span className="avatar">{author.slice(0, 2).toUpperCase()}</span>
          <span className="operator-name">{author}</span>
          <ChevronDown size={14} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
