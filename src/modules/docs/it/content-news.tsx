import { Sparkles } from "lucide-react";
import type { Topic } from "../content";
import { H, Note, Path, Ui } from "../kit";

// « Novità » (Italian): what changed in version 2.1.
export const NEWS_TOPIC: Topic = {
  id: "news",
  group: "start",
  title: "Novità (versione 2.1)",
  icon: Sparkles,
  hue: 30,
  short: (
    <p>
      Uno schermo più semplice, le foto, l’elenco delle postazioni collegate, la
      rimozione di una postazione persa e le allerte ufficiali di piena e di
      incendio boschivo. Non è stato tolto nulla: tutto ciò che c’era è ancora
      lì.
    </p>
  ),
  guide: (
    <>
      <H>Uno schermo più semplice</H>
      <ul>
        <li>
          Ogni pulsante della barra di sinistra porta il suo nome. Gli strumenti
          meno usati sono sotto <Ui>Altri strumenti</Ui>, a un tocco.
        </li>
        <li>
          In alto, <Ui>Non condivisa</Ui> e <Ui>Non salvato</Ui> indicano
          chiaramente lo stato della sessione; un tocco apre l’impostazione
          giusta.
        </li>
        <li>
          La pagina Situazione mostra l’essenziale.{" "}
          <Ui>Mostrare tutto il cruscotto</Ui> riporta tutte le schede.
        </li>
        <li>
          Una scheda <Ui>Da dove cominciare?</Ui> guida i primi passi. Si
          ritrova nell’Aiuto, rubrica «Per iniziare».
        </li>
      </ul>
      <H>Foto</H>
      <p>
        Il pulsante <Ui>Foto</Ui> aggiunge una foto a una voce del diario, a un
        messaggio o a un oggetto della carta. Sul telefono apre la fotocamera.
        Vedi la rubrica Foto.
      </p>
      <H>Chi è collegato? Tablet perso?</H>
      <p>
        <Path steps={["Impostazioni", "Sincronizzazione"]} /> →{" "}
        <Ui>Postazioni collegate</Ui>: ogni postazione, in linea o no,
        aggiornata o in ritardo. <Ui>Rimuovi questa postazione</Ui> cambia il
        codice di sessione: le altre postazioni seguono da sole, quella rimossa
        non riceve più nulla di nuovo.
      </p>
      <H>Allerte ufficiali</H>
      <p>
        Il modulo Meteo mostra, per il luogo dell’evento, i gradi di pericolo di
        piena e di incendio boschivo pubblicati dalla Confederazione e dai
        Cantoni, e la portata dei corsi d’acqua vicini. Una soglia di portata
        può attivare un’allerta.
      </p>
      <Note kind="info">
        Dopo un aggiornamento, ricaricate la pagina su tutte le postazioni della
        sessione: postazioni con versioni diverse possono rifiutare i dati le
        une delle altre.
      </Note>
    </>
  ),
};
