# Aus Bild entwerfen (Auftrag 05A)

Erster Abschnitt der Kette aus A18: **Bild → nachvollziehbare Interpretation → vom Nutzer bestätigter Entwurfsauftrag.** Es entstehen dabei keine Steine. Konstruktion, Bauanleitung und Stückliste folgen erst, wenn aus einem bestätigten Auftrag ein echtes kanonisches Modell mit geprüfter Baufolge konstruiert ist (Auftrag 05B).

## Ablauf in der Oberfläche

1. **Bildvorlagen:** PNG oder JPEG hochladen, höchstens 4 Bilder mit je höchstens 5 MB. Bilder lassen sich ersetzen oder entfernen, jedem Bild lässt sich eine Ansicht zuordnen (vorn, seitlich, hinten, oben, schräg).
   - Geprüft wird der **Dateiinhalt**: die PNG-/JPEG-Signatur (die Endung zählt nicht), die Maße aus dem Dateikopf (64–8000 px je Seite) und die tatsächliche Dekodierbarkeit im Browser.
   - Jedes Bild wird über seine **SHA-256-Prüfsumme** identifiziert. Gleicher Dateiname mit anderem Inhalt ergibt eine andere Kennung.
2. **Interpretation:** entweder automatisch über den lokalen Analysedienst oder manuell.
   - Vor dem Senden zeigt ein Dialog, welcher Dienst welche Bilder erhält: Prüfsummen, Ansichtsbezeichnung und Hinweise, keine Dateinamen. Gesendet wird erst nach ausdrücklicher Einwilligung.
   - Bild und Interpretation stehen nebeneinander. Die Bildbereiche der Baugruppen erscheinen als Rahmen im Bild: durchgezogen für beobachtet, gestrichelt für angenommen oder vorgegeben.
   - Eine schematische Vorschau ist ausdrücklich als „Räumliche Interpretation – noch ohne echte Steine“ gekennzeichnet.
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
3. Entwicklungsserver neu starten:

```bash
npm.cmd run dev
```

Der Schlüssel bleibt im lokalen Node-Server. Vite gibt nur `VITE_`-Variablen an den Browser, und der öffentliche Build wird auf Schlüssel und SDK-Spuren geprüft. `ANTHROPIC_BASE_URL` wird bewusst nicht übernommen; einen abweichenden Endpunkt nur über `BAUSTEIN_ANTHROPIC_BASE_URL` setzen.

Bei einer Ablehnung durch die Sicherheitsklassifikatoren übernimmt serverseitig ein Ersatzmodell (`fallbacks: "default"`).

Ohne Schlüssel, im statischen Build oder bei Dienstausfall steht der **manuelle Weg** zur Verfügung. Die Oberfläche nennt den Grund: nicht eingerichtet, nicht erreichbar, Ratenlimit, Schlüssel abgelehnt, Ablehnung, abgeschnittene oder ungültige Antwort.

## Stand der Prüfung

- **Automatisierte Tests:** `tests/design.test.ts` deckt Uploads, Widersprüche, Versionen, Veralten, Bestätigung, Speichern/Wiederherstellen und die Endpunkt-Fehlerfälle ab. Die Tests nutzen nur die als synthetisch deklarierte Fixture `tests/fixtures/design/interpretation-synthetic.json` und einen ausdrücklich benannten Testanbieter. Eine Live-Analyse wird nicht vorgetäuscht. Der echte Anthropic-Anbieter wird nur gegen einen geschlossenen lokalen Port geprüft (Netzwerkfehler wird erkannt).
- **Live-Analyse:** Sie wurde **noch nicht im echten Betrieb ausgeführt**, weil für das Projekt kein API-Schlüssel vorhanden war.
- **Echter Bilddurchlauf (manueller Weg, 2026-10-16):** Mit dem Konzeptbild „Atreides-Sandwächter“ (PNG 1536 × 1024, SHA-256 `0d7004fd…aef15`) liefen im Browser:
  - Upload und Prüfung,
  - Abweisung einer als `.png` benannten GIF-Datei und eines abgeschnittenen PNG,
  - Einwilligungsdialog,
  - die Meldung „nicht eingerichtet“.

  Die Interpretation hat der Claude-Code-Assistent im Chat nach Betrachtung des Bildes manuell eingetragen. Sie ist im Auftrag ausdrücklich als „manuell eingetragen, nicht die App-Integration“ gekennzeichnet. Danach folgten im Browser Korrektur, Widerspruch, Bildaustausch, Neu-Bestätigung und Wiederherstellen nach dem Neuladen. Bild und Auftrag liegen nur lokal (`local-designs/`, von Git ausgeschlossen).

## Grenzen

- Es gibt keine automatische Bildvorverarbeitung (Freistellen, Zerlegen von Collagen). Mehrere Ansichten in **einem** Bild, wie Einsatzbilder, beschreibt die Interpretation als Bildbereiche desselben Bildes.
- Proportionen sind relativ und geschätzt. Bildbereiche sind Rechtecke, keine Umrisse.
- Der visuelle Abgleich zwischen Bild und späterem Modell ist noch nicht umgesetzt (`visualComparison.status = 'unchecked'`).
- Die lokale Ablage (IndexedDB) gilt pro Browser und Gerät. Wer sie löscht, verliert die Bilder; der exportierte Auftrag behält nur die Prüfsummen.
