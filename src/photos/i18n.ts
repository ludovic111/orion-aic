import { translator, type Dict } from "../../shared/i18n/core.ts";
import { common } from "../../shared/i18n/common.ts";

// Photos of entries, messages and map objects (src/photos).
export const { t, tn, dict } = translator({
  ...common,
  Photo: { de: "Foto", it: "Foto" },
  Photos: { de: "Fotos", it: "Foto" },
  Galerie: { de: "Galerie", it: "Galleria" },
  "Préparation…": { de: "Wird vorbereitet…", it: "Preparazione…" },
  "{n} photo": { de: "{n} Foto", it: "{n} foto" },
  "{n} photos": { de: "{n} Fotos", it: "{n} foto" },
  "Photo ajoutée.": { de: "Foto hinzugefügt.", it: "Foto aggiunta." },
  "{n} photos ajoutées.": {
    de: "{n} Fotos hinzugefügt.",
    it: "{n} foto aggiunte.",
  },
  "Photo supprimée.": { de: "Foto gelöscht.", it: "Foto eliminata." },
  "Légende enregistrée.": {
    de: "Legende gespeichert.",
    it: "Didascalia salvata.",
  },
  Légende: { de: "Legende", it: "Didascalia" },
  "Légende (facultatif)": {
    de: "Legende (freiwillig)",
    it: "Didascalia (facoltativa)",
  },
  "ou glissez / collez une image ici": {
    de: "oder Bild hierher ziehen / einfügen",
    it: "o trascinate / incollate un’immagine qui",
  },
  "Voir la photo {n}": { de: "Foto {n} ansehen", it: "Vedere la foto {n}" },
  "Retirer la photo {n}": {
    de: "Foto {n} entfernen",
    it: "Togliere la foto {n}",
  },
  "Photo {n} sur {count}": {
    de: "Foto {n} von {count}",
    it: "Foto {n} di {count}",
  },
  "Photo précédente": { de: "Vorheriges Foto", it: "Foto precedente" },
  "Photo suivante": { de: "Nächstes Foto", it: "Foto successiva" },
  "Fermer la photo": { de: "Foto schliessen", it: "Chiudere la foto" },
  "Ajoutée par {name} · {when}": {
    de: "Hinzugefügt von {name} · {when}",
    it: "Aggiunta da {name} · {when}",
  },
  "Supprimer la photo": { de: "Foto löschen", it: "Eliminare la foto" },
  "Supprimer cette photo ? Elle disparaît aussi des autres postes. L’historique garde qui l’a ajoutée et supprimée, pas l’image.":
    {
      de: "Dieses Foto löschen? Es verschwindet auch auf den anderen Arbeitsplätzen. Der Verlauf behält, wer es hinzugefügt und gelöscht hat, nicht das Bild.",
      it: "Eliminare questa foto? Scompare anche dalle altre postazioni. La cronologia conserva chi l’ha aggiunta ed eliminata, non l’immagine.",
    },
  "Photo supprimée : l’image n’est plus conservée.": {
    de: "Foto gelöscht: Das Bild wird nicht mehr aufbewahrt.",
    it: "Foto eliminata: l’immagine non è più conservata.",
  },
  "La photo indique où elle a été prise.": {
    de: "Das Foto enthält den Aufnahmeort.",
    it: "La foto indica dove è stata scattata.",
  },
  "Non merci": { de: "Nein danke", it: "No grazie" },
  "Point placé sur la carte, relié à cet élément.": {
    de: "Punkt auf der Karte platziert, mit diesem Element verknüpft.",
    it: "Punto posizionato sulla carta, collegato a questo elemento.",
  },
  "Placé d’après la position enregistrée par l’appareil photo.": {
    de: "Platziert nach dem von der Kamera gespeicherten Standort.",
    it: "Posizionato secondo la posizione registrata dalla fotocamera.",
  },
  "Ce fichier n’est pas une photo.": {
    de: "Diese Datei ist kein Foto.",
    it: "Questo file non è una foto.",
  },
  "Cette photo est trop grande ({size} Mo). Choisissez-en une autre.": {
    de: "Dieses Foto ist zu gross ({size} MB). Wählen Sie ein anderes.",
    it: "Questa foto è troppo grande ({size} MB). Sceglietene un’altra.",
  },
  "Cette image ne peut pas être lue. Essayez une photo JPEG ou PNG.": {
    de: "Dieses Bild kann nicht gelesen werden. Versuchen Sie ein JPEG- oder PNG-Foto.",
    it: "Questa immagine non può essere letta. Provate una foto JPEG o PNG.",
  },
  "Ce navigateur ne peut pas réduire la photo.": {
    de: "Dieser Browser kann das Foto nicht verkleinern.",
    it: "Questo browser non può ridurre la foto.",
  },
} satisfies Dict);
