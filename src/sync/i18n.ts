import { translator, type Dict } from "../../shared/i18n/core.ts";
import { common } from "../../shared/i18n/common.ts";

// Live synchronisation between posts (useSync.ts) and the merge report
// (ConflictPanel.tsx).
export const { t, tn, tIn, dict } = translator({
  ...common,
  // useSync.ts: errors shown to the operator
  "Un poste utilise une version plus récente d’orion aic — rechargez la page.":
    {
      de: "Ein Arbeitsplatz verwendet eine neuere Version von orion aic – laden Sie die Seite neu.",
      it: "Una postazione usa una versione più recente di orion aic — ricaricare la pagina.",
    },
  "Cette page utilise une version plus ancienne d’orion aic — rechargez la page.":
    {
      de: "Diese Seite verwendet eine ältere Version von orion aic – laden Sie die Seite neu.",
      it: "Questa pagina usa una versione meno recente di orion aic — ricaricare la pagina.",
    },
  "Chiffrement indisponible : ouvrez orion aic en HTTPS.": {
    de: "Verschlüsselung nicht verfügbar: Öffnen Sie orion aic über HTTPS.",
    it: "Cifratura non disponibile: aprire orion aic in HTTPS.",
  },
  "Relais saturé : nouvelle tentative de connexion dans quelques secondes.": {
    de: "Relais überlastet: neuer Verbindungsversuch in wenigen Sekunden.",
    it: "Relè saturo: nuovo tentativo di connessione tra pochi secondi.",
  },
  "Session complète : 64 postes au plus sur le relais.": {
    de: "Sitzung voll: höchstens 64 Arbeitsplätze auf dem Relais.",
    it: "Sessione completa: al massimo 64 postazioni sul relè.",
  },
  "Message illisible reçu : un autre poste utilise-t-il un autre code ?": {
    de: "Unlesbare Meldung empfangen: Verwendet ein anderer Arbeitsplatz einen anderen Code?",
    it: "Ricevuto un messaggio illeggibile: un’altra postazione usa un altro codice?",
  },
  // useSync.ts: data refused (sender and what was refused)
  "Poste inconnu": {
    de: "Unbekannter Arbeitsplatz",
    it: "Postazione sconosciuta",
  },
  journal: { de: "Journal", it: "diario" },
  session: { de: "Sitzung", it: "sessione" },
  message: { de: "Meldung", it: "messaggio" },
  // ConflictPanel.tsx
  "Voir les deux versions": {
    de: "Beide Versionen anzeigen",
    it: "Vedi le due versioni",
  },
  "Identique à la version affichée.": {
    de: "Identisch mit der angezeigten Version.",
    it: "Identica alla versione visualizzata.",
  },
  "Non retenue": { de: "Nicht übernommen", it: "Non mantenuta" },
  "Les deux versions restent dans l’historique (fiche de l’élément → Historique) et peuvent être restaurées.":
    {
      de: "Beide Versionen bleiben im Verlauf (Detailansicht des Elements → Verlauf) und können wiederhergestellt werden.",
      it: "Le due versioni restano nella cronologia (scheda dell’elemento → Cronologia) e possono essere ripristinate.",
    },
  "Aucune fusion à signaler : les postes n’ont rien écrit en même temps sur les mêmes éléments.":
    {
      de: "Keine Zusammenführung zu melden: Die Arbeitsplätze haben nichts gleichzeitig an denselben Elementen geschrieben.",
      it: "Nessuna fusione da segnalare: le postazioni non hanno scritto nulla contemporaneamente sugli stessi elementi.",
    },
  "Données refusées ({n})": {
    de: "Abgelehnte Daten ({n})",
    it: "Dati rifiutati ({n})",
  },
  "Ces journaux reçus d’un autre poste n’ont pas été fusionnés. Le plus souvent, ce poste utilise une autre version d’orion aic : rechargez la page sur les deux postes.":
    {
      de: "Diese von einem anderen Arbeitsplatz empfangenen Journale wurden nicht zusammengeführt. Meistens verwendet dieser Arbeitsplatz eine andere Version von orion aic: Laden Sie die Seite auf beiden Arbeitsplätzen neu.",
      it: "Questi diari ricevuti da un’altra postazione non sono stati fusi. Di solito quella postazione usa un’altra versione di orion aic: ricaricare la pagina su entrambe le postazioni.",
    },
  "{journal} · de {from}": {
    de: "{journal} · von {from}",
    it: "{journal} · da {from}",
  },
  "Effacer la liste": { de: "Liste leeren", it: "Svuota l’elenco" },
  "Numéros donnés en même temps ({n})": {
    de: "Gleichzeitig vergebene Nummern ({n})",
    it: "Numeri assegnati contemporaneamente ({n})",
  },
  "Deux postes ont donné le même numéro au même moment. Aucun numéro n’a été changé : le premier créé garde le numéro seul, les autres reçoivent une lettre (#007·B). Citez le libellé complet.":
    {
      de: "Zwei Arbeitsplätze haben im selben Moment dieselbe Nummer vergeben. Keine Nummer wurde geändert: Das zuerst erstellte Element behält die Nummer allein, die anderen erhalten einen Buchstaben (#007·B). Nennen Sie die vollständige Bezeichnung.",
      it: "Due postazioni hanno assegnato lo stesso numero nello stesso momento. Nessun numero è stato cambiato: il primo creato mantiene il numero da solo, gli altri ricevono una lettera (#007·B). Citare la designazione completa.",
    },
  "{label} : {by}, {at}": {
    de: "{label}: {by}, {at}",
    it: "{label}: {by}, {at}",
  },
  "{label} : {by}, {at} (supprimée)": {
    de: "{label}: {by}, {at} (gelöscht)",
    it: "{label}: {by}, {at} (eliminata)",
  },
  "Modifications simultanées ({n})": {
    de: "Gleichzeitige Änderungen ({n})",
    it: "Modifiche simultanee ({n})",
  },
  "Deux postes ont modifié le même élément à partir de la même version. La plus récente est affichée partout ; l’autre reste consultable.":
    {
      de: "Zwei Arbeitsplätze haben dasselbe Element ausgehend von derselben Version geändert. Die neuere wird überall angezeigt; die andere bleibt einsehbar.",
      it: "Due postazioni hanno modificato lo stesso elemento partendo dalla stessa versione. La più recente è visualizzata ovunque; l’altra resta consultabile.",
    },
  "Retenue : {kept} · non retenue : {others}": {
    de: "Übernommen: {kept} · nicht übernommen: {others}",
    it: "Mantenuta: {kept} · non mantenuta: {others}",
  },
  "Marquer comme vu": { de: "Als gesehen markieren", it: "Segna come visto" },
  // useSync.ts: changing the session code
  "Pas de connexion : réessayez dans un instant.": {
    de: "Keine Verbindung: Versuchen Sie es gleich noch einmal.",
    it: "Nessuna connessione: riprovare tra un istante.",
  },
  "Le code de session vient de changer.": {
    de: "Der Sitzungscode hat sich gerade geändert.",
    it: "Il codice di sessione è appena cambiato.",
  },
  // PostsPanel.tsx: « Postes connectés »
  "Postes connectés": {
    de: "Verbundene Arbeitsplätze",
    it: "Postazioni collegate",
  },
  "{n} en ligne": { de: "{n} online", it: "{n} online" },
  "(ce poste)": { de: "(dieser Arbeitsplatz)", it: "(questa postazione)" },
  "« {name} »": { de: "«{name}»", it: "«{name}»" },
  "Poste sans nom": {
    de: "Arbeitsplatz ohne Namen",
    it: "Postazione senza nome",
  },
  "Fonction non choisie": {
    de: "Funktion nicht gewählt",
    it: "Funzione non scelta",
  },
  "En ligne": { de: "Online", it: "Online" },
  "Pas connecté": { de: "Nicht verbunden", it: "Non connessa" },
  "Hors ligne": { de: "Offline", it: "Offline" },
  "A quitté": { de: "Hat verlassen", it: "Ha lasciato" },
  Retiré: { de: "Entfernt", it: "Rimossa" },
  "À jour": { de: "Aktuell", it: "Aggiornata" },
  "Mise à jour…": { de: "Wird aktualisiert …", it: "Aggiornamento…" },
  "En retard": { de: "Im Rückstand", it: "In ritardo" },
  "Pas à jour ici": { de: "Hier nicht aktuell", it: "Qui non aggiornata" },
  "Passe au nouveau code…": {
    de: "Wechselt zum neuen Code …",
    it: "Passa al nuovo codice…",
  },
  "N’a pas le nouveau code": {
    de: "Hat den neuen Code nicht",
    it: "Non ha il nuovo codice",
  },
  "Connecté depuis {time}": {
    de: "Verbunden seit {time}",
    it: "Connessa dalle {time}",
  },
  "Vu pour la dernière fois à {time}": {
    de: "Zuletzt gesehen um {time}",
    it: "Vista l’ultima volta alle {time}",
  },
  "Il lui manque des changements depuis plus de 2 minutes. Vérifiez sa connexion (Wi-Fi, réseau).":
    {
      de: "Ihm fehlen seit über 2 Minuten Änderungen. Prüfen Sie seine Verbindung (WLAN, Netz).",
      it: "Le mancano modifiche da più di 2 minuti. Verificare la sua connessione (Wi-Fi, rete).",
    },
  "Ses derniers changements n’arrivent pas sur ce poste depuis plus de 2 minutes. Vérifiez la connexion des deux postes.":
    {
      de: "Seine letzten Änderungen kommen seit über 2 Minuten nicht auf diesem Arbeitsplatz an. Prüfen Sie die Verbindung beider Arbeitsplätze.",
      it: "Le sue ultime modifiche non arrivano su questa postazione da più di 2 minuti. Verificare la connessione delle due postazioni.",
    },
  "Ancienne version d’orion aic : si le code change, il faudra le saisir à la main sur ce poste.":
    {
      de: "Ältere Version von orion aic: Ändert sich der Code, muss er auf diesem Arbeitsplatz von Hand eingegeben werden.",
      it: "Versione meno recente di orion aic: se il codice cambia, bisognerà inserirlo a mano su questa postazione.",
    },
  "Un autre poste porte le même nom : vérifiez de quel appareil il s’agit avant de retirer.":
    {
      de: "Ein anderer Arbeitsplatz trägt denselben Namen: Prüfen Sie vor dem Entfernen, um welches Gerät es sich handelt.",
      it: "Un’altra postazione ha lo stesso nome: verificare di quale apparecchio si tratta prima di rimuoverla.",
    },
  "Retirer ce poste": {
    de: "Diesen Arbeitsplatz entfernen",
    it: "Rimuovi questa postazione",
  },
  "Aucun autre poste pour l’instant. Donnez le code aux autres postes : ils apparaîtront ici.":
    {
      de: "Noch kein anderer Arbeitsplatz. Geben Sie den anderen Arbeitsplätzen den Code: Sie erscheinen dann hier.",
      it: "Per ora nessun’altra postazione. Dare il codice alle altre postazioni: appariranno qui.",
    },
  "{n} connexion ne s’est pas présentée (ancienne version d’orion aic, ou appareil inconnu). Si personne ne l’attend, changez le code.":
    {
      de: "{n} Verbindung hat sich nicht vorgestellt (ältere Version von orion aic oder unbekanntes Gerät). Wenn niemand sie erwartet, ändern Sie den Code.",
      it: "{n} connessione non si è presentata (versione meno recente di orion aic o apparecchio sconosciuto). Se nessuno la attende, cambiare il codice.",
    },
  "{n} connexions ne se sont pas présentées (ancienne version d’orion aic, ou appareils inconnus). Si personne ne les attend, changez le code.":
    {
      de: "{n} Verbindungen haben sich nicht vorgestellt (ältere Version von orion aic oder unbekannte Geräte). Wenn niemand sie erwartet, ändern Sie den Code.",
      it: "{n} connessioni non si sono presentate (versione meno recente di orion aic o apparecchi sconosciuti). Se nessuno le attende, cambiare il codice.",
    },
  "Tablette perdue ? Poste parti ?": {
    de: "Tablet verloren? Arbeitsplatz gegangen?",
    it: "Tablet persa? Postazione partita?",
  },
  "Changez le code de session : les postes connectés passent au nouveau code tout seuls. Le poste retiré garde ce qu’il a déjà, mais ne reçoit plus rien.":
    {
      de: "Ändern Sie den Sitzungscode: Die verbundenen Arbeitsplätze wechseln von selbst zum neuen Code. Der entfernte Arbeitsplatz behält, was er schon hat, erhält aber nichts mehr.",
      it: "Cambiare il codice di sessione: le postazioni collegate passano da sole al nuovo codice. La postazione rimossa conserva ciò che ha già, ma non riceve più nulla.",
    },
  "Changer le code de session": {
    de: "Sitzungscode ändern",
    it: "Cambia il codice di sessione",
  },
  "Pas de connexion pour l’instant : attendez « Connecté » pour changer le code.":
    {
      de: "Im Moment keine Verbindung: Warten Sie auf «Verbunden», um den Code zu ändern.",
      it: "Per ora nessuna connessione: attendere «Connesso» per cambiare il codice.",
    },
  // PostsPanel.tsx: confirmation
  "Retirer « {name} » ?": {
    de: "«{name}» entfernen?",
    it: "Rimuovere «{name}»?",
  },
  "Changer le code de session ?": {
    de: "Sitzungscode ändern?",
    it: "Cambiare il codice di sessione?",
  },
  "« {name} » garde ce qu’il a déjà reçu, mais ne recevra plus rien de nouveau et ne pourra plus rien envoyer aux autres.":
    {
      de: "«{name}» behält, was er schon erhalten hat, erhält aber nichts Neues mehr und kann den anderen nichts mehr senden.",
      it: "«{name}» conserva ciò che ha già ricevuto, ma non riceverà più nulla di nuovo e non potrà più inviare nulla agli altri.",
    },
  "Un nouveau code est créé. Les postes en ligne le reçoivent tout seuls et continuent sans rien faire.":
    {
      de: "Ein neuer Code wird erstellt. Die Arbeitsplätze, die online sind, erhalten ihn von selbst und arbeiten weiter, ohne etwas zu tun.",
      it: "Viene creato un nuovo codice. Le postazioni online lo ricevono da sole e continuano senza fare nulla.",
    },
  "Hors ligne en ce moment : {names}. Ils devront saisir le nouveau code à la main (il s’affichera ici, avec le QR code).":
    {
      de: "Im Moment offline: {names}. Sie müssen den neuen Code von Hand eingeben (er wird hier angezeigt, mit dem QR-Code).",
      it: "Offline in questo momento: {names}. Dovranno inserire il nuovo codice a mano (sarà visualizzato qui, con il codice QR).",
    },
  "Hors ligne en ce moment : {names}. Il devra saisir le nouveau code à la main (il s’affichera ici, avec le QR code).":
    {
      de: "Im Moment offline: {names}. Er muss den neuen Code von Hand eingeben (er wird hier angezeigt, mit dem QR-Code).",
      it: "Offline in questo momento: {names}. Dovrà inserire il nuovo codice a mano (sarà visualizzato qui, con il codice QR).",
    },
  "Ancienne version : {names}. Il devra aussi saisir le nouveau code à la main.":
    {
      de: "Ältere Version: {names}. Auch er muss den neuen Code von Hand eingeben.",
      it: "Versione meno recente: {names}. Anche lei dovrà inserire il nuovo codice a mano.",
    },
  "Ancienne version : {names}. Ils devront aussi saisir le nouveau code à la main.":
    {
      de: "Ältere Version: {names}. Auch sie müssen den neuen Code von Hand eingeben.",
      it: "Versione meno recente: {names}. Anche loro dovranno inserire il nuovo codice a mano.",
    },
  "{n} connexion sans nom ne recevra pas le nouveau code.": {
    de: "{n} Verbindung ohne Namen erhält den neuen Code nicht.",
    it: "{n} connessione senza nome non riceverà il nuovo codice.",
  },
  "{n} connexions sans nom ne recevront pas le nouveau code.": {
    de: "{n} Verbindungen ohne Namen erhalten den neuen Code nicht.",
    it: "{n} connessioni senza nome non riceveranno il nuovo codice.",
  },
  "Le changement est noté au journal. Le code, lui, n’est jamais écrit au journal.":
    {
      de: "Die Änderung wird im Journal vermerkt. Der Code selbst wird nie ins Journal geschrieben.",
      it: "Il cambiamento è annotato nel diario. Il codice, invece, non viene mai scritto nel diario.",
    },
  "Changement en cours…": {
    de: "Änderung läuft …",
    it: "Cambiamento in corso…",
  },
  "Retirer et changer le code": {
    de: "Entfernen und Code ändern",
    it: "Rimuovi e cambia il codice",
  },
  "Changer le code": { de: "Code ändern", it: "Cambia il codice" },
  "« {name} » est retiré. Nouveau code en place.": {
    de: "«{name}» ist entfernt. Neuer Code aktiv.",
    it: "«{name}» è stata rimossa. Nuovo codice attivo.",
  },
  // PostsPanel.tsx: what happened at a change of code
  "Nouveau code de session en place.": {
    de: "Neuer Sitzungscode aktiv.",
    it: "Nuovo codice di sessione attivo.",
  },
  "Nouveau code de session en place": {
    de: "Neuer Sitzungscode aktiv",
    it: "Nuovo codice di sessione attivo",
  },
  "Le code de session a changé": {
    de: "Der Sitzungscode hat sich geändert",
    it: "Il codice di sessione è cambiato",
  },
  "Ce poste a été retiré de la session": {
    de: "Dieser Arbeitsplatz wurde aus der Sitzung entfernt",
    it: "Questa postazione è stata rimossa dalla sessione",
  },
  "Ce poste a été retiré de la session par {by}.": {
    de: "Dieser Arbeitsplatz wurde von {by} aus der Sitzung entfernt.",
    it: "Questa postazione è stata rimossa dalla sessione da {by}.",
  },
  "un autre poste": {
    de: "einem anderen Arbeitsplatz",
    it: "un’altra postazione",
  },
  "Un autre poste": {
    de: "Ein anderer Arbeitsplatz",
    it: "Un’altra postazione",
  },
  "Le code de session a changé, mais ce poste ne l’a pas reçu : demandez le nouveau code.":
    {
      de: "Der Sitzungscode hat sich geändert, aber dieser Arbeitsplatz hat ihn nicht erhalten: Fragen Sie nach dem neuen Code.",
      it: "Il codice di sessione è cambiato, ma questa postazione non l’ha ricevuto: chiedere il nuovo codice.",
    },
  "{by} a changé le code de session : ce poste a suivi tout seul.": {
    de: "{by} hat den Sitzungscode geändert: Dieser Arbeitsplatz ist von selbst gefolgt.",
    it: "{by} ha cambiato il codice di sessione: questa postazione ha seguito da sola.",
  },
  "{by} a changé le code sans ce poste. Ce poste garde tout ce qu’il avait déjà, mais ne reçoit plus rien et n’envoie plus rien. Pour revenir, demandez le nouveau code et saisissez-le ci-dessous.":
    {
      de: "{by} hat den Code ohne diesen Arbeitsplatz geändert. Dieser Arbeitsplatz behält alles, was er schon hatte, erhält und sendet aber nichts mehr. Um zurückzukehren, fragen Sie nach dem neuen Code und geben Sie ihn unten ein.",
      it: "{by} ha cambiato il codice senza questa postazione. Questa postazione conserva tutto ciò che aveva già, ma non riceve né invia più nulla. Per tornare, chiedere il nuovo codice e inserirlo qui sotto.",
    },
  "{by} a changé le code, mais ce poste ne l’a pas reçu (il venait d’arriver, ou il utilise une ancienne version). La synchronisation est arrêtée ici. Demandez le nouveau code et saisissez-le ci-dessous.":
    {
      de: "{by} hat den Code geändert, aber dieser Arbeitsplatz hat ihn nicht erhalten (er war gerade erst dazugekommen oder verwendet eine ältere Version). Die Synchronisation ist hier gestoppt. Fragen Sie nach dem neuen Code und geben Sie ihn unten ein.",
      it: "{by} ha cambiato il codice, ma questa postazione non l’ha ricevuto (era appena arrivata o usa una versione meno recente). La sincronizzazione è interrotta qui. Chiedere il nuovo codice e inserirlo qui sotto.",
    },
  "Les postes connectés sont passés au nouveau code tout seuls.": {
    de: "Die verbundenen Arbeitsplätze sind von selbst zum neuen Code gewechselt.",
    it: "Le postazioni collegate sono passate da sole al nuovo codice.",
  },
  "{by} a changé le code. Ce poste est passé au nouveau code tout seul : rien à faire.":
    {
      de: "{by} hat den Code geändert. Dieser Arbeitsplatz ist von selbst zum neuen Code gewechselt: nichts zu tun.",
      it: "{by} ha cambiato il codice. Questa postazione è passata da sola al nuovo codice: niente da fare.",
    },
  "Retiré : {names}. Il garde ce qu’il avait déjà, mais ne reçoit plus rien de nouveau.":
    {
      de: "Entfernt: {names}. Er behält, was er schon hatte, erhält aber nichts Neues mehr.",
      it: "Rimossa: {names}. Conserva ciò che aveva già, ma non riceve più nulla di nuovo.",
    },
  "Retirés : {names}. Ils gardent ce qu’ils avaient déjà, mais ne reçoivent plus rien de nouveau.":
    {
      de: "Entfernt: {names}. Sie behalten, was sie schon hatten, erhalten aber nichts Neues mehr.",
      it: "Rimosse: {names}. Conservano ciò che avevano già, ma non ricevono più nulla di nuovo.",
    },
  "À donner à la main (hors ligne au moment du changement) : {names}. Le nouveau code et son QR code sont affichés ci-dessus.":
    {
      de: "Von Hand weitergeben (bei der Änderung offline): {names}. Der neue Code und sein QR-Code sind oben angezeigt.",
      it: "Da consegnare a mano (offline al momento del cambiamento): {names}. Il nuovo codice e il suo codice QR sono visualizzati qui sopra.",
    },
  Compris: { de: "Verstanden", it: "Capito" },
  // Journal entry written by the post that changed the code
  "Code de session changé — poste {names} retiré. Il garde ce qu’il avait déjà, mais ne reçoit plus rien de nouveau.":
    {
      de: "Sitzungscode geändert — Arbeitsplatz {names} entfernt. Er behält, was er schon hatte, erhält aber nichts Neues mehr.",
      it: "Codice di sessione cambiato — postazione {names} rimossa. Conserva ciò che aveva già, ma non riceve più nulla di nuovo.",
    },
  "Code de session changé — postes {names} retirés. Ils gardent ce qu’ils avaient déjà, mais ne reçoivent plus rien de nouveau.":
    {
      de: "Sitzungscode geändert — Arbeitsplätze {names} entfernt. Sie behalten, was sie schon hatten, erhalten aber nichts Neues mehr.",
      it: "Codice di sessione cambiato — postazioni {names} rimosse. Conservano ciò che avevano già, ma non ricevono più nulla di nuovo.",
    },
  "Code de session changé.": {
    de: "Sitzungscode geändert.",
    it: "Codice di sessione cambiato.",
  },
} satisfies Dict);
