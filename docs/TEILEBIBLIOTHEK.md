# Teilebibliothek (Auftrag 05C.1)

Allgemeine Teile- und Anschlussbibliothek als Grundlage des Bild-zu-LEGO-Konstrukteurs. Der Umfang ist allgemein (Gebäude, Fahrzeuge, Türme …); Technic-Mechanik ist ausgenommen. Stand: 2026-10-23, korrigiert mit Auftrag 05C.1.1 (Abschnitt 9).

## 1. Ausgangslage

- **Basis:** `feature/general-parts-library` zweigt von `feature/hollow-cockpit-05b2` (`feba952`, Zwischenstand 05B.2) ab. Der Grund: Die Bibliothek baut auf der dortigen Infrastruktur auf (konvexe Hüllkörper, Funktionsschicht, Belegformat `evidence-05b2.json`, Teil-Metadaten `part-meta@1.3.0`). Der PR geht daher gegen diesen Zweig.
- **Bisher nutzbare Teile im Konstrukteur:** die 41 Teile mit handgepflegten, gegen LDraw geprüften Teil-Metadaten (`src/core/connectivity/partMeta.ts`). Die Bautechniken wählen daraus feste Paletten (`bowTechnique.ts`, `cockpitTechnique.ts`).
- **Bisher von Hand eingetragen:**
  - Anschlusspunkte je Teil, Körperprismen und Hüllkörper, Formangaben (Neigung, Keilform);
  - Paletten und Farbwahl der Bautechniken;
  - die LDraw-Wurzelliste (`data/ldraw/roots.json`, 176 Dateien);
  - die ID-Zuordnung LDraw → Rebrickable (`id-map.json`, 23 Einträge);
  - die Beschaffungsbelege 05B.2 (27 Zeilen).
- **Erhalten:** private Katalogdaten (`data-raw/`, `rebrickable-extract.json`), Schlüssel, lokale Entwürfe (auch „arrakis raumschiff 1“) und der 05B.2-Zwischenstand. Nichts davon wurde verändert.

## 2. Übernahmeprüfung – ausgeführte Versuche

Alle Versuche liefen auf den tatsächlich geladenen Paketen. Heruntergeladener Code wurde nie ausgeführt; Python lief mit `-I` und nur auf Daten.

| Quelle | Inhalt / Format | Versuch und Ergebnis | Lizenz | Entscheidung |
|---|---|---|---|---|
| **LDraw** `complete.zip` (2026-09, 146 MB) | 24 856 Dateien in `parts/`, 9 266 Unterteile, 2 844 Primitive; LDraw-Text | Kopfzeilen aller Dateien gelesen: 9 112 Teile, 8 756 Drucke/Aufkleberteile, 2 595 Kurzformen, 1 161 Umbenennungen, 497 Aliase, 2 735 versteckte Teile. Geometrie aller Teile rekursiv ausgewertet (Hülle, Flächenrichtungen). | CC BY 4.0 | **übernommen:** Katalogidentität, Geometrie, Kennwerte |
| **LDCad Shadow Library** (Commit `9b1131f`) | 4 198 Teil-Patches und 87 Primitive mit `!LDCAD SNAP_*`-Metazeilen | SNAP-Typen gezählt (CYL 6 734, INCL 506, FGR 335, CLEAR 332, GEN 328, CLP 160). Neun Rasterformate gefunden. Die Vererbung über Unterdateien und Primitive (`stud.dat` → Noppe) ist implementiert; die Ergebnisse für 3001, 3039, 2437, 3747b, 99781 wurden geprüft. | CC BY-SA 4.0 | **übernommen:** Anschlüsse (eigene Datei). Spiegel-Informationen nicht übernommen |
| **BrickNet** (Commit `283faf7`, Katalog v1) | `labels.json.xz` (14 603 Teile, Zeilen `[x,y,z,Neigung,Rollen,…]`), `part_aliases.json.xz` | Formate aus `DATA.md` und `data.py` nachvollzogen und den Achsenrahmen nachgerechnet. Stichprobe 3001/3004/3039/2437/3747b deckt sich mit dem Prüfkern. | MIT | **übernommen:** Anschlüsse (eigene Datei) und Umbenennungen bei gleicher Geometrie. **Nicht übernommen:** Python-Code (numpy/torch, Trainingsumgebung), Kollisionsnetze `inset.tar.xz` (369 MB, später prüfen), Datensätze hinter dem Anfrageformular |
| **Rebrickable** (lokale Dumps) | Teile, Beziehungen, Farben, Elemente, Set-Inventare | Zuordnung zu LDraw: gleiche Nummer, LDraw-Umbenennung oder Rebrickable-Beziehung; Farbbelege für 5 051 LDraw-Teile | ungeklärt | **nur lokal:** Farbbelege und Referenzmenge (`data/library/private/`) |

