# Aus Bild entwerfen (Auftrag 05A)

Erster Abschnitt der Kette aus A18: **Bild → nachvollziehbare Interpretation → vom Nutzer bestätigter Entwurfsauftrag.** Es entstehen dabei keine Steine. Konstruktion, Bauanleitung und Stückliste folgen erst, wenn aus einem bestätigten Auftrag ein echtes kanonisches Modell mit geprüfter Baufolge konstruiert ist (Auftrag 05B).

## Ablauf in der Oberfläche

1. **Bildvorlagen:** PNG oder JPEG hochladen, höchstens 4 Bilder mit je höchstens 5 MB. Bilder lassen sich ersetzen oder entfernen, jedem Bild lässt sich eine Ansicht zuordnen (vorn, seitlich, hinten, oben, schräg).
   - Geprüft wird der **Dateiinhalt**: die PNG-/JPEG-Signatur (die Endung zählt nicht), die Maße aus dem Dateikopf (64–8000 px je Seite) und die tatsächliche Dekodierbarkeit im Browser.
   - Jedes Bild wird über seine **SHA-256-Prüfsumme** identifiziert. Gleicher Dateiname mit anderem Inhalt ergibt eine andere Kennung.
2. **Interpretation:** entweder automatisch über den lokalen Analysedienst oder manuell.
   - Vor dem Senden zeigt ein Dialog, welcher Dienst welche Bilder erhält: Prüfsummen, Ansichtsbezeichnung und Hinweise, keine Dateinamen. Gesendet wird erst nach ausdrücklicher Einwilligung.
   - Bild und Interpretation stehen nebeneinander. Die Bildbereiche der Baugruppen erscheinen als Rahmen im Bild: durchgezogen für beobachtet, gestrichelt für angenommen oder vorgegeben.
   - Darunter zeigt eine Vorschau die **eingefärbten 2D-Bildbereiche** (je Baugruppe ein Rechteck in ihrer ersten Farbe). Sie ist ausdrücklich keine räumliche Rekonstruktion: Sie enthält weder Tiefe noch eine räumlich stimmige Form, und Proportionen sind darin nicht geprüft.
3. **Korrigieren:** Baugruppen, Proportionen relativ zum Hauptkörper, Bildbereiche, Farben, Merkmale, Symmetrie, verdeckte Bereiche, Vereinfachungen und offene Fragen sind editierbar. Jede Korrektur wird protokolliert (Pfad, vorher, nachher) und setzt die Grundlage der betroffenen Aussage auf „vom Nutzer vorgegeben“.
4. **Anforderungen:** Teilezahlbereich, Höchstmaße in Noppen bzw. Steinhöhen, bevorzugte Größe, wichtigste wiederzuerkennende Merkmale (sortiert nach Priorität), Nutzung (Ausstellungsmodell, vorsichtige Handhabung, Spielmodell als Ziel) und Hinweise. Das sind **Anforderungen, keine Zusage der Machbarkeit**. Es wird keine Alters- oder Sicherheitsfreigabe abgeleitet.
5. **Bestätigen:** Eine Checkliste zeigt, was fehlt. Bestätigt werden kann erst, wenn alle Punkte erfüllt sind: Bild vorhanden, Interpretation passt zu den aktuellen Bildern, strukturell gültig und widerspruchsfrei, Teilezahlbereich, Merkmale und Maße angegeben.
6. **Speichern:** Bild und Entwurf werden automatisch lokal im Browser (IndexedDB) gespeichert und beim nächsten Öffnen wiederhergestellt. Export und Import als JSON enthalten keine Bilddaten; beim Import werden Bilder per Prüfsumme wieder zugeordnet.

## Drei Grundlagen jeder Aussage

| Grundlage | Bedeutung | Darstellung |
| --- | --- | --- |
| `observed` | im Bild beobachtet (braucht einen Bildbereich) | ◉ beobachtet, durchgezogener Rahmen |
| `assumed` | konstruktiv angenommen (z. B. verdeckte Rückseite, Symmetrie) | ◌ angenommen, gestrichelt |
| `user` | vom Nutzer vorgegeben oder korrigiert | ✎ Vorgabe, Doppelrahmen |

