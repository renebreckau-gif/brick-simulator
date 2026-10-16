# Baustein-Simulator – Phase 1: Grundarchitektur und Prüflabor

Lokale Webanwendung, die reale Bausteinmodelle aus **einem kanonischen, versionierten Modell** darstellt, prüft, als Stückliste ausgibt und ihre Bauschritte wiedergibt. Langfristig soll daraus eine Kette werden: Idee → Entwurf → Konstruktion aus realen Teilen → Prüfung → Bauanleitung → Beschaffung (siehe [docs/ROADMAP.md](docs/ROADMAP.md)). Diese Phase liefert nur den belegbaren Kern.

## Start

Voraussetzung: Node.js ≥ 20 (entwickelt mit 24.20, CI mit 24). Ein frischer Checkout läuft **ohne** private Daten: Referenzmodelle, 3D-Ansicht, Bauschritte, geometrische Prüfungen und die Stückliste funktionieren sofort. Nur Katalog- und Inventarabgleiche bleiben ungeprüft, bis lokal ein Katalogauszug vorliegt (siehe „Optionale private Daten“).

### Windows PowerShell

In PowerShell blockiert die Ausführungsrichtlinie häufig `npm.ps1`. `npm.cmd` funktioniert ohne Änderung der Richtlinie. Jeweils einzeln ausführen:

```powershell
npm.cmd install
```

(Für eine Installation exakt nach `package-lock.json`, wie in der CI: `npm.cmd ci`.)

```powershell
npm.cmd run dev
```

Das Prüflabor läuft dann auf http://localhost:5173. Weitere Befehle, ebenfalls einzeln:

```powershell
npm.cmd test
```

```powershell
npm.cmd run typecheck
```

```powershell
npm.cmd run build
```

### Andere Shells (Git Bash, macOS, Linux)

```bash
npm ci                    # Installation nach Lockdatei
npm run dev               # Prüflabor auf http://localhost:5173
npm test                  # reguläre Tests (ohne private Daten)
npm run typecheck         # TypeScript
npm run build             # Typprüfung + Produktionsbuild + Prüfung der öffentlichen Daten in dist/
npm run check             # alles zusammen
npm run test:rebrickable  # optional: Integrationstests gegen den privaten Katalogauszug
```

Die Anwendung läuft vollständig lokal. Internet wird nur für die Schriftart (Google Fonts, mit Systemschrift-Ersatz) und für die externen Anleitungslinks benötigt.

## Datenquellen: Pflicht und optional

| Daten | Ort | Status | Im Repository |
|---|---|---|---|
| LDraw-Geometrie (79 Teiledateien, `LDConfig.ldr`, `CAreadme.txt`, Manifest mit Herkunft/Lizenz/SHA-256) | `data/ldraw/` | Pflicht | ja (CC BY 4.0) |
| Referenzmodelle aus dem LDraw-OMR | `data/references/` | Pflicht | ja (CC BY 2.0) |
| Eigene ID-Zuordnung, Erwartungen | `data/catalog/id-map.json`, `data/expectations/` | Pflicht | ja |
| Katalogauszug (Rebrickable) | `data/catalog/rebrickable-extract.json` | **optional, privat** | **nein** |
| Rebrickable-Rohdaten | `data-raw/` | optional, privat | **nein** |

Das Prüflabor zeigt links unter „Datenquellen“, was geladen ist, und unter „Prüfumfang“, was verfügbar und was ungeprüft ist. Fehlt der Katalogauszug, gilt:

- Teilexistenz im Katalog, Farbzuordnung zu Rebrickable, Teil-Farb-Belege und Inventarabgleiche der Referenzen sind **ungeprüft**. Es werden keine Ersatzdaten erzeugt, und aus dem Fehlen folgt weder Existenz noch Nichtexistenz.
- Die Stückliste entsteht aus den Modellinstanzen mit LDraw-Teil- und Farbnamen. Die Rebrickable-Spalten bleiben leer und sind als ungeprüft markiert.
- Ein **beschädigter** Auszug wird nicht verwendet. Das Prüflabor nennt Datei und Grund (z. B. „kein gültiges JSON“, „Feld „parts“ fehlt“); der Rest bleibt nutzbar.

## Öffentliche Builds