Bewertet wurden Abdeckung, Format, Version, Lizenz und Einbindungsaufwand. Die Anschlussdaten stammen aus zwei unabhängig erstellten Quellen und werden getrennt geführt. So bleiben Widersprüche sichtbar, statt dass eine Quelle die andere überschreibt.

## 3. Persistente Bibliothek

| Schritt | Befehl | Ergebnis |
|---|---|---|
| Quellen holen | `npm run library:fetch` | lädt nach `data-cache/` (oder in den Ordner aus `LIBRARY_CACHE`) und prüft den **Inhalts-Prüfwert** jeder Quelle gegen `data/library/sources.json` |
| Neue Version übernehmen | `npm run library:fetch -- --update` | lädt immer neu, auch wenn ein Archiv im Zwischenspeicher liegt; schreibt neuen Prüfwert und neue Prüfsumme ins Register |
| Festgelegten LDraw-Stand wiederherstellen | automatisch, wenn `complete.zip` inzwischen einen anderen Stand liefert; Probe: `python -I scripts/library/fetch.py --reconstruct` | Grundstand aus dem Webarchiv + versionierte LDraw-Monats-Updates + Korrekturen, geprüft gegen den Prüfwert |
| Importieren | `npm run library:import` | erzeugt die Indizes (deterministisch, ca. 6–7 Minuten) |

**Inhalts-Prüfwert:**
- Maßgeblich ist SHA-256 über die sortierte Liste „Pfad, SHA-256 des Inhalts“ aller Dateien im Umfang (bei LDraw `parts/` und `p/`).
- Die Archiv-Prüfsumme wird nur noch mitgeführt. Ein neu gepacktes Archiv mit gleichem Inhalt wird deshalb angenommen, ein anderer Inhalt nie stillschweigend.
- Der Import prüft den Prüfwert des entpackten Stands erneut, bevor er ihn liest.

**Wiederherstellung des festgelegten LDraw-Stands 2026-09.** LDraw ersetzt `complete.zip` mit jedem Release, die URL allein reicht also nicht. Das Rezept in `sources.json`:
- **Grundstand:** `complete.zip` vom 2025-12-04 aus dem Internet Archive, Prüfsumme festgehalten.
- **Updates:** die zehn versionierten Archive `lcad2512.zip` … `lcad2609.zip` von library.ldraw.org, je Prüfsumme festgehalten.
- **Korrekturen:** eine gelöschte Datei (`parts/s/41770s01.dat`) und zwei Dateien, die LDraw außerhalb der Updates geändert hat (`24201d00.dat`, `24201d01.dat`). Letztere liegen in `data/library/ldraw-overrides/` (CC BY 4.0).
- **Probe:** am 2026-10-23 mit frischem Download ausgeführt. Ergebnis: 37 104 Dateien, Prüfwert identisch, 214 s.

**Zwischenspeicher:**
- Jeder Stand wird in einen neuen Ordner geschrieben und erst fertig gegen den alten getauscht. So hinterlässt ein Abbruch keinen halben Stand.
- `data-cache/` liegt hier im OneDrive-Ordner. Beim Löschen hielt die Synchronisation Dateien fest, und ein erster Wiederherstellungslauf brach deshalb ab.
- Empfehlung: `LIBRARY_CACHE` auf einen nicht synchronisierten Ordner setzen oder `data-cache/` von der Synchronisation ausnehmen.