Ein einzelnes Bild belegt weder Rückseite noch Innenkonstruktion, reale Abmessungen, konkrete Teilenummern oder mechanische Stabilität. Die Prüfung (`checkInterpretation`) weist strukturelle Fehler und Widersprüche zurück, zum Beispiel:

- ein „beobachteter“ verdeckter Bereich,
- eine beobachtete Baugruppe ohne Bildbereich,
- mehr oder weniger als ein Hauptkörper,
- Bildbereiche außerhalb des Bildes,
- Flächenanteile über 100 %,
- unbekannte Verweise.

Nennt die Interpretation reale Maße oder Teilenummern, gibt es eine Warnung.

## Entwurfsauftrag (`src/core/design/brief.ts`, Schema `baustein-sim/design-brief@1`)

Der Entwurfsauftrag ist eigenständig und versioniert. Er enthält:

- Bildreferenzen mit Prüfsumme, Typ, Maßen, Ansicht und Anzeigename,
- die Analyseherkunft: Verfahren, Dienst, Modell, Verfahrens- und Prompt-Version, zugrunde liegende Bild-Prüfsummen, Status,
- die Interpretation mit Grundlage je Aussage,
- die Nutzerkorrekturen und Anforderungen,
- die offenen Fragen (Teil der Interpretation),
- den Bestätigungsstand mit bestätigtem Inhalts-Hash,
- einen Verlauf und einen Inhalts-Hash.

Jede Änderung erzeugt eine neue Version. Ein Bildwechsel (hinzufügen, ersetzen, entfernen) macht die Interpretation **veraltet** und eine Bestätigung **ungültig**, mit Begründung im Verlauf. Danach kann der Nutzer neu analysieren, manuell neu beginnen oder die bestehende Interpretation ausdrücklich für die neuen Bilder übernehmen; auch das wird protokolliert. Eine Korrektur nach der Bestätigung macht die Bestätigung ebenfalls veraltet.

`toDesignProvenance(brief)` erzeugt aus einem gültig bestätigten Auftrag die Entwurfsherkunft für `CanonicalModel.design`. Darin stehen:

- `design.brief` mit Auftrags-ID, Version und bestätigtem Hash,
- Bildquellen mit Prüfsumme, aber ohne Bilddaten,
- das Interpretationsverfahren und die Annahmen.

Abweichungen bleiben leer, bis die Konstruktion (05B) sie einträgt. Der Auftrag enthält keine Teilinstanzen.

## Automatische Analyse einrichten

Die Analyse läuft über die **Anthropic Claude API** (Modell `claude-opus-5-5`, Bildeingabe, strukturierte Ausgabe). Sie ist im Code gekapselt (`server/design-analysis/`):

- `handler.ts` ist anbieterunabhängig und prüft Bilder und Prüfsummen erneut.
- `anthropic.ts` enthält den Anbieter.
- `vitePlugin.ts` stellt die lokalen Endpunkte `GET /api/design/status` und `POST /api/design/analyze` bereit.

Jede Antwort wird mit demselben Schema geprüft wie Importe und manuelle Eingaben. Ungültige Antworten werden abgelehnt. Widersprüchliche Antworten lassen sich als Entwurf übernehmen, aber erst nach einer Korrektur bestätigen.

Einrichtung:

1. Im Projektordner `.env.local` anlegen (nicht versioniert, Vorlage `.env.example`).
2. `ANTHROPIC_API_KEY=…` eintragen; den Schlüssel gibt es in der Claude Console.
3. Speichern. Ein Neustart ist nicht nötig: Der Server liest `.env.local` bei jedem Status- und Analyseaufruf neu. Läuft noch kein Server:

```bash
npm.cmd run dev
```

Der Wert steht ohne Anführungszeichen und ohne Leerzeichen hinter dem `=`. Leere Werte und Platzhalter wie `…`, `<dein-schluessel>` oder `xxx` meldet der Status als „nicht eingerichtet“.

Der Schlüssel bleibt im lokalen Node-Server. Vite gibt nur `VITE_`-Variablen an den Browser, und der öffentliche Build wird auf Schlüssel und SDK-Spuren geprüft. `ANTHROPIC_BASE_URL` wird bewusst nicht übernommen; einen abweichenden Endpunkt nur über `BAUSTEIN_ANTHROPIC_BASE_URL` setzen.