`data/` wird **nicht** pauschal ausgeliefert. Dev-Server und Build verwenden eine explizite Positivliste (`scripts/data-files.mjs`), die aus festen Einträgen, dem LDraw-Manifest und dem Referenzregister abgeleitet ist. Der private Katalogauszug wird nur vom lokalen Dev-Server ausgeliefert, nie gebaut. Nach jedem `npm run build` prüft `scripts/check-public-build.mjs` den Ordner `dist/` und bricht ab, wenn

- eine nicht freigegebene Datei unter `dist/data/` liegt,
- ein verbotener Pfad auftaucht (Rohdaten, Katalogauszug, CSV, `.env`),
- eine JSON-Datei das Schema eines Katalogauszugs trägt oder
- eine freigegebene Datei fehlt oder vom Original abweicht.

Die CI (`.github/workflows/fresh-checkout.yml`) prüft bei jedem Push und Pull Request einen frischen Checkout ohne private Daten: Installation nach Lockdatei, Typprüfung, reguläre Tests, Build mit Prüfung, die ausdrückliche Meldung der Integrationstests und eine öffentliche Vorschau, die die Pflichtdaten ausliefert, den Katalog aber nicht (HTTP 404).

## Optionale private Daten: Katalogauszug erzeugen

Der Katalogauszug `data/catalog/rebrickable-extract.json` ist nicht veröffentlicht. Er wird aus den Rebrickable-CSV-Dumps erzeugt, deren Nutzungs- und Weitergabebedingungen beim Erstellen nicht geklärt werden konnten (siehe [docs/QUELLEN.md](docs/QUELLEN.md)).

So erzeugen Sie den Auszug selbst:

1. Die Rebrickable-Nutzungsbedingungen unter https://rebrickable.com/terms/ und die Downloadseite https://rebrickable.com/downloads/ lesen. Die Dateien nur verwenden, wenn die Bedingungen das für Ihren Zweck erlauben.
2. Von der Downloadseite diese sieben Dateien laden und entpacken: `parts.csv.gz`, `colors.csv.gz`, `elements.csv.gz`, `inventories.csv.gz`, `inventory_parts.csv.gz`, `part_relationships.csv.gz`, `sets.csv.gz`.
3. Die entpackten `.csv`-Dateien nach `data-raw/rebrickable/` legen. Dieser Ordner ist in `.gitignore` ausgeschlossen.
4. Den Auszug erzeugen und als zweites Argument das Abrufdatum angeben (ISO-Format):

   ```powershell
   node scripts/extract-rebrickable.mjs data-raw/rebrickable 2026-10-14T15:51:39Z
   ```

   Das Skript schreibt `data/catalog/rebrickable-extract.json` (ebenfalls ausgeschlossen).

Danach zeigt das Prüflabor Katalogbelege und den Inventarabgleich der Referenzen. Die Integrationstests laufen mit:

```powershell
npm.cmd run test:rebrickable
```

Fehlt der Auszug, bricht dieser Befehl mit der Meldung „Rebrickable-Integrationstests NICHT ausgeführt …“ ab. Er wird nicht übersprungen und nicht als bestanden gewertet. Die reguläre Suite (`npm test`) liest den privaten Auszug nie, auch wenn er lokal liegt; ihre Kataloglogik-Tests verwenden die synthetische, ausdrücklich gekennzeichnete Testfixture `tests/fixtures/catalog-fixture.json` (kein Beleg für reale Teile).

Hinweis: Rebrickable aktualisiert die Dumps laufend. Mit einem anderen Abrufstand können sich Belegzahlen und einzelne Inventare ändern; die Integrationstests prüfen den Stand vom 2026-10-14 und können dann abweichen.

Die LDraw-Dateien lassen sich bei Bedarf mit `node scripts/fetch-ldraw.mjs` neu laden (Wurzelliste: `data/ldraw/roots.json`; das Skript drosselt die Anfragen).

## Was das Prüflabor zeigt