Erzeugte Dateien, je Quelle und Lizenz getrennt (Lizenzhinweise: `data/library/LIZENZEN.md`):

| Datei | Inhalt | Größe |
|---|---|---|
| `parts.json` | je LDraw-Datei: Titel, Art, Umbenennungsziel, Grundteil (bei Drucken), Kategorie, Schlüsselwörter, Lizenz, Update. Für Teile und Kurzformen zusätzlich Körper-Hüllquader und Flächenkennwerte | 5,8 MB |
| `connectors-ldcad.json` | 7 543 Teile, je Anschluss Klasse, Rohform, Position, Steckachse | 4,4 MB |
| `connectors-bricknet.json` | 7 017 Teile, gleiches Zeilenformat | 4,5 MB |
| `build-info.json` | Quellenversionen, Prüfsummen der Ausgaben (per Test geprüft), Zählungen | – |
| `ldraw-overrides/` | zwei LDraw-Dateien für die Wiederherstellung (siehe oben) | 1 KB |
| `private/rebrickable-colors.json` | **nur lokal**: Farbbelege mit Herkunft, Rebrickable-Zuordnung, Referenzmenge mit Gewichten (Schema `@2`) | – |

**Druckvarianten:**
- Sie bleiben eigene Einträge mit eigener LDraw-Datei und Verweis `pr` auf das Grundteil.
- Kennwerte, Anschlüsse und Unterstützung des Grundteils werden nicht übertragen.
- Gemeinsame Geometrie gibt es nur dort, wo BrickNet „gleicher Titel und gleiche Geometrie“ festgestellt hat (`same`, nur reine Umbenennungen).

**Geometrie im Browser:**
- Der Entwicklungsserver liefert die LDraw-Dateien bei Bedarf aus dem Quellpaket (`/library-geometry/`).
- Vorschaubilder werden neutral grau gerendert und belegen keine Farbe.
- Ohne Quellpaket (frischer Checkout, öffentlicher Build) zeigt die Oberfläche „Geometrie nicht lokal verfügbar“; Suche und Abdeckung funktionieren trotzdem.

## 4. Getrennte Angaben je Teil

| Ebene | Quelle | Wenn unbekannt |
|---|---|---|
| Katalogidentität und Zuordnung | LDraw-Kopf, Umbenennungen und Aliase, BrickNet-Gleichheit, Rebrickable (lokal) | „keine Zuordnung“ |
| Geometrie, Maße, Kategorie, Suchmerkmale | LDraw-Geometrie | „unbekannt“; Hülle bei schiefen Drehungen „genähert“ |
| Farbbelege und Transparenz | Set-Inventare (lokal) | keine Farbe gilt als belegt |
| Anschlüsse mit Herkunft | LDCad bzw. BrickNet, je Anschluss mit Rohform | „keine Daten – weder verbindbar noch unverbindbar“ |
| Unterstützungsgrad | **Aussage des Prüfkerns selbst** (`Catalog.part(id).simulation`, gleiche Identitätsauflösung wie die Modellprüfung), sonst Datenlage | prüfbar / teilweise prüfbar / Anschlüsse importiert / nur Geometrie / Geometrie unvollständig / nicht einzeln geführt; ohne Prüfkern-Anbindung nie „prüfbar“ |
| Beschaffung (Zeit, Menge) | Belegdateien (bisher 05B.2) | „kein Beleg – unbekannt gilt als nicht verfügbar“ |

Abgeleitete Aussagen sind dreiwertig plus „widersprüchlich“: Melden die Quellen verschiedene Ergebnisse, steht das so da.

**Farbbelege** (`scripts/library/rebrickable.py`, synthetisch geprüft mit `tests/fixtures/rebrickable-mini`):

*Zuordnung Rebrickable → LDraw.* Nur drei Gründe begründen eine Identität:
- gleiche Nummer;
- LDraw-Schlüsselwort „Rebrickable <Nummer>“;
- nachgewiesene LDraw-Umbenennung („~Moved to“, Alias).

