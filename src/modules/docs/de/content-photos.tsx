import { Camera } from "lucide-react";
import type { Topic } from "../content";
import { Faq, H, K, Note, Steps, Table, Ui } from "../kit";

// « Fotos » (German): attach photos to an entry, a message or a map object.
export const PHOTOS_TOPIC: Topic = {
  id: "photos",
  group: "reference",
  title: "Fotos",
  icon: Camera,
  hue: 200,
  short: (
    <p>
      Fügen Sie einem Journaleintrag, einer Meldung oder einem Kartenobjekt
      Fotos hinzu. Sie werden auf dem Arbeitsplatz verkleinert und verschlüsselt
      und dann mit den anderen Arbeitsplätzen der Sitzung geteilt.
    </p>
  ),
  guide: (
    <>
      <H>Ein Foto hinzufügen</H>
      <Steps>
        <li>
          Öffnen Sie den Eintrag, die Meldung oder das Kartenobjekt. Sie können
          auch einen neuen Eintrag oder eine neue Meldung beginnen.
        </li>
        <li>
          Tippen Sie auf <Ui>Foto</Ui>. Auf dem Telefon öffnet sich die Kamera;{" "}
          <Ui>Galerie</Ui> wählt ein bereits aufgenommenes Foto.
        </li>
        <li>
          Das Foto erscheint klein. In einem bestehenden Eintrag oder einer
          bestehenden Meldung wird es sofort gespeichert. In einem neuen Eintrag
          oder einer neuen Meldung wird es mitgespeichert, wenn Sie auf{" "}
          <Ui>Erfassen</Ui> oder <Ui>Meldung speichern</Ui> tippen.
        </li>
      </Steps>
      <Note kind="info">
        Am Computer wählt <Ui>Foto</Ui> eine Datei. Sie können ein Bild auch auf
        den Bereich « Fotos » ziehen oder mit <K>Ctrl</K> + <K>V</K> (<K>⌘</K> +{" "}
        <K>V</K> auf dem Mac) einfügen.
      </Note>
      <H>Ansehen, beschriften, löschen</H>
      <Steps>
        <li>Tippen Sie auf ein kleines Foto: Es öffnet sich gross.</li>
        <li>
          Die Pfeile oder ein Wischen mit dem Finger zeigen das nächste Foto.
        </li>
        <li>
          <Ui>Legende (freiwillig)</Ui>: ein paar Worte, gespeichert, wenn Sie
          das Feld verlassen.
        </li>
        <li>
          Um ein Foto zu entfernen: <Ui>Löschen</Ui>, dann zur Bestätigung{" "}
          <Ui>Foto löschen</Ui>.
        </li>
      </Steps>
      <Note kind="warn">
        Ein gelöschtes Foto verschwindet auf allen Arbeitsplätzen. Der Verlauf
        behält, wer es hinzugefügt und wer es gelöscht hat, aber nicht mehr das
        Bild.
      </Note>
      <H>Auf der Karte platzieren</H>
      <p>
        Hat die Kamera den Aufnahmeort gespeichert, schlägt orion aic gleich
        nach dem Hinzufügen <Ui>Auf der Karte platzieren</Ui> vor. Ein Tippen
        erstellt einen Punkt, der mit dem Eintrag oder der Meldung verknüpft
        ist. Ohne Ihre Zustimmung wird nichts platziert.
      </p>
    </>
  ),
  full: (
    <>
      <H>Was mit dem Foto geschieht</H>
      <ul>
        <li>
          Es wird auf dem Arbeitsplatz verkleinert: höchstens 1600 Pixel auf der
          langen Seite, einige hundert KB.
        </li>
        <li>
          Die versteckten Angaben des Originalfotos (Gerät, Uhrzeit, Standort)
          werden nicht aufbewahrt: nur das Bild.
        </li>
        <li>
          Es wird mit der Sitzung auf dem Arbeitsplatz verschlüsselt,
          verschlüsselt an die anderen Arbeitsplätze gesendet und ist im Archiv{" "}
          <code>.orionaic</code> enthalten.
        </li>
        <li>
          Das A4-Blatt eines Eintrags und das Meldeformular drucken seine Fotos
          (vier pro Seite). Das Exportdossier listet die Fotos und ihre Legenden
          auf.
        </li>
        <li>
          Wer einen Eintrag, eine Meldung oder ein Kartenobjekt löscht, löscht
          auch dessen Fotos.
        </li>
      </ul>
      <H>Grenzen</H>
      <Table
        head={["Was", "Höchstens"]}
        rows={[
          ["Fotos eines Eintrags, einer Meldung oder eines Objekts", "12"],
          ["Ein Foto, verkleinert", "etwa 440 KB"],
          ["Alle Fotos der Sitzung", "40 MB (etwa 120 Fotos)"],
          ["Ausgangsdatei", "40 MB"],
        ]}
      />
      <p>
        Darüber erklärt es eine Meldung. Entfernen Sie unnötige Fotos, um
        weitere hinzuzufügen.
      </p>
      <Faq q="Geht das Foto ins Internet?">
        Nur zu den anderen Arbeitsplätzen der Sitzung, verschlüsselt wie alles
        andere. Der Relais-Server kann es nicht sehen und speichert nichts.
      </Faq>
      <Faq q="Zwei Personen fügen gleichzeitig ein Foto hinzu?">
        Beide Fotos bleiben erhalten. Ein Foto ersetzt nie ein anderes.
      </Faq>
      <Faq q="Und die Zeitreise?">
        Sie zeigt die Fotos, die zu diesem Zeitpunkt vorhanden waren. Ein
        seither gelöschtes Foto erscheint als « Foto gelöscht ».
      </Faq>
      <Faq q="Kann ich ein PDF oder ein anderes Dokument anhängen?">
        Noch nicht: Notieren Sie seine Referenz im Eintrag.
      </Faq>
    </>
  ),
};