Bei einer Ablehnung durch die Sicherheitsklassifikatoren übernimmt serverseitig ein Ersatzmodell (`fallbacks: "default"`).

Ohne Schlüssel, im statischen Build oder bei Dienstausfall steht der **manuelle Weg** zur Verfügung. Die Oberfläche nennt den Grund: nicht eingerichtet, nicht erreichbar, Ratenlimit, Schlüssel abgelehnt, Ablehnung, abgeschnittene oder ungültige Antwort.

## Stand der Prüfung

- **Automatisierte Tests:** `tests/design.test.ts` deckt Uploads, Widersprüche, Versionen, Veralten, Bestätigung, Speichern/Wiederherstellen und die Endpunkt-Fehlerfälle ab. Die Tests nutzen nur die als synthetisch deklarierte Fixture `tests/fixtures/design/interpretation-synthetic.json` und einen ausdrücklich benannten Testanbieter. Eine Live-Analyse wird nicht vorgetäuscht. Der echte Anthropic-Anbieter wird nur gegen einen geschlossenen lokalen Port geprüft (Netzwerkfehler wird erkannt).
- **Live-Analyse (2026-10-17, ein einzelner autorisierter Aufruf):** Mit dem Konzeptbild „Atreides-Sandwächter“ (SHA-256 `0d7004fd…aef15`, Ansicht „unbekannt“) in einer getrennten Testablage (`?teststore=…`) über die Anthropic Claude API, Modell `claude-opus-5-5`. Ergebnis:
  - Die Antwort wurde vom Schema angenommen, war widerspruchsfrei und wurde übernommen. Die Analysebindung trägt Prüfsumme, Ansicht und Anfragekennung.
  - Die Inhalte passen zum Bild: Patrouillenschiff im Wüsten-Tarnschema, zwei Triebwerksgondeln, Geschützturm, Kanzel, Heckrampe, Adlerwappen, Begleitfigur sowie die Heckansicht im Einschub.
  - Grundlagen: 25 Aussagen „beobachtet“, 6 „angenommen“. Alle verdeckten Bereiche und die Symmetrie sind als „angenommen“ markiert. Es gibt sechs offene Fragen, darunter Anzahl der Landebeine, Beweglichkeit und Zielgröße.
  - Danach wurde ein vollständiger Test-Entwurf bestätigt. Die Anforderungen sind Testeingaben: 900–1100 Teile, Ausstellungsmodell, ein Merkmal.
  - Dabei gefunden und behoben: Die Statuszeile übernahm den Live-Status erst nach dem Neuladen. Die Anfragekennung des Dienstes fehlte, weil `parse()` sie zur Laufzeit nicht mitliefert; sie wird jetzt aus dem Header `request-id` gelesen. Beide Korrekturen sind nach dem Live-Aufruf entstanden und nicht erneut live geprüft, um keinen zweiten kostenpflichtigen Aufruf auszulösen.
- **Echter Bilddurchlauf (manueller Weg, 2026-10-16):** Mit dem Konzeptbild „Atreides-Sandwächter“ (PNG 1536 × 1024, SHA-256 `0d7004fd…aef15`) liefen im Browser:
  - Upload und Prüfung,
  - Abweisung einer als `.png` benannten GIF-Datei und eines abgeschnittenen PNG,
  - Einwilligungsdialog,
  - die Meldung „nicht eingerichtet“.

  Die Interpretation hat der Claude-Code-Assistent im Chat nach Betrachtung des Bildes manuell eingetragen. Sie ist im Auftrag ausdrücklich als „manuell eingetragen, nicht die App-Integration“ gekennzeichnet. Danach folgten im Browser Korrektur, Widerspruch, Bildaustausch, Neu-Bestätigung und Wiederherstellen nach dem Neuladen. Bild und Auftrag liegen nur lokal (`local-designs/`, von Git ausgeschlossen).

## Bestätigung verständlich bedienbar (Korrekturauftrag 05A.3)