Führen sie auf verschiedene LDraw-Teile, ist die Zuordnung **mehrdeutig**, und es gibt keine Farbbelege. Bei echten Daten betrifft das 761 Rebrickable-Teile, meist eine Nummer für mehrere LDraw-Formvarianten. Rebrickable-Beziehungen „Alternative“ und „Formvariante“ werden je Teil genannt, belegen aber **keine** Farben des Zielteils.

*Zählung:*
- Je Set zählt nur die neueste Inventarversion; Ersatzteile und Minifiguren-Inventare zählen nicht.
- Je Teil und Farbe zählen eindeutige Sets. Belege mehrerer Rebrickable-Teile werden als Set-Vereinigung gezählt.
- Die Herkunft (Rebrickable-Teil und Grund) bleibt je Beleg erhalten.

*Abgrenzung:* Druckfarben belegen nicht das unbedruckte Grundteil. Ein Farbbeleg zeigt Existenz in einem Set-Inventar, keine Kaufverfügbarkeit; die steht nur unter „Beschaffung“.

**Datenlader** (`src/core/library/load.ts`):
- Jede Datei wird einzeln geladen und zur Laufzeit gegen ihre Datenform geprüft.
- Zustände: geladen, fehlt (404 oder HTML statt Daten), beschädigt (kein JSON oder falsche Form, mit Ort), nicht erreichbar (Netzwerk- oder Serverfehler).
- Die Oberfläche zeigt Datei und Grund. Nur ein fehlender oder beschädigter Teile-Index verhindert die Bibliothek; ein beschädigter optionaler Farbkatalog erscheint als „beschädigt“ und blockiert nichts.

## 5. Teilesuche

Oberfläche: Bereich „Teilebibliothek“. Kern: `src/core/library/search.ts`. Suchbar sind Text, Katalogfamilie, Eigenschaften und Höchstmaß.

- **Katalogfamilien** (aus LDraw-Kategorie und Titel): Fliese, Schrägstein, Eck-Schrägstein, gewölbte und inverse Schräge, Keil, Bogen, rund, Fenster/Glas/Kanzel, Paneel, Winkel, Noppen seitlich, Eckteil, Scharnier/Clip, Stange.
- **Gemessene Eigenschaften:**
  - aus der Geometrie: geneigt, Neigung in zwei Richtungen, gekrümmt, runde senkrechte Wand, schräge Kante;
  - aus den Anschlussdaten: keine Noppe oben, Noppen zur Seite, Aufnahme zur Seite;
  - aus den Farbbelegen: transparent belegt.
- **Vermutete Verwendungen** sind getrennt aufgeführt und als Vermutung gekennzeichnet.
- **Messverfahren:** Die Flächen werden nach Normalenrichtung gebündelt. Gezählt werden nur außenliegende Flächen (Stützebenen der Hülle); Röhren und Rippen innen zählen nicht. Viele Richtungen gleicher Neigung oder gleicher Himmelsrichtung ergeben „gekrümmt“, eine einzelne große Richtung ergibt „eben geneigt“.

Suchaufgaben aus dem Auftrag (mit lokalen Farbbelegen; Reihenfolge nach Prüfbarkeit und Verbreitung):

| Aufgabe | Anfrage | Treffer | erste Kandidaten |
|---|---|---|---|
| glatte, geneigte Ecke | geneigt + zwei Neigungsrichtungen + keine Noppe oben | 57 (42 unentschieden) | 96910, 15571, 22388, 35464, 3044c, 3049d, 3043, 3300 |
| runde Wand | runde senkrechte Wand | 494 | 6141, 98138, 4032a, 3062b, 85861, 35480, 14769 |
| Fensteröffnung | Familie Fenster/Glas/Kanzel | 539 | 2437, 60596, 60592, 60594, 60601, 60593 |
| seitlich angesetzte Platte | Noppen zur Seite | 82 (18 unentschieden) | 99780, 11211, 87087, 99207, 44728, 99781, 4070 |

Die Reihenfolge innerhalb der Treffer hat sich mit der korrigierten Gewichtung leicht verschoben; die Treffermengen sind unverändert.

