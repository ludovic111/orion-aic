import { Sparkles } from "lucide-react";
import type { Topic } from "./content";
import { H, Note, Path, Ui } from "./kit";

// « Quoi de neuf » : what changed in version 2.1, for people who knew 2.0.
// Registered in TOPICS by content.tsx.
export const NEWS_TOPIC: Topic = {
  id: "news",
  group: "start",
  title: "Quoi de neuf (version 2.1)",
  icon: Sparkles,
  hue: 30,
  short: (
    <p>
      Un écran plus simple, des photos, la liste des postes connectés, le
      retrait d’un poste perdu et les alertes officielles de crue et d’incendie
      de forêt. Rien n’a été supprimé : tout ce qui existait est encore là.
    </p>
  ),
  guide: (
    <>
      <H>Un écran plus simple</H>
      <ul>
        <li>
          Chaque bouton de la barre de gauche porte son nom. Les outils moins
          utilisés sont rangés sous <Ui>Plus d’outils</Ui>, à un toucher.
        </li>
        <li>
          En haut, <Ui>Non partagé</Ui> et <Ui>Non enregistré</Ui> disent
          clairement l’état de la session ; un toucher ouvre le bon réglage.
        </li>
        <li>
          La page Situation montre l’essentiel.{" "}
          <Ui>Afficher tout le tableau de bord</Ui> rend toutes les cartes.
        </li>
        <li>
          Une carte <Ui>Par où commencer ?</Ui> guide les premiers pas. Elle se
          retrouve dans l’Aide, rubrique Bien démarrer.
        </li>
      </ul>
      <H>Photos</H>
      <p>
        Le bouton <Ui>Photo</Ui> joint une photo à une entrée du journal, à un
        message ou à un objet de la carte. Sur un téléphone, il ouvre l’appareil
        photo. Voir la rubrique Photos.
      </p>
      <H>Qui est connecté ? Tablette perdue ?</H>
      <p>
        <Path steps={["Réglages", "Synchronisation"]} /> →{" "}
        <Ui>Postes connectés</Ui> : chaque poste, en ligne ou non, à jour ou en
        retard. <Ui>Retirer ce poste</Ui> change le code de session : les autres
        postes suivent tout seuls, le poste retiré ne reçoit plus rien de
        nouveau.
      </p>
      <H>Alertes officielles</H>
      <p>
        Le module Météo montre, pour le lieu de l’événement, les degrés de
        danger de crue et d’incendie de forêt publiés par la Confédération et
        les cantons, ainsi que le débit des cours d’eau proches. Un seuil de
        débit peut déclencher une alerte.
      </p>
      <Note kind="info">
        Après une mise à jour, rechargez la page sur tous les postes de la
        session : des postes de versions différentes peuvent refuser les données
        les uns des autres.
      </Note>
    </>
  ),
};
