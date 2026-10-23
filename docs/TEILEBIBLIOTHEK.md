# Teilebibliothek (Auftrag 05C.1)

Allgemeine Teile- und Anschlussbibliothek als Grundlage des Bild-zu-LEGO-Konstrukteurs. Der Umfang ist allgemein (Gebäude, Fahrzeuge, Türme …); Technic-Mechanik ist ausgenommen. Stand: 2026-10-23.

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
| Quellen holen | `npm run library:fetch` | lädt nach `data-cache/` (git-ignoriert) und prüft SHA-256 gegen `data/library/sources.json`. Bei Abweichung bricht es ab; neue Version nur mit `npm run library:fetch -- --update` |
| Importieren | `npm run library:import` | erzeugt die Indizes (deterministisch, ca. 6 Minuten); zwei Läufe ergeben byte-identische Dateien |

Erzeugte Dateien, je Quelle und Lizenz getrennt (Lizenzhinweise: `data/library/LIZENZEN.md`):

| Datei | Inhalt | Größe |
|---|---|---|
| `parts.json` | je LDraw-Datei: Titel, Art, Umbenennungsziel, Grundteil (bei Drucken), Kategorie, Schlüsselwörter, Lizenz, Update. Für Teile und Kurzformen zusätzlich Körper-Hüllquader und Flächenkennwerte | 5,8 MB |
| `connectors-ldcad.json` | 7 543 Teile, je Anschluss Klasse, Rohform, Position, Steckachse | 4,4 MB |
| `connectors-bricknet.json` | 7 017 Teile, gleiches Zeilenformat | 4,5 MB |
| `build-info.json` | Quellenversionen, Prüfsummen der Ausgaben (per Test geprüft), Zählungen | – |
| `private/rebrickable-colors.json` | **nur lokal**: Farbbelege, Rebrickable-Zuordnung, Referenzmenge | – |

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
| Unterstützungsgrad | Prüfkern-Metadaten bzw. Datenlage | prüfbar / Anschlüsse importiert / nur Geometrie / Geometrie unvollständig / nicht einzeln geführt |
| Beschaffung (Zeit, Menge) | Belegdateien (bisher 05B.2) | „kein Beleg – unbekannt gilt als nicht verfügbar“ |

Abgeleitete Aussagen sind dreiwertig plus „widersprüchlich“: Melden die Quellen verschiedene Ergebnisse, steht das so da.

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
| glatte, geneigte Ecke | geneigt + zwei Neigungsrichtungen + keine Noppe oben | 57 (42 unentschieden) | 15571, 22388, 35464, 3044c, 3049d, 3043, 3300 |
| runde Wand | runde senkrechte Wand | 494 | 6141, 98138, 3062b, 4032a, 85861, 35480, 3941 |
| Fensteröffnung | Familie Fenster/Glas/Kanzel | 539 | 2437, 60596, 60592, 60594, 60601, 60593 |
| seitlich angesetzte Platte | Noppen zur Seite | 82 (18 unentschieden) | 87087, 11211, 99780, 99207, 44728, 4070, 99781 |

„Unentschieden“ heißt: Für diese Teile fehlen Anschlussdaten oder die Quellen widersprechen sich. Sie fallen nicht als „hat die Eigenschaft nicht“ heraus.

## 6. Abdeckungsbericht

**Referenzmengen:**
- **A, LDraw-Systemteile (öffentlich):** LDraw-Dateien vom Typ „Part“, ohne Drucke, Umbenennungen, Aliase, versteckte Unterteile, Minifiguren, Technic, Duplo, Figuren/Tiere und Fremdsysteme.
- **B, in Sets ab 2016 verwendet (lokal):** Teile aus Rebrickable-Set-Inventaren ohne Ersatzteile. Drucke werden auf das Grundteil gefaltet. Ausgeschlossen sind dieselben Kategorien wie bei A sowie Schläuche und Schnüre. Gewichtet nach Anzahl der Sets.

| Ebene | A: LDraw-Systemteile (3 302) | B: Sets ab 2016 (1 710 zugeordnet + 803 ohne LDraw) |
|---|---|---|
| Katalog: LDraw-Datei zugeordnet | 3 302 / 3 302 | 1 690 / 2 513 (67 %) |
| Geometrie vollständig | 3 302 (100 %) | 1 690 / 1 710 (98,8 %; gewichtet 99,2 %) |
| Anschlüsse LDCad | 2 718 (82,3 %) | 1 507 (88,1 %; gew. 98,2 %) |
| Anschlüsse BrickNet | 2 696 (81,6 %) | 1 584 (92,6 %; gew. 97,8 %) |
| Anschlüsse aus mindestens einer Quelle | 2 954 (89,5 %) | 1 642 (96,0 %; gew. 99,0 %) |
| aus beiden Quellen | 2 460 (74,5 %) | 1 449 (84,7 %; gew. 97,0 %) |
| beide einig (Noppen oben, Aufnahmen unten) | 1 715 (51,9 %) | 1 015 (59,4 %; gew. 80,7 %) |
| Verbindungen bereits prüfbar (Prüfkern) | 39 (1,2 %) | 39 (2,3 %; gew. 24,0 %) |