- **Auswahl**: drei Referenzmodelle aus dem LDraw-OMR, dazu 21002-1 mit der Baufolge nach LEGO-Anleitung (abgeleitet, eigene Schrittzuordnung); 34 Grenzfälle (synthetische Fixtures, darunter 10 zur Sonderverbindung „Unterseitenstift in Hohlnoppe“) und 5 gezielt beschädigte Varianten einer Referenz.
- **3D-Ansicht** (drehen, zoomen, Teil anklicken), gerendert ausschließlich aus der aktuellen Modellversion. Die Kennung der Modellversion steht im Bild.
- **Bauschritte** mit Baugruppen, Einschubrichtung (deklariert oder abgeleitet), Status je Teil, Unterstützungs- und Montagehinweisen.
- **Stückliste** exakt aus dem Modell, nicht auflösbare Einträge getrennt; mit lokalem Katalogauszug zusätzlich **unabhängiger Abgleich** gegen das Rebrickable-Inventar der Referenzen (sonst ausdrücklich ungeprüft).
- **Prüfbericht** mit Blockern, Warnungen, ungeprüften und nicht unterstützten Bereichen. Die Evidenzstufe ist als Symbol kodiert: gefüllt = bestätigt, schraffiert = heuristisch, gestrichelt = ungeprüft. Klick auf einen Befund hebt die betroffenen Teile hervor.
- **Herkunft & Erwartung**: Quellen, Lizenz, Abgleichsweg, gedeckter und offener Prüfumfang; bei Grenzfällen die getrennt deklarierte Erwartung und ob sie erfüllt ist.
- **Änderungen**: Ein ausgewähltes Teil kann verschoben oder entfernt werden. Danach gelten Bericht, Baufolgenprüfung, Stückliste und Beschaffungsstand als veraltet, bis die neue Version geprüft ist.
- **Export**: Modell (JSON), Prüfbericht (JSON), Stückliste (CSV), LDraw (mit STEP je Schritt).

## Aus Bild entwerfen

Der dritte Bereich in der Seitenleiste nimmt eine oder mehrere Konzeptbilder (PNG/JPEG) entgegen. Er prüft jedes Bild am Dateiinhalt und identifiziert es per SHA-256; die Bilder bleiben lokal im Browser. Daraus entsteht eine nachvollziehbare Interpretation, entweder automatisch über die Claude API (nur über den lokalen Server, mit vorheriger Einwilligung) oder manuell. Jede Aussage ist als beobachtet, angenommen oder Nutzervorgabe gekennzeichnet.

Nach Korrekturen und Anforderungen (Teilezahl, Höchstmaße, wichtigste Merkmale, Nutzung) wird ein versionierter Entwurfsauftrag bestätigt. Er enthält noch keine Steine; Bauanleitung und Stückliste gibt es erst mit einem echten Modell.

Automatische Analyse einrichten: `.env.local` mit `ANTHROPIC_API_KEY=…` anlegen (Vorlage `.env.example`), dann den Entwicklungsserver neu starten. Details, Grenzen und Prüfstand: [docs/BILDENTWURF.md](docs/BILDENTWURF.md).

## Bauanleitung

Der Schalter „Bauanleitung“ über dem Hauptbereich wechselt vom Modell zur Anleitung des angezeigten Modells. Das gilt für jedes Modell ohne Blocker mit Baufolge: Raumschiffe, Referenzen und Grenzfälle. Die Anleitung zeigt eine Übersicht mit tatsächlicher Teilezahl, Außenmaßen, Modell-ID, Hash und Planversion. Dazu kommen Schritte mit großen Bildern aus den Teilinstanzen: neue Teile hervorgehoben, Einsetzpfeile nur bei geprüften Steckwegen. Je Schritt gibt es eine Teileübersicht, für die Ausleger eine isolierte Vormontage, und am Ende die vollständige Stückliste. Druckansicht und PDF-Export (A4, lokal im Browser) nutzen dieselbe Datenbasis. Nach einer Modelländerung ist die Anleitung als veraltet gekennzeichnet, und der Export ist gesperrt. Der Hinweis zur Herkunft richtet sich nach dem Modell (eigener Entwurf, Referenz oder Testfall). Keine Anleitung ist physisch erprobt. Details und Grenzen: [docs/BAUANLEITUNG.md](docs/BAUANLEITUNG.md).

## Raumschiff-Labor