- **Nach dem Upload** zeigt Abschnitt 2: „Bild hochgeladen. Als Nächstes das Bild interpretieren.“ Ohne eingerichtete Analyse steht dort zusätzlich der Hinweis „Automatische Analyse nicht eingerichtet …“, mit direkten Aktionen „Manuell beschreiben“ und „Entwurfsauftrag importieren“.
- **Der Bestätigungsbutton ist immer bedienbar.** Ein Versuch ohne vollständige Angaben listet die konkreten Gründe als Warnmeldung (`role="alert"`). Jeder Eintrag führt zum betroffenen Bereich, und der Fokus springt auf die erste Lücke. Beispiele: „Interpretation fehlt“, „Teilezahl ‚von‘ fehlt“, „Mindestens ein wichtiges Merkmal auswählen“, „Interpretation nach Bild- oder Ansichtsänderung erneut prüfen“.
- **Die Gründe stammen aus dem Kern** (`confirmationBlockers`, `checkRequirements`). Dieselben Regeln gelten für `confirm`, die Checkliste, den Import und `isConfirmedCurrent`. Die Oberfläche ergänzt nur einen Hinweis, wenn Anforderungen eingegeben, aber noch nicht übernommen sind.
- **Feldfehler stehen am Feld:** `aria-invalid` mit `aria-describedby` auf die Meldung. Pflichtangaben (Teilezahl von/bis, wichtige Merkmale, Nutzung) sind mit * markiert und **nicht vorbelegt**.
- **Bei Erfolg** erscheinen „Entwurfsauftrag bestätigt.“ und „Die Konstruktion eines Bausteinmodells ist noch nicht verfügbar. Es gibt daher noch keine Bauanleitung und keine Stückliste.“
- **Prüfhilfe:** Im Entwicklungsserver wählt `?teststore=<name>` eine getrennte lokale Ablage. So berühren Browserprüfungen nie einen laufenden Nutzerentwurf. Im öffentlichen Build gibt es diesen Schalter nicht.

## Konfiguriert ist nicht live geprüft (Auftrag 05A.4)

- **Schlüsselform:** `apiKeyProblem` erkennt fehlende, leere und Platzhalter-Werte sowie Anführungszeichen und Leerzeichen. Eine plausible Form heißt nur „Schlüssel eingerichtet“.
- **Live-Status:** `GET /api/design/status` liefert zusätzlich `liveCheck` (`unverified` / `ok` / `failed`, Zeitpunkt, Fehlercode, Modell). Den Status setzen nur tatsächliche Dienstantworten dieser Serversitzung (`nextLiveCheck`). Anfragen, die den Dienst nicht erreichen (nicht eingerichtet, ungültige Anfrage), ändern ihn nicht.
- **Oberfläche:** Mit Schlüssel steht dort „Schlüssel eingerichtet; in dieser Serversitzung noch nicht live geprüft“, nach einem Aufruf „zuletzt erfolgreich live aufgerufen“ oder „letzter Live-Aufruf fehlgeschlagen (Code)“. Das frühere „einsatzbereit“ entfällt.
- **Keine automatischen Wiederholungen:** Der Anbieter ruft die API mit `maxRetries: 0` auf. Ein fehlgeschlagener, möglicherweise kostenpflichtiger Aufruf wird nur auf ausdrückliche Nutzeraktion wiederholt.

## Import und Analysezuordnung (Korrekturauftrag 05A.1)

- **Vollständige Laufzeitprüfung beim Laden** (Import und lokale Wiederherstellung, `parseBrief`):
  1. JSON und Schema-Kennung.
  2. Struktur aller Felder (zod): Bildreferenzen, Analyseherkunft, Anforderungen, Korrekturen, Verlauf, Version, Bestätigung, Interpretation.
  3. Inhalts-Hash.
  4. Fachliche Prüfung (`briefIssues`).

  Strukturfehler führen zur Ablehnung mit Meldung. Fachlich widersprüchliche Aufträge werden nur **unbestätigt zur Korrektur** geladen: Eine vorhandene Bestätigung wird mit Verlaufseintrag aufgehoben. Ein korrekter Hash ersetzt keine fachliche Prüfung.