„Unentschieden“ heißt: Für diese Teile fehlen Anschlussdaten oder die Quellen widersprechen sich. Sie fallen nicht als „hat die Eigenschaft nicht“ heraus.

## 6. Abdeckungsbericht

**Referenzmengen:**
- **A, LDraw-Systemteile (öffentlich):** LDraw-Dateien vom Typ „Part“, ohne Drucke, Umbenennungen, Aliase, versteckte Unterteile, Minifiguren, Technic, Duplo, Figuren/Tiere und Fremdsysteme. Alle sind zugeordnet.
- **B, in Sets ab 2016 verwendet (lokal):**
  - Basis: Grundteile aus Rebrickable-Set-Inventaren (neueste Inventarversion, ohne Ersatzteile); Drucke auf das Grundteil gefaltet; ausgeschlossen sind die Kategorien wie bei A sowie Schläuche und Schnüre.
  - Gewicht: Anzahl **eindeutiger** Sets ab 2016, in denen das Grundteil vorkommt. Farben, Drucke und Inventarversionen zählen ein Set nicht mehrfach.
  - Umfang: 13 954 Sets ab 2016 bei 28 512 Sets insgesamt.

**Zwei Bezugsgrößen je Ebene:** Der *Gesamtbestand* schließt Teile ohne eindeutige LDraw-Zuordnung ein; sie gelten dort als nicht abgedeckt, und ihr Gewicht bleibt erhalten. *Innerhalb zugeordnet* bezieht sich nur auf zugeordnete Teile.

| Ebene | A (3 302 Teile) | B am Gesamtbestand (2 554 Teile, Gewicht 423 735) | B innerhalb zugeordnet (1 723 Teile, Gewicht 409 392) |
|---|---|---|---|
| Katalog: eindeutig einer LDraw-Datei zugeordnet | 100 % | 1 723 (67,5 %; gew. 96,6 %) | – |
| Geometrie vollständig | 100 % | 1 688 (66,1 %; gew. 96,6 %) | 98,0 % (gew. 100,0 %) |
| Anschlüsse LDCad | 2 718 (82,3 %) | 1 513 (59,2 %; gew. 95,2 %) | 87,8 % (gew. 98,5 %) |
| Anschlüsse BrickNet | 2 696 (81,6 %) | 1 590 (62,3 %; gew. 95,7 %) | 92,3 % (gew. 99,0 %) |
| Anschlüsse aus mindestens einer Quelle | 2 954 (89,5 %) | 1 644 (64,4 %; gew. 96,3 %) | 95,4 % (gew. 99,7 %) |
| aus beiden Quellen | 2 460 (74,5 %) | 1 459 (57,1 %; gew. 94,5 %) | 84,7 % (gew. 97,9 %) |
| beide einig (Noppen oben, Aufnahmen unten) | 1 715 (51,9 %) | 1 016 (39,8 %; gew. 79,1 %) | 59,0 % (gew. 81,9 %) |
| Verbindungen prüfbar (laut Prüfkern) | 39 (1,2 %) | 35 (1,4 %; gew. 16,3 %) | 2,0 % (gew. 16,9 %) |

Die 35 Teile aus B ohne vollständige Geometrie (Gewicht 187) sind Teile, die Rebrickable als Grundteil führt, LDraw aber nur als Druckdatei. Für Druckdateien werden bewusst keine Kennwerte berechnet.

**Abgleich mit dem Prüfkern** (alle 41 Teile mit geprüften Metadaten; `crosscheckWithPartMeta`):
- **Umfang:** Verglichen werden Positionen für Noppen oben, seitlich, Aufnahmen unten, Röhren und Unterseitenstifte.
- **Treffer:** LDCad stimmt in 71 von 75 Vergleichen überein, BrickNet in 86 von 95. Noppen oben stimmen ausnahmslos.
- **Umbenennung:** Die Prüfkern-Nummer 3023 heißt in LDraw 2026-09 „~Moved to 3023b“. Seit 05C.1.1 gilt das auch im Prüfkern: Ein Modell mit 3023b wird geprüft (Abschnitt 9). Der Druck 4162p0b hat in keiner Quelle Anschlüsse.

