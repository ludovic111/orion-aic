import { Camera } from "lucide-react";
import type { Topic } from "./content";
import { Faq, H, K, Note, Steps, Table, Ui } from "./kit";

// « Photos »: attach photos to an entry, a message or a map object.
// Registered in TOPICS by content.tsx.
export const PHOTOS_TOPIC: Topic = {
  id: "photos",
  group: "reference",
  title: "Photos",
  icon: Camera,
  hue: 200,
  short: (
    <p>
      Joignez des photos à une entrée du journal, à un message ou à un objet de
      la carte. Elles sont réduites et chiffrées sur le poste, puis partagées
      avec les autres postes de la session.
    </p>
  ),
  guide: (
    <>
      <H>Ajouter une photo</H>
      <Steps>
        <li>
          Ouvrez l’entrée, le message ou l’objet de la carte. Vous pouvez aussi
          commencer une nouvelle entrée ou un nouveau message.
        </li>
        <li>
          Appuyez sur <Ui>Photo</Ui>. Sur un téléphone, l’appareil photo s’ouvre
          ; <Ui>Galerie</Ui> choisit une photo déjà prise.
        </li>
        <li>
          La photo apparaît en petit. Dans une entrée ou un message existant,
          elle est enregistrée tout de suite. Dans une nouvelle entrée ou un
          nouveau message, elle part avec lui quand vous appuyez sur{" "}
          <Ui>Consigner</Ui> ou <Ui>Enregistrer le message</Ui>.
        </li>
      </Steps>
      <Note kind="info">
        Sur un ordinateur, <Ui>Photo</Ui> choisit un fichier. Vous pouvez aussi
        glisser une image sur la zone « Photos », ou la coller avec <K>Ctrl</K>{" "}
        + <K>V</K> (<K>⌘</K> + <K>V</K> sur Mac).
      </Note>
      <H>Voir, légender, supprimer</H>
      <Steps>
        <li>Touchez une petite photo : elle s’ouvre en grand.</li>
        <li>
          Les flèches, ou un glissement du doigt, passent à la photo suivante.
        </li>
        <li>
          <Ui>Légende (facultatif)</Ui> : quelques mots, enregistrés quand vous
          quittez le champ.
        </li>
        <li>
          Pour retirer une photo : <Ui>Supprimer</Ui>, puis{" "}
          <Ui>Supprimer la photo</Ui> pour confirmer.
        </li>
      </Steps>
      <Note kind="warn">
        Une photo supprimée disparaît de tous les postes. L’historique garde qui
        l’a ajoutée et qui l’a supprimée, mais plus l’image.
      </Note>
      <H>Placer sur la carte</H>
      <p>
        Si l’appareil photo a noté l’endroit de la prise de vue, orion aic
        propose <Ui>Placer sur la carte</Ui> juste après l’ajout. Un appui crée
        un point relié à l’entrée ou au message. Rien n’est placé sans votre
        accord.
      </p>
    </>
  ),
  full: (
    <>
      <H>Ce que devient la photo</H>
      <ul>
        <li>
          Elle est réduite sur le poste : 1600 pixels au plus sur le grand côté,
          quelques centaines de Ko.
        </li>
        <li>
          Les informations cachées de la photo d’origine (appareil, heure,
          position) ne sont pas gardées : seule l’image l’est.
        </li>
        <li>
          Elle est chiffrée avec la session sur le poste, envoyée chiffrée aux
          autres postes, et comprise dans l’archive <code>.orionaic</code>.
        </li>
        <li>
          La fiche A4 d’une entrée et la formule de message impriment ses photos
          (quatre par page). Le dossier d’export liste les photos et leurs
          légendes.
        </li>
        <li>
          Supprimer une entrée, un message ou un objet de la carte supprime
          aussi ses photos.
        </li>
      </ul>
      <H>Limites</H>
      <Table
        head={["Quoi", "Au plus"]}
        rows={[
          ["Photos d’une entrée, d’un message ou d’un objet", "12"],
          ["Une photo, une fois réduite", "environ 440 Ko"],
          ["Toutes les photos de la session", "40 Mo (environ 120 photos)"],
          ["Fichier de départ", "40 Mo"],
        ]}
      />
      <p>
        Au-delà, un message l’explique. Retirez les photos inutiles pour en
        ajouter d’autres.
      </p>
      <Faq q="La photo part-elle sur internet ?">
        Seulement vers les autres postes de la session, chiffrée comme tout le
        reste. Le serveur relais ne peut pas la voir et ne garde rien.
      </Faq>
      <Faq q="Deux personnes ajoutent une photo en même temps ?">
        Les deux photos sont gardées. Une photo n’en remplace jamais une autre.
      </Faq>
      <Faq q="Et la machine à remonter le temps ?">
        Elle montre les photos présentes à ce moment. Une photo supprimée depuis
        s’affiche comme « Photo supprimée ».
      </Faq>
      <Faq q="Puis-je joindre un PDF ou un autre document ?">
        Pas encore : notez sa référence dans l’entrée.
      </Faq>
    </>
  ),
};