- **`isConfirmedCurrent` und `toDesignProvenance`** setzen voraus, dass der Auftrag fachlich gültig ist und die Interpretation zu den aktuellen Bildern gehört. `isConfirmedCurrent` wirft nie.
- **Analyseanfragen sind unveränderlich gebunden** (`createTicket`): Projekt-ID, Version, Eingabe-Hash (Bilder samt Reihenfolge und Ansicht), Stand der Interpretation, Bildprüfsummen, Ansichten, Hinweise und eine eindeutige Anfragekennung, die der Server zurückgibt.
  - Eine Antwort wird nur übernommen, wenn sich der relevante Stand nicht geändert hat.
  - Hat sich etwas geändert (Bildwechsel, Entfernen, Ansicht, Korrektur, Import), wird die Antwort **zurückgehalten** und behält ihren ursprünglichen Bildbezug.
  - Bei einem anderen Projekt (neuer Entwurf, Import) wird sie verworfen.
  - Eine ausdrückliche Übernahme durch den Nutzer setzt den Bildbezug der Anfrage. Passt er nicht zu den aktuellen Bildern, ist die Interpretation sofort veraltet.
  - Widersprüchliche Dienstantworten werden nie automatisch übernommen.

### Ansichten gehören zur Bindung (Nachtrag 05A.2)

Eine Interpretation gilt nur als aktuell, wenn **Prüfsummen, Reihenfolge und Ansichtsbezeichnungen** der analysierten Bilder mit den aktuellen übereinstimmen (`bindingMismatch`). Dieselbe Prüfung nutzen Übernahme, `readiness`, `confirm`, `isConfirmedCurrent`, `toDesignProvenance` und der Import.

- Ändert sich die Ansicht eines Bildes (`setView`), ist die Interpretation sofort veraltet.
- Übernommene Antworten behalten ihre ursprünglichen Ansichten und bleiben bei Abweichung veraltet.
- Aktualisieren lassen sich der Stand nur durch eine neue Analyse oder eine ausdrücklich protokollierte Neubewertung für die aktuellen Bilder und Ansichten.
- Ältere Dateien ohne `inputViews`: Hier gelten die Ansichten als **nicht belegt** (`null`), es wird keine Zuordnung erfunden. Die Analyse wird beim Laden mit Begründung als veraltet markiert und braucht eine Neubewertung.

## Nächster Schritt vor der Steinkonstruktion: gemeinsames Volumenmodell

Die 2D-Bildbereiche reichen nicht, um Steine zu setzen: Sie haben keine Tiefe, und Rechtecke aus verschiedenen Ansichten passen nicht zwingend zusammen. Vor der Konstruktion (05B) soll daher ein **gemeinsames räumliches Volumenmodell** entstehen.

- Je Baugruppe einfache Körper (zunächst Quader) mit Lage und Größe in einem gemeinsamen Koordinatensystem, abgeleitet aus den bestätigten Bildbereichen, den relativen Größen und der Symmetrie.
- Jede Annahme bleibt gekennzeichnet (beobachtet, angenommen, Vorgabe).
- Aus diesem einen Modell werden **sechs Ansichten gerendert** (vorn, hinten, links, rechts, oben, unten). Der Nutzer prüft sie gegen die Vorlage und korrigiert, bis Proportionen und Silhouette stimmen.
- Widersprüche zwischen Ansichten werden sichtbar, statt in der Steinkonstruktion zu verschwinden.
- Erst ein bestätigtes Volumenmodell dient als Eingabe für die Bausteinkonstruktion. Der Entwurfsauftrag verweist dann auf dessen Version und Hash.

## Grenzen

- Es gibt keine automatische Bildvorverarbeitung (Freistellen, Zerlegen von Collagen). Mehrere Ansichten in **einem** Bild, wie Einsatzbilder, beschreibt die Interpretation als Bildbereiche desselben Bildes.
- Proportionen sind relativ und geschätzt. Bildbereiche sind Rechtecke, keine Umrisse.
- Der visuelle Abgleich zwischen Bild und späterem Modell ist noch nicht umgesetzt (`visualComparison.status = 'unchecked'`).
- Die lokale Ablage (IndexedDB) gilt pro Browser und Gerät. Wer sie löscht, verliert die Bilder; der exportierte Auftrag behält nur die Prüfsummen.