Abweichungen (bewusst **nicht** in den Prüfkern übernommen; per Test festgehalten):

| Teil | Art | Prüfkern | LDCad | BrickNet | Einordnung |
|---|---|---|---|---|---|
| 41767/41768 (Keilsteine) | Aufnahmen unten | 5 | 6 | 6 | Der Prüfkern lässt die Aufnahme an der schrägen Kante weg (Zylinder ragt 3,5 LDU über die Kante). Beide Quellen werten sie als Aufnahme; ob sie physisch hält, ist offen. Der Prüfkern bleibt strenger. |
| 43722a/43723a (Keilplatten) | Aufnahmen unten | 4 | 0 | keine Daten | LDCad-Lücke: Die Unterseite hat keine SNAP-Angaben. |
| 3065, 3069b, 3066 | Aufnahmen unten | 2 / 2 / 4 | stimmt | 3 / 3 / 7 | BrickNet zählt Zwischenpositionen ohne Röhre (halber Versatz) als Aufnahme; der Prüfkern hat dafür keine Regel. |
| 3039, 3298, 41767, 41768 | Röhren | 0 | nicht modelliert | 1–2 | Der Prüfkern führt die verkürzten Röhren der Schrägen (stud4a) bewusst nicht als Anschluss. Folge: Versatzverbindungen dort bleiben „ungeprüft“. |

Von den 1 459 Teilen aus B mit Daten aus beiden Quellen sind sich die Quellen bei 443 nicht einig. Stichproben zeigen dieselben Muster wie im Prüfkern-Abgleich: BrickNet zählt Zwischenpositionen ohne Röhre als Aufnahme, LDCad lässt Unterseiten teils ohne Angaben (43722a). Eine vollständige Klassifikation der Widersprüche steht noch aus.

**Verbleibende Lücken:**
1. 831 Grundteile aus B (Gewicht 14 343, 3,4 %) haben keine eindeutige LDraw-Zuordnung. Gründe: keine LDraw-Datei, abweichende Nummern, mehrdeutige Querverweise. Eine Bestätigung über externe IDs fehlt, weil kein API-Schlüssel vorhanden ist.
2. 79 zugeordnete Teile aus B haben keine Anschlussdaten; bei 443 widersprechen sich die beiden Quellen.
3. Nur 35 Teile aus B sind prüfbar, gewichtet 16,9 % des zugeordneten Bestands. Importierte Anschlüsse sind Suchhinweise, kein Prüfumfang.
4. Clips, Stangen, Scharniere und Technic sind importiert, aber ohne Regeln im Prüfkern.
5. Die Körper-Hüllquader enthalten keine Anschluss-Primitive. Beispiel: Bei 3062a ist der untere Ring `stud4a.dat`, die Hülle wird deshalb 20 statt 24 LDU hoch.
6. Farbbelege gibt es nur lokal. Ohne sie sind „transparent“ und alle Farben unbekannt.
7. Vorschaubilder gibt es nur im Entwicklungsserver mit Quellpaket.
8. Die Wiederherstellung hängt von zwei externen Archiven ab (Internet Archive, LDraw-Update-Archive). Fallen beide weg, bleibt nur ein eigener Spiegel; der ist nicht eingerichtet.

## 7. Bestehendes System

- **Frischer Checkout ohne private Daten:** Suche, Abdeckung (Referenzmenge A), Tests und Build laufen; geprüft mit einem frischen Klon (siehe Abschlussbericht).
- **Private Daten:**
  - `data/library/private/` und `data-cache/` sind git-ignoriert.
  - Sie stehen nicht in der Positivliste.
  - `check-public-build.mjs` weist sie unter jedem Pfad und an jedem Schema `library-rebrickable-private@…` ab (Testfälle in `tests/public-build.test.ts`).
- **Unverändert:**
  - Teil-Metadaten, Regeln, Validator, Bautechniken, Anleitung und Exporte;
  - die Bibliothek ersetzt keine Prüfung.
  - Die Prüfkern-Erwartungen bleiben strenger, wo die Quellen großzügiger sind.
