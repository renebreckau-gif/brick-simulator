# Baustein-Simulator – Phase 1: Grundarchitektur und Prüflabor

Lokale Webanwendung, die reale Bausteinmodelle aus **einem kanonischen, versionierten Modell** darstellt, prüft, als Stückliste ausgibt und ihre Bauschritte wiedergibt. Langfristig soll daraus eine Kette werden: Idee → Entwurf → Konstruktion aus realen Teilen → Prüfung → Bauanleitung → Beschaffung (siehe [docs/ROADMAP.md](docs/ROADMAP.md)). Diese Phase liefert nur den belegbaren Kern.

## Start

Voraussetzung: Node.js ≥ 20 (entwickelt mit 24.20). **Bei einem frischen Checkout zuerst den Katalogauszug erzeugen** (siehe „Fehlende lokale Daten“), sonst lädt das Prüflabor nicht.

### Windows PowerShell

In PowerShell blockiert die Ausführungsrichtlinie häufig `npm.ps1`. `npm.cmd` funktioniert ohne Änderung der Richtlinie. Jeweils einzeln ausführen:

```powershell
npm.cmd install
```

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
npm install
npm run dev        # Prüflabor auf http://localhost:5173
npm test           # Vitest
npm run typecheck  # TypeScript
npm run build      # Typprüfung + Produktionsbuild nach dist/
npm run check      # alles zusammen
```

Die Anwendung läuft vollständig lokal. Die Daten liegen in `data/` und werden vom Entwicklungsserver ausgeliefert. Internet wird nur für die Schriftart (Google Fonts, mit Systemschrift-Ersatz) und für die externen Anleitungslinks benötigt.

## Fehlende lokale Daten nach einem frischen Checkout

Im Repository enthalten sind die LDraw-Geometrie (`data/ldraw/`, CC BY 4.0, mit `CAreadme.txt` und `manifest.json` mit Herkunft, Lizenzzeile und SHA-256 je Datei), die Referenzmodelle aus dem LDraw-OMR (`data/references/omr/`, CC BY 2.0), die eigene ID-Zuordnung, die Referenzmetadaten und die Erwartungen.

**Nicht enthalten** ist der Katalogauszug `data/catalog/rebrickable-extract.json`. Er wird aus den Rebrickable-CSV-Dumps erzeugt, deren Nutzungs- und Weitergabebedingungen beim Erstellen nicht geklärt werden konnten (siehe [docs/QUELLEN.md](docs/QUELLEN.md)). Deshalb sind weder die Rohdaten noch der Auszug veröffentlicht.

Ohne diese Datei:

- lädt das Prüflabor nicht; es zeigt die Meldung „Daten konnten nicht geladen werden“.
- schlagen alle Tests fehl, die Daten laden (Katalog, Referenzen, Grenzfälle).

So erzeugen Sie den Auszug selbst:

1. Die Rebrickable-Nutzungsbedingungen unter https://rebrickable.com/terms/ und die Downloadseite https://rebrickable.com/downloads/ lesen. Die Dateien nur verwenden, wenn die Bedingungen das für Ihren Zweck erlauben.
2. Von der Downloadseite diese sieben Dateien laden und entpacken: `parts.csv.gz`, `colors.csv.gz`, `elements.csv.gz`, `inventories.csv.gz`, `inventory_parts.csv.gz`, `part_relationships.csv.gz`, `sets.csv.gz`.
3. Die entpackten `.csv`-Dateien nach `data-raw/rebrickable/` legen. Dieser Ordner ist in `.gitignore` ausgeschlossen.
4. Den Auszug erzeugen und als zweites Argument das Abrufdatum angeben (ISO-Format):

   ```powershell
   node scripts/extract-rebrickable.mjs data-raw/rebrickable 2026-10-14T15:51:39Z
   ```

   Das Skript schreibt `data/catalog/rebrickable-extract.json` (ebenfalls ausgeschlossen).

Hinweis: Rebrickable aktualisiert die Dumps laufend. Mit einem anderen Abrufstand können sich Belegzahlen und einzelne Inventare ändern. Die Tests prüfen den Stand vom 2026-10-14 und können dann abweichen.

Die LDraw-Dateien lassen sich bei Bedarf mit `node scripts/fetch-ldraw.mjs` neu laden (Wurzelliste: `data/ldraw/roots.json`; das Skript drosselt die Anfragen).

## Was das Prüflabor zeigt

- **Auswahl**: drei Referenzmodelle aus dem LDraw-OMR, 24 Grenzfälle (synthetische Fixtures) und 5 gezielt beschädigte Varianten einer Referenz.
- **3D-Ansicht** (drehen, zoomen, Teil anklicken), gerendert ausschließlich aus der aktuellen Modellversion. Die Kennung der Modellversion steht im Bild.
- **Bauschritte** mit Baugruppen, Einschubrichtung (deklariert oder abgeleitet), Status je Teil, Unterstützungs- und Montagehinweisen.
- **Stückliste** exakt aus dem Modell, nicht auflösbare Einträge getrennt, bei Referenzen mit **unabhängigem Abgleich** gegen das Rebrickable-Inventar.
- **Prüfbericht** mit Blockern, Warnungen, ungeprüften und nicht unterstützten Bereichen. Die Evidenzstufe ist als Symbol kodiert: gefüllt = bestätigt, schraffiert = heuristisch, gestrichelt = ungeprüft. Klick auf einen Befund hebt die betroffenen Teile hervor.
- **Herkunft & Erwartung**: Quellen, Lizenz, Abgleichsweg, gedeckter und offener Prüfumfang; bei Grenzfällen die getrennt deklarierte Erwartung und ob sie erfüllt ist.
- **Änderungen**: Ein ausgewähltes Teil kann verschoben oder entfernt werden. Danach gelten Bericht, Baufolgenprüfung, Stückliste und Beschaffungsstand als veraltet, bis die neue Version geprüft ist.
- **Export**: Modell (JSON), Prüfbericht (JSON), Stückliste (CSV), LDraw (mit STEP je Schritt).

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
src/ui/            React-Oberfläche, Three.js-Ansicht
data/              LDraw-Dateien, Katalogauszug, Referenzen, Erwartungen
tests/             Vitest-Suite
docs/              Architektur, Quellen, Referenzmatrix, Grenzen, Roadmap, Prüfprotokolle
```

## Dokumentation

- [Architekturentscheidungen](docs/ARCHITEKTUR.md)
- [Quellen- und Lizenzregister](docs/QUELLEN.md)
- [Referenzmatrix und Grenzfälle](docs/REFERENZMATRIX.md)
- [Validierungsgrenzen](docs/VALIDIERUNGSGRENZEN.md)
- [Physische Prüfprotokolle (Kalibrierung, noch nicht durchgeführt)](docs/PHYSISCHE-PRUEFPROTOKOLLE.md)
- [Roadmap](docs/ROADMAP.md)

## Namensnennung

Teilegeometrie: **LDraw Parts Library** (ldraw.org), CC BY 4.0. Referenzmodelle aus dem LDraw Official Model Repository, CC BY 2.0: 40013-1 von Takeshi Takahashi, 21002-1 von Orion Pobursky, 1869-1 von Merlijn Wissink. Katalogdaten: Rebrickable (rebrickable.com). LEGO® ist eine Marke der LEGO Gruppe, die dieses Projekt weder unterstützt noch autorisiert.
