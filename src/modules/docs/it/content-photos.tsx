import { Camera } from "lucide-react";
import type { Topic } from "../content";
import { Faq, H, K, Note, Steps, Table, Ui } from "../kit";

// «Foto» (Italian): attach photos to an entry, a message or a map object.
export const PHOTOS_TOPIC: Topic = {
  id: "photos",
  group: "reference",
  title: "Foto",
  icon: Camera,
  hue: 200,
  short: (
    <p>
      Aggiungete foto a una voce del diario, a un messaggio o a un oggetto della
      carta. Vengono ridotte e cifrate sulla postazione, poi condivise con le
      altre postazioni della sessione.
    </p>
  ),
  guide: (
    <>
      <H>Aggiungere una foto</H>
      <Steps>
        <li>
          Aprite la voce, il messaggio o l’oggetto della carta. Potete anche
          iniziare una nuova voce o un nuovo messaggio.
        </li>
        <li>
          Toccate <Ui>Foto</Ui>. Sul telefono si apre la fotocamera;{" "}
          <Ui>Galleria</Ui> sceglie una foto già scattata.
        </li>
        <li>
          La foto appare in piccolo. In una voce o in un messaggio esistente
          viene salvata subito. In una nuova voce o in un nuovo messaggio parte
          con esso quando toccate <Ui>Registra</Ui> o{" "}
          <Ui>Salva il messaggio</Ui>.
        </li>
      </Steps>
      <Note kind="info">
        Sul computer, <Ui>Foto</Ui> sceglie un file. Potete anche trascinare
        un’immagine sulla zona «Foto», o incollarla con <K>Ctrl</K> + <K>V</K> (
        <K>⌘</K> + <K>V</K> su Mac).
      </Note>
      <H>Vedere, aggiungere una didascalia, eliminare</H>
      <Steps>
        <li>Toccate una foto piccola: si apre in grande.</li>
        <li>
          Le frecce, o uno scorrimento del dito, passano alla foto successiva.
        </li>
        <li>
          <Ui>Didascalia (facoltativa)</Ui>: qualche parola, salvata quando
          lasciate il campo.
        </li>
        <li>
          Per togliere una foto: <Ui>Elimina</Ui>, poi{" "}
          <Ui>Eliminare la foto</Ui> per confermare.
        </li>
      </Steps>
      <Note kind="warn">
        Una foto eliminata scompare da tutte le postazioni. La cronologia
        conserva chi l’ha aggiunta e chi l’ha eliminata, ma non più l’immagine.
      </Note>
      <H>Posizionare sulla carta</H>
      <p>
        Se la fotocamera ha registrato il luogo dello scatto, orion aic propone{" "}
        <Ui>Posiziona sulla carta</Ui> subito dopo l’aggiunta. Un tocco crea un
        punto collegato alla voce o al messaggio. Nulla viene posizionato senza
        il vostro accordo.
      </p>
    </>
  ),
  full: (
    <>
      <H>Che cosa succede alla foto</H>
      <ul>
        <li>
          Viene ridotta sulla postazione: al massimo 1600 pixel sul lato lungo,
          qualche centinaio di KB.
        </li>
        <li>
          Le informazioni nascoste della foto originale (apparecchio, ora,
          posizione) non vengono conservate: solo l’immagine.
        </li>
        <li>
          Viene cifrata con la sessione sulla postazione, inviata cifrata alle
          altre postazioni e compresa nell’archivio <code>.orionaic</code>.
        </li>
        <li>
          La scheda A4 di una voce e il modulo di messaggio stampano le sue foto
          (quattro per pagina). Il dossier d’esportazione elenca le foto e le
          loro didascalie.
        </li>
        <li>
          Eliminare una voce, un messaggio o un oggetto della carta elimina
          anche le sue foto.
        </li>
      </ul>
      <H>Limiti</H>
      <Table
        head={["Cosa", "Al massimo"]}
        rows={[
          ["Foto di una voce, di un messaggio o di un oggetto", "12"],
          ["Una foto, una volta ridotta", "circa 440 KB"],
          ["Tutte le foto della sessione", "40 MB (circa 120 foto)"],
          ["File di partenza", "40 MB"],
        ]}
      />
      <p>
        Oltre, un messaggio lo spiega. Rimuovete le foto inutili per aggiungerne
        altre.
      </p>
      <Faq q="La foto va su internet?">
        Solo verso le altre postazioni della sessione, cifrata come tutto il
        resto. Il server di inoltro non può vederla e non conserva nulla.
      </Faq>
      <Faq q="Due persone aggiungono una foto nello stesso momento?">
        Entrambe le foto vengono conservate. Una foto non ne sostituisce mai
        un’altra.
      </Faq>
      <Faq q="E la macchina del tempo?">
        Mostra le foto presenti in quel momento. Una foto eliminata in seguito
        appare come «Foto eliminata».
      </Faq>
      <Faq q="Posso allegare un PDF o un altro documento?">
        Non ancora: annotatene il riferimento nella voce.
      </Faq>
    </>
  ),
};