- **Entwicklungsserver:** `data-cache/` und `data-raw/` sind vom Dateiwächter ausgenommen. Mit rund 37 000 überwachten Dateien dauerte zuvor jede Anfrage etwa 2 s.

## 8. Empfehlung für 05C.2 „Bauwissen aus digitalen Modellen“

1. **Quelle zuerst klären, dann auswerten.**
   - Am einfachsten verfügbar sind die offiziellen LDraw-OMR-Modelle (CC BY 2.0, Parser vorhanden; drei sind bereits Referenzen).
   - Die BrickNet-Graphen (253 623 Modelle, 125 Mio. Verbindungen) wären die größte Quelle. Sie liegen aber hinter einem Anfrageformular, und ihre Lizenz ist nicht angegeben. Eine Anfrage nur nach Rückfrage bei Ihnen.
2. **Verbindungen aus Modellen ableiten**, mit den jetzt vorhandenen Anschlussdaten:
   - Welche Teile werden wie verbunden: Noppe auf Röhre, halber Versatz, seitlich, Eckverbände.
   - Häufigkeit je Teilepaar und je Muster, mit Modellherkunft.
   - Jedes Muster wird gegen beide Anschlussquellen und, wo vorhanden, gegen den Prüfkern gestellt.
3. **Widersprüche zwischen LDCad und BrickNet an echten Modellen entscheiden.** Kommt z. B. der halbe Versatz unter 3065 in Herstellermodellen vor? Wenn ja, wird er als belegte Regel mit Geltungsbereich geführt, wie R-UPIN-HOLLOWSTUD.
4. **Prüfkern gezielt erweitern:**
   - die meistverwendeten Teile ohne Prüfkern-Unterstützung (gewichtet nach Referenzmenge B) halbautomatisch aus Geometrie und Anschlussdaten vorschlagen;
   - Aufnahme in `partMeta` erst nach dem bestehenden Abgleich gegen LDraw.
   - Ziel: gewichtete Prüfbarkeit deutlich über die korrigierten 16,9 %.

## 9. Korrekturen aus Auftrag 05C.1.1 – Nachweise

Jeder Fehler wurde zuerst reproduziert und dann behoben; die Tests laufen ohne private Daten.

**Farbbelege übertragen über Alternativen** (Fehler bis `2d365b2`):
- *Reproduktion:* der alte Code auf den synthetischen CSV-Daten `tests/fixtures/rebrickable-mini`. Ergebnis:
  - 3794a erhielt Grün vom Rebrickable-Teil `alt9`, das nur als Alternative verknüpft ist;
  - 3001 erhielt Schwarz aus einer veralteten Inventarversion;
  - 3001 wurde mit 5 statt 2 Sets gewichtet;
  - die Mehrdeutigkeit von `amb` blieb unerkannt;
  - nicht zugeordnete Teile hatten kein Gewicht.
- *Behebung:* `scripts/library/rebrickable.py`.
- *Test:* `tests/library-rebrickable-rules.test.ts`, 13 Fälle mit von Hand hergeleiteten Zahlen.
- *Echte Daten:* 3794a trägt nur noch eigene Farben (letzte Sets 2014); 15573 und 3794b sind als Alternativen genannt.

**3023b: Bibliothek „prüfbar“, Prüfkern „unsupported“:**
- *Reproduktion:* `catalog.part('3023b').simulation` war „unsupported“, während die Bibliothek 3023b über eine eigene ID-Liste als prüfbar zeigte.
- *Behebung:* gemeinsame Identitätsauflösung (`identity.ts`) im Katalog des Prüfkerns; die Bibliothek fragt den Prüfkern.
- *Test:* `tests/library-validator-path.test.ts`.
  - Platte 3023b auf 3001 wird in der Modellprüfung verbunden und erzeugt keinen Befund „nicht unterstützt“.
  - Jedes als prüfbar angezeigte Teil führt der Prüfkern als unterstützt.
  - Ohne Prüfkern-Anbindung erscheint nie „prüfbar“.