**Abgleich mit dem Prüfkern** (alle 41 Teile mit geprüften Metadaten; `crosscheckWithPartMeta`):
- **Umfang:** Verglichen werden Positionen für Noppen oben, seitlich, Aufnahmen unten, Röhren und Unterseitenstifte.
- **Treffer:** LDCad stimmt in 71 von 75 Vergleichen überein, BrickNet in 86 von 95. Noppen oben stimmen ausnahmslos.
- **Umbenennung:** Die Prüfkern-Nummer 3023 heißt in LDraw 2026-09 „~Moved to 3023b“; abgeglichen wird über 3023b. Der Druck 4162p0b hat in keiner Quelle Anschlüsse.

Abweichungen (bewusst **nicht** in den Prüfkern übernommen; per Test festgehalten):

| Teil | Art | Prüfkern | LDCad | BrickNet | Einordnung |
|---|---|---|---|---|---|
| 41767/41768 (Keilsteine) | Aufnahmen unten | 5 | 6 | 6 | Der Prüfkern lässt die Aufnahme an der schrägen Kante weg (Zylinder ragt 3,5 LDU über die Kante). Beide Quellen werten sie als Aufnahme; ob sie physisch hält, ist offen. Der Prüfkern bleibt strenger. |
| 43722a/43723a (Keilplatten) | Aufnahmen unten | 4 | 0 | keine Daten | LDCad-Lücke: Die Unterseite hat keine SNAP-Angaben. |
| 3065, 3069b, 3066 | Aufnahmen unten | 2 / 2 / 4 | stimmt | 3 / 3 / 7 | BrickNet zählt Zwischenpositionen ohne Röhre (halber Versatz) als Aufnahme; der Prüfkern hat dafür keine Regel. |
| 3039, 3298, 41767, 41768 | Röhren | 0 | nicht modelliert | 1–2 | Der Prüfkern führt die verkürzten Röhren der Schrägen (stud4a) bewusst nicht als Anschluss. Folge: Versatzverbindungen dort bleiben „ungeprüft“. |

Von den 1 449 Teilen aus B mit Daten aus beiden Quellen sind sich die Quellen bei 434 nicht einig. Stichproben zeigen dieselben Muster wie im Prüfkern-Abgleich: BrickNet zählt Zwischenpositionen ohne Röhre als Aufnahme, LDCad lässt Unterseiten teils ohne Angaben (43722a). Eine vollständige Klassifikation der Widersprüche steht noch aus.

**Verbleibende Lücken:**
1. 803 Teile aus B haben keine LDraw-Zuordnung. Gründe: meist Drucke oder Folien ohne Rebrickable-Beziehung, neuere Teile ohne LDraw-Datei, abweichende Nummern. Eine Bestätigung über externe IDs fehlt, weil kein API-Schlüssel vorhanden ist.
2. 68 Teile aus B haben keine Anschlussdaten; bei 434 widersprechen sich die beiden Quellen.
3. Nur 39 Teile sind prüfbar. Importierte Anschlüsse sind Suchhinweise, kein Prüfumfang.
4. Clips, Stangen, Scharniere und Technic sind importiert, aber ohne Regeln im Prüfkern.
5. Die Körper-Hüllquader enthalten keine Anschluss-Primitive. Beispiel: Bei 3062a ist der untere Ring `stud4a.dat`, die Hülle wird deshalb 20 statt 24 LDU hoch.
6. Farbbelege gibt es nur lokal. Ohne sie sind „transparent“ und alle Farben unbekannt.
7. Vorschaubilder gibt es nur im Entwicklungsserver mit Quellpaket.

## 7. Bestehendes System

- **Frischer Checkout ohne private Daten:** Suche, Abdeckung (Referenzmenge A), Tests und Build laufen; geprüft mit einem frischen Klon (siehe Abschlussbericht).
- **Private Daten:**
  - `data/library/private/` und `data-cache/` sind git-ignoriert.
  - Sie stehen nicht in der Positivliste.
  - `check-public-build.mjs` weist sie unter jedem Pfad und am Schema `library-rebrickable-private@1` ab (neue Testfälle in `tests/public-build.test.ts`).
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
   - Ziel: gewichtete Prüfbarkeit deutlich über 24 %.
