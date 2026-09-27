import { Sparkles } from "lucide-react";
import type { Topic } from "../content";
import { H, Note, Path, Ui } from "../kit";

// « Was ist neu » (German): what changed in version 2.1.
export const NEWS_TOPIC: Topic = {
  id: "news",
  group: "start",
  title: "Was ist neu (Version 2.1)",
  icon: Sparkles,
  hue: 30,
  short: (
    <p>
      Ein einfacherer Bildschirm, Fotos, die Liste der verbundenen
      Arbeitsplätze, das Entfernen eines verlorenen Arbeitsplatzes und die
      offiziellen Hochwasser- und Waldbrandwarnungen. Nichts wurde entfernt:
      Alles, was es gab, ist noch da.
    </p>
  ),
  guide: (
    <>
      <H>Ein einfacherer Bildschirm</H>
      <ul>
        <li>
          Jede Schaltfläche der linken Leiste trägt ihren Namen. Seltener
          gebrauchte Werkzeuge liegen unter <Ui>Weitere Werkzeuge</Ui>, einen
          Tipp entfernt.
        </li>
        <li>
          Oben zeigen <Ui>Nicht geteilt</Ui> und <Ui>Nicht gespeichert</Ui>{" "}
          deutlich den Zustand der Sitzung; ein Tipp öffnet die passende
          Einstellung.
        </li>
        <li>
          Die Seite Lage zeigt das Wesentliche.{" "}
          <Ui>Ganzes Dashboard anzeigen</Ui> bringt alle Karten zurück.
        </li>
        <li>
          Eine Karte <Ui>Wo anfangen?</Ui> führt durch die ersten Schritte. Sie
          ist in der Hilfe unter «Erste Schritte» wieder zu finden.
        </li>
      </ul>
      <H>Fotos</H>
      <p>
        Die Schaltfläche <Ui>Foto</Ui> fügt einem Journaleintrag, einer Meldung
        oder einem Kartenobjekt ein Foto hinzu. Auf dem Telefon öffnet sie die
        Kamera. Siehe Thema Fotos.
      </p>
      <H>Wer ist verbunden? Tablet verloren?</H>
      <p>
        <Path steps={["Einstellungen", "Synchronisation"]} /> →{" "}
        <Ui>Verbundene Arbeitsplätze</Ui>: jeder Arbeitsplatz, online oder
        nicht, aktuell oder im Rückstand. <Ui>Diesen Arbeitsplatz entfernen</Ui>{" "}
        ändert den Sitzungscode: Die anderen Arbeitsplätze folgen von selbst,
        der entfernte erhält nichts Neues mehr.
      </p>
      <H>Offizielle Warnungen</H>
      <p>
        Das Modul Wetter zeigt für den Ort des Ereignisses die von Bund und
        Kantonen veröffentlichten Gefahrenstufen für Hochwasser und Waldbrand
        sowie den Abfluss nahe gelegener Gewässer. Ein Abfluss-Schwellenwert
        kann einen Alarm auslösen.
      </p>
      <Note kind="info">
        Laden Sie nach einer Aktualisierung die Seite auf allen Arbeitsplätzen
        der Sitzung neu: Arbeitsplätze mit verschiedenen Versionen können die
        Daten der anderen ablehnen.
      </Note>
    </>
  ),
};