- *Folge:* Prüfbar sind 35 statt 39 Teile der Referenzmenge B. Die bisherige Zählung hatte Prüfkern-Nummern über Umbenennungen und Drucke hinweg gezählt.

**Abdeckung und Gewichtung:**
- Gesamtbestand und zugeordneter Bestand stehen jetzt getrennt (Abschnitt 6). Die Gewichte zählen eindeutige Sets (neueste Inventarversion), auch für nicht zugeordnete Teile.
- *Test:* `tests/library-load-coverage.test.ts`, eine von Hand nachrechenbare Mini-Bibliothek.
- *Folge:* Die gewichtete Prüfbarkeit sinkt von berichteten 24,0 % auf **16,9 %** des zugeordneten bzw. **16,3 %** des Gesamtbestands. Die alte Zahl war durch Mehrfachzählung über Farben, Drucke und Inventarversionen überhöht.

**Datenlader:**
- Zuvor erschien ein beschädigter optionaler Katalog als „fehlt“, oder er hätte eine Ausnahme ausgelöst.
- Jetzt: Laufzeitprüfung je Datei; die Zustände fehlt, beschädigt und nicht erreichbar werden unterschieden, mit Datei und Grund.
- *Tests:* 7 Fälle in `tests/library-load-coverage.test.ts`.
- *Im Browser geprüft:* Ein absichtlich zerstörter Farbkatalog wurde als „beschädigt – kein gültiges JSON“ angezeigt, und die Suche lief weiter. Die Originaldatei ist wiederhergestellt; die Prüfsumme ist identisch.

**Linux-Abweichung bei u9200** (f.cv 0,095 → 0,096; f.in 0,261 → 0,260):
- *Ursache:* `x ** 2` ruft `pow()` der C-Bibliothek auf. Unter Windows (MSVC) ist `pow(x, 2)` nicht korrekt gerundet, gemessen in 1 063 von 2 000 000 Zufallswerten ≠ `x * x`. glibc unter Linux rundet korrekt.
- *Behebung:* Nur noch korrekt gerundete Operationen; Kreisfunktionen entfernt. Danach erzeugt Windows genau die Linux-Bytes: `parts.json` SHA-256 beginnt mit `F005261941DCF50D`. Die einzige Änderung gegenüber dem bisherigen Windows-Stand ist u9200 mit den Linux-Werten.
- *Absicherung:*
  - `tests/library-determinism.test.ts` hält die Regel fest;
  - `.github/workflows/library-reproducibility.yml` vergleicht Linux (Python 3.11 und 3.13) und Windows (Python 3.13) byte-genau mit den versionierten Dateien;
  - bei Abweichung nennt `scripts/library/compare.py` die betroffenen Teile.
- Die Prüfsummen wurden nicht angepasst, sondern sind das Ergebnis des korrigierten Imports.

**`--update` bei vorhandenem Zwischenspeicher:**
- Zuvor wurde nicht neu geladen, wenn ein Archiv mit der festgelegten Prüfsumme im Zwischenspeicher lag. Ein neuer Stand wurde so nie übernommen.
- Jetzt lädt `--update` immer neu.
- *Test:* `tests/library-fetch.test.ts` mit lokalen `file://`-Archiven; dazu ungeprüfter Stand, geänderter Inhalt ohne Rezept und neu gepacktes Archiv.

**Erneute Beschaffung der festgelegten LDraw-Version:** über das Wiederherstellungsrezept (Abschnitt 3), mit frischem Download geprüft.

**Weitere Funde unterwegs:**
- Die Import-Skripte brachen unter Windows bei umgeleiteter Ausgabe an Umlauten und Pfeilen ab (cp1252). Sie geben jetzt immer UTF-8 aus.
- Die Wiederherstellung öffnete das 136-MB-Archiv für jede Datei neu (`setdefault` wertet sein Argument immer aus). Behoben, Laufzeit 214 s.
- OneDrive blockierte das Löschen im Zwischenspeicher. Deshalb gibt es jetzt den atomaren Ordnertausch und `LIBRARY_CACHE`.
