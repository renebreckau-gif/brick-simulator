# Quellen- und Lizenzregister

Alle Abrufe am 2026-10-14. Primärdokumentation wurde vor der Integration gelesen.

| Quelle | Verwendung | Abruf | Lizenz / Nutzungsstatus | Im Repository |
|---|---|---|---|---|
| [LDraw-Dateiformat 1.0.2](https://www.ldraw.org/article/218.html) | Parser, Koordinaten, Einheiten, Farbe 16/24, STEP | gelesen | Spezifikation | nein |
| [LDraw Contributor Agreement](https://www.ldraw.org/article/349.html) und [Legal Info](https://www.ldraw.org/docs-main/licenses/legal-info.html) | Lizenzklärung | gelesen | aktuelle Teile CC BY 4.0 (oder CC0); ältere CCAL 2.0; Namensnennung „The LDraw Parts Library“ genügt laut SteerCo | nein |
| LDraw Parts Library, `https://library.ldraw.org/library/official/` | Geometrie für 22 Wurzelteile, 79 Dateien inkl. Unterdateien/Primitive, `LDConfig.ldr` | Skript `scripts/fetch-ldraw.mjs`, mit Drosselung (HTTP 429 beachtet) | jede Datei: „Licensed under CC BY 4.0“ (im Manifest je Datei erfasst) | **ja**, `data/ldraw/` mit `manifest.json` (URL, SHA-256, Autor, Lizenzzeile) und `CAreadme.txt` |
| [LDraw OMR](https://library.ldraw.org/omr) | Referenzmodelle 40013-1, 21002-1, 1869-1 (Geometrie, STEP, Untermodelle) | einzeln heruntergeladen | Dateikopf: „Redistributable under CCAL version 2.0“ (CC BY 2.0), Autoren siehe README | **ja**, `data/references/omr/` (SHA-256 in `references.json`, per Test geprüft) |
| [Rebrickable Downloads](https://rebrickable.com/downloads/) (CSV-Dumps über `cdn.rebrickable.com`) | Teile, Farben, Element-IDs, Set-Inventare, Teilebeziehungen | 2026-10-14 15:51 UTC | **ungeklärt**: Die Seiten `/downloads/` und `/terms/` waren hinter einer Bot-Prüfung, die nicht umgangen wurde. Die API-Doku verweist für Massendaten ausdrücklich auf die Downloads. | **nein**: weder Rohdaten (`data-raw/`) noch der erzeugte Auszug `data/catalog/rebrickable-extract.json` – beide in `.gitignore`, nur lokal. Erzeugung beschrieben im README. Im Repository stehen nur einzelne zitierte Fakten (Teilenummern, Inventar-IDs, Mengen in `references.json`, Tests und Doku) zur Nachvollziehbarkeit |
| [Rebrickable API v3](https://rebrickable.com/api/v3/docs/) | gelesen | – | API-Schlüssel nötig, etwa 1 Anfrage/s | nicht angebunden; Blocker: kein Schlüssel. Daher keine `external_ids`-Bestätigung der ID-Zuordnung |
| [LEGO Bauanleitung 21002](https://www.lego.com/de-de/service/building-instructions/21002) | Verlinkung, Teilezahl 77, Altersangabe 10+, Jahr 2008 | gelesen | Anleitung © LEGO – **nur verlinkt**, nicht mitgeliefert | nein |
| [Brickset 40013-1](https://brickset.com/sets/40013-1), [1869-1](https://brickset.com/sets/1869-1) | Sekundärangaben (Teilezahl, Alter, Anleitungshinweis); Anleitungslisten über `brickset.com/ajax/sets/instructions` | gelesen 2026-10-14/15 | nur verlinkt | nein |
| LEGO-Bauanleitung 21002, PDFs [4580898](https://www.lego.com/cdn/product-assets/product.bi.core.pdf/4580898.pdf), [4644793](https://www.lego.com/cdn/product-assets/product.bi.core.pdf/4644793.pdf), [4656136](https://www.lego.com/cdn/product-assets/product.bi.core.pdf/4656136.pdf) | Abgleich der Baufolge, Teileliste mit Element-IDs (Auftrag 02B) | 2026-10-15, nur im temporären Arbeitsordner gelesen; SHA-256 in `data/references/sequences/21002-1.instructions.json` | © LEGO – **nicht mitgeliefert**, nur verlinkt; im Repository steht nur die eigene Schrittzuordnung | Zuordnung: ja; PDFs: nein |
| LEGO-Anleitungsseiten [40013](https://www.lego.com/de-de/service/building-instructions/40013), [1869](https://www.lego.com/de-de/service/building-instructions/1869) | Suche nach Herstelleranleitung | 2026-10-15 | kein Eintrag vorhanden | nein |
| Rebrickable `elements.csv` (lokal, privat) | Auflösung der LEGO-Element-IDs der 21002-Teileliste auf Teilenummern (u. a. 4155708 → 3794b, 416226 → 4162 schwarz) | Stand 2026-10-14 | Rohdaten privat; nur die Einzelergebnisse sind in der Doku zitiert | nein |
| [LEGO: Sicher spielen mit DUPLO](https://www.lego.com/de-de/preschool/article/play-safe-with-lego-duplo) | Altersgrenze und Kleinteile-Regel | gelesen | Herstellerinformation: DUPLO ab 18 Monaten, Warnung vor verschluckbaren Kleinteilen | nein |
| [BrickLink Studio: Collision](https://studiohelp.bricklink.com/hc/en-us/articles/5412820155927-Collision), [Stability check](https://studiohelp.bricklink.com/hc/en-us/articles/6501498505111-Stability-check) | Vergleich der Grenzen bestehender Werkzeuge | gelesen | – | nein |
| [BrickLink Store API](https://www.bricklink.com/v2/api/welcome.page) | als späterer Provider vorgemerkt | nicht integriert | Zugangsdaten nötig | nein |

## Eigene Daten

| Datei | Inhalt | Herkunft / Prüfstatus |
|---|---|---|
| `src/core/connectivity/partMeta.ts` | Anschlusspunkte, Körper, nicht unterstützte Merkmale je Teil (`part-meta@1.0.0`) | parametrisch; gegen LDraw-Primitive abgeglichen (Test) |
| `src/core/connectivity/rules.ts` | Anschlussregeln (`connect-rules@1.0.0`) | eigene Festlegung; implementiert sind nur Noppe↔Aufnahme und Noppe↔Röhre |
| `data/catalog/id-map.json` | LDraw → Rebrickable | 22 × gleiche Nummer (Bezeichnungen verglichen), 1 × manuell begründet (4162p0b → 4162pr0068) |
| `data/references/references.json` | Referenzmetadaten | aus den genannten Quellen; Abweichungen zwischen Quellen dokumentiert |
| `data/expectations/edge-cases.json` | Erwartungen mit Begründungen | eigene Festlegung, unabhängig vom Validator formuliert |
| `src/fixtures/*` | Grenzfälle, Fehlervarianten | **synthetisch** – nie als Referenz oder Katalognachweis verwenden |
