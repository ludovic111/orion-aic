import { translator, type Dict } from "./core.ts";

// Texts of shared/photos.ts and shared/photo-schema.ts (limits and
// validation messages shown to the operators).
export const { t, tn, tIn, dict } = translator({
  "Photo invalide.": { de: "Ungültiges Foto.", it: "Foto non valida." },
  "Déjà {n} photos ici : c’est le maximum.": {
    de: "Hier sind schon {n} Fotos: Das ist das Maximum.",
    it: "Qui ci sono già {n} foto: è il massimo.",
  },
  "{n} photos au plus par élément.": {
    de: "Höchstens {n} Fotos pro Element.",
    it: "Al massimo {n} foto per elemento.",
  },
  "Cette photo est trop lourde. Essayez-en une autre.": {
    de: "Dieses Foto ist zu gross. Versuchen Sie ein anderes.",
    it: "Questa foto è troppo pesante. Provatene un’altra.",
  },
  "Plus de place pour les photos : {max} Mo au plus par session. Retirez des photos inutiles pour en ajouter d’autres.":
    {
      de: "Kein Platz mehr für Fotos: höchstens {max} MB pro Sitzung. Entfernen Sie unnötige Fotos, um weitere hinzuzufügen.",
      it: "Non c’è più spazio per le foto: al massimo {max} MB per sessione. Rimuovete le foto inutili per aggiungerne altre.",
    },
} satisfies Dict);
