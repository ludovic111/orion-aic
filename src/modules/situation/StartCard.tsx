import type { ReactNode } from "react";
import {
  BookOpen,
  Download,
  Inbox,
  LifeBuoy,
  Plus,
  Share2,
  X,
} from "lucide-react";
import type { Ref } from "../../../shared/links";
import { useApp } from "../../app/context";
import { t } from "./i18n.ts";
import "./start.css";

/**
 * « Par où commencer ? »: four plain steps, each with its button. Shown on
 * Situation until closed, once per post (prefs.startDone); the help page
 * « Bien démarrer » shows it again.
 */
export function StartCard({ onDone }: { onDone: () => void }) {
  const { compose, open, settings, exportCenter, help, readOnly } = useApp();
  const steps: {
    title: string;
    text: string;
    action: ReactNode;
  }[] = [
    {
      title: t("Noter ce qui se passe"),
      text: t(
        "Un fait, une décision, un appel : écrivez-le au journal. L’heure et le numéro sont ajoutés tout seuls.",
      ),
      action: !readOnly && (
        <button onClick={() => compose()}>
          <Plus size={14} />
          {t("Nouvelle entrée")}
        </button>
      ),
    },
    {
      title: t("Saisir un message reçu"),
      text: t(
        "Un message arrive par radio, téléphone ou papier : notez-le, il sera trié puis consigné.",
      ),
      action: !readOnly && (
        <button onClick={() => open("message:new" as Ref)}>
          <Inbox size={14} />
          {t("Nouveau message")}
        </button>
      ),
    },
    {
      title: t("Travailler à plusieurs"),
      text: t(
        "Donnez le code de session aux autres postes : tout se partage en direct, chiffré.",
      ),
      action: (
        <button onClick={() => settings("sync")}>
          <Share2 size={14} />
          {t("Partager la session")}
        </button>
      ),
    },
    {
      title: t("Garder une copie"),
      text: t(
        "Exportez régulièrement une archive ou un PDF : c’est votre sauvegarde.",
      ),
      action: (
        <button onClick={() => exportCenter()}>
          <Download size={14} />
          {t("Exporter")}
        </button>
      ),
    },
  ];
  return (
    <section className="card w-12 start-card" aria-labelledby="start-card">
      <div className="card-head">
        <BookOpen size={15} />
        <h2 id="start-card">{t("Par où commencer ?")}</h2>
        <button
          className="icon-button start-card-close"
          onClick={onDone}
          aria-label={t("Fermer ce guide")}
          title={t("Fermer ce guide")}
        >
          <X size={16} />
        </button>
      </div>
      <ol className="start-steps">
        {steps.map((step, i) => (
          <li key={step.title}>
            <span className="start-step-num" aria-hidden="true">
              {i + 1}
            </span>
            <div>
              <strong>{step.title}</strong>
              <p>{step.text}</p>
              {step.action}
            </div>
          </li>
        ))}
      </ol>
      <div className="start-card-foot">
        <button className="link" onClick={() => help("start")}>
          <LifeBuoy size={14} />
          {t("Toute l’aide, pas à pas")}
        </button>
        <button onClick={onDone}>{t("J’ai compris")}</button>
      </div>
    </section>
  );
}