Der zweite Bereich in der Seitenleiste erzeugt ein eigenes, kleines Raumschiff aus dem vorhandenen Teileumfang. Es ist ein eigener Entwurf, kein offizielles LEGO-Modell. Eingaben: Rumpflänge, Spannweite, Teilezahlbereich, Farbpalette, Variantenkennung. Dazu kommen drei Vorgaben: kompakt (109 Teile), langgestreckt (140), breit (138). Jede Änderung erzeugt sofort einen neuen Modellstand und prüft ihn mit dem regulären Validator. Angezeigt werden geplante und tatsächliche Teilezahl, Außenmaße aus der Geometrie, Prüfstatus, Baufolge, Stückliste und Exporte. Nicht erfüllbare Eingaben ergeben eine Meldung mit dem erreichbaren Bereich. Der zuletzt gültige Stand bleibt dann sichtbar, ist aber als nicht passend gekennzeichnet, und die Exporte sind gesperrt. Preise werden nicht angezeigt. Generatorprinzip, Grenzen und Protokoll für einen späteren physischen Probeaufbau: [docs/RAUMSCHIFF.md](docs/RAUMSCHIFF.md).

## Projektaufbau

```
src/core/          UI-unabhängiger Kern
  ldraw/           Parser (LDR/MPD), Teilebibliothek, Farben (LDConfig)
  catalog/         Katalog: Existenz, Simulationsunterstützung, Teil-Farb-Belege, ID-Zuordnung
  connectivity/    Anschlussarten, Regeln (versioniert), Teil-Metadaten (versioniert, mit Herkunft)
  model/           kanonisches Modell, LDraw-Import, Inhalts-Hash, Änderungen/Invalidierung
  validation/      Prüfschichten und Bericht
  bom/             Stückliste und unabhängiger Abgleich
  procurement/     Provider-Schnittstelle, Angebotsschema, Bestandsabzug (keine Angebote)
  export/          JSON, CSV, LDraw
  data/            Laden aller Daten über eine austauschbare Lesefunktion
src/fixtures/      Grenzfälle und Fehlervarianten (synthetisch, gekennzeichnet)
src/core/design/   Bildvorlage, Interpretation, Entwurfsauftrag (versioniert, ohne Teilinstanzen)
src/core/instructions/ Anleitungsplan (abgeleitet, versioniert, mit Modellbezug)
src/generator/     Raumschiff-Generator (deterministisch, versioniert)
src/ui/instructions/ Bauanleitung: Rendering, Bildschirm-/Druckansicht, PDF (jsPDF)
src/ui/            React-Oberfläche, Three.js-Ansicht
data/              LDraw-Dateien, Katalogauszug, Referenzen, Erwartungen
tests/             reguläre Vitest-Suite (ohne private Daten; Kataloglogik mit synthetischer Testfixture)
tests-rebrickable/ optionale Integrationstests gegen den privaten Katalogauszug (npm run test:rebrickable)
server/            lokale Server-Endpunkte (Bildanalyse, nur Entwicklungsserver)
scripts/           Datenabruf, Positivliste öffentlicher Daten, Prüfung von dist/
.github/workflows/ CI: frischer Checkout ohne private Daten
docs/              Architektur, Quellen, Referenzmatrix, Grenzen, Roadmap, Prüfprotokolle
```

## Dokumentation

- [Architekturentscheidungen](docs/ARCHITEKTUR.md)
- [Quellen- und Lizenzregister](docs/QUELLEN.md)
- [Referenzmatrix und Grenzfälle](docs/REFERENZMATRIX.md)
- [Validierungsgrenzen](docs/VALIDIERUNGSGRENZEN.md)
- [Physische Prüfprotokolle (Kalibrierung, noch nicht durchgeführt)](docs/PHYSISCHE-PRUEFPROTOKOLLE.md)
- [Raumschiff-Labor: Generator, Varianten, Grenzen, Probeaufbau-Protokoll](docs/RAUMSCHIFF.md)
- [Bauanleitung: Anleitungsplan, Ansichten, PDF, Grenzen](docs/BAUANLEITUNG.md)
- [Aus Bild entwerfen: Interpretation, Entwurfsauftrag, Analyse einrichten](docs/BILDENTWURF.md)
- [Roadmap](docs/ROADMAP.md)

## Namensnennung

Teilegeometrie: **LDraw Parts Library** (ldraw.org), CC BY 4.0. Referenzmodelle aus dem LDraw Official Model Repository, CC BY 2.0: 40013-1 von Takeshi Takahashi, 21002-1 von Orion Pobursky, 1869-1 von Merlijn Wissink. Katalogdaten: Rebrickable (rebrickable.com). LEGO® ist eine Marke der LEGO Gruppe, die dieses Projekt weder unterstützt noch autorisiert.
