# Architekturentscheidungen

Stand: 2026-10-14, Phase 1.

## A1 – Technik: TypeScript, React, Three.js, Vite, Vitest

Entspricht dem Default des Auftrags. Vite 8 als schlanker Build, Vitest 5 als Testlauf im selben Werkzeug. Kein Backend, keine Accounts, keine Datenbank: Alle Daten sind Dateien unter `data/`. Three.js wird direkt genutzt (ohne react-three-fiber), um eine Abhängigkeit weniger zu haben; die Ansicht ist eine einzelne Komponente.

## A2 – Ein kanonisches Modell als einzige Quelle

`CanonicalModel` (`src/core/model/types.ts`) enthält Instanzen (stabile `instanceId`, LDraw-Teil, LDraw-Farbe, Position, Rotation, Baugruppe), Baugruppen, Bauschritte, Nutzungsprofil und Änderungsprotokoll. 3D-Ansicht, Prüfung, Stückliste, Bauschritte und Exporte lesen ausschließlich dieses Objekt.

Jedes abgeleitete Artefakt (Bericht, Stückliste, Beschaffungsstand) trägt einen `ModelRef` aus Modell-ID, Version und Inhalts-Hash. `applyEdit` erzeugt bei jeder konstruktiven Änderung eine neue Version. `artifactStatus` meldet ältere Artefakte als `stale`. Die Oberfläche prüft eine geänderte Version nicht automatisch neu, damit der veraltete Zustand sichtbar bleibt.

## A3 – Koordinaten und Einheiten

LDraw-System: rechtshändig, −Y oben, Einheit LDU. Ein Noppenraster ist 20 LDU, ein Stein 24, eine Platte 8, eine Noppe 4 hoch. Die Schwerkraft wirkt in Welt-+Y. In der Ansicht wird das LDraw-System um 180° um X gedreht; das ist eine echte Drehung, keine Spiegelung. Toleranzen stehen in `src/core/units.ts`:

| Toleranz | Wert | Bedeutung |
|---|---|---|
| connectorPosition | 0,25 LDU | Anschlusspunkte gelten als deckungsgleich |
| penetration | 0,5 LDU | ab dieser Überlappung in allen Achsen gilt eine Durchdringung |
| contact | 0,25 LDU | Abstand für „berührt“ |
| matrix | 1·10⁻³ | Abweichung von Orthonormalität, ab der ein Teil als verformt gilt |

## A4 – Geometrie aus LDraw, Anschlüsse aus eigenen Metadaten

LDraw liefert Geometrie, aber keine Anschluss- oder Belastungsdaten. Deshalb gibt es eigene, versionierte Teil-Metadaten (`partMeta.ts`, `part-meta@1.0.0`): Körpervolumen, Noppen, Hohlnoppen, Aufnahmen, Röhren, Unterseitenstifte sowie nicht unterstützte Anschlüsse (Technic-Pin und -Loch). Sie werden parametrisch aus dem Teiltyp erzeugt.

Der Test `tests/part-meta-crosscheck.test.ts` gleicht sie unabhängig gegen die LDraw-Geometrie ab: Begrenzungsbox ↔ Körper, `stud.dat`/`stud2.dat` ↔ Noppen, `stud4.dat` ↔ Röhren, `stud3.dat` ↔ Unterseitenstifte. Eine dabei gefundene Abweichung (3069b ohne `stud3.dat`) ist im Datensatz begründet.

## A5 – Katalog: drei getrennte Eigenschaften

`Catalog` trennt drei Eigenschaften:

- **Existenz**: Rebrickable-Auszug plus ID-Zuordnung. Der Auszug ist optional (A11).
- **Simulationsunterstützung**: `supported`, `partial`, `unsupported` oder `none`.
- **Beschaffung**: eigenes Modul, Standardstatus „nicht geprüft“.

Teil-Farb-Kombinationen gelten als belegt, wenn es eine LEGO-Element-ID (`elements.csv`) oder einen Eintrag in einem Set-Inventar gibt. Farben werden nur zugeordnet, wenn LDraw-Code und Rebrickable-ID gleich sind *und* die normalisierten Namen übereinstimmen.

## A6 – Prüfschichten und Evidenzstufen

Die Schichten heißen catalog, geometry, connection, graph, collision, assembly, stability, structure, usage und procurement. Jeder Befund hat Kategorie, Dimension (Datenbasis, Montage, Robustheit, Nutzungseignung), Status, Schweregrad, Evidenzstufe (`confirmed`, `heuristic`, `unchecked`), betroffene Teile, Schritte und Baugruppen, Regelversion, Evidenz, Einschränkung und Abhilfe.

Grundregel: Was nicht implementiert ist oder wofür Daten fehlen, wird `unchecked` oder `unsupported` und niemals `passed` oder Blocker. Beispiele:

- Technic-Pin
- Hohlnoppe mit Unterseitenstift
- Kegel und Stange
- Teil ohne Geometrie

Der Gesamtstatus kennt nur drei Werte: „Blocker gefunden (im geprüften Umfang)“, „keine Blocker – offene Bereiche“ und „keine Blocker – alles geprüft“.

## A7 – Überschneidungen werden einmal klassifiziert

`computeOverlaps` (`world.ts`) klassifiziert jede Überschneidung genau einmal: entweder als Durchdringung oder als ungeprüft (grobe Hülle oder nicht implementierte Technik). Kollisionsprüfung und Montageprüfung verwenden dieselbe Klassifikation. So kann eine ungeprüfte Technik nicht an anderer Stelle als „Weg blockiert“ wieder auftauchen.

## A8 – Montageprüfung

Je Schritt werden Einzelteile und separat gebaute Baugruppen als Einheiten platziert. Die Richtung ergibt sich aus den Steckverbindungen. Widersprechen sich zwei Richtungen, liegt eine Klemmposition vor. Eine deklarierte Richtung wird gegen die Verbindungen geprüft. Der Weg wird entlang der Achse von „unendlich“ bis zur Endposition gefegt.

Die Reihenfolge innerhalb eines Schritts ist nicht belegt. Deshalb werden zuerst Einheiten mit Verbindung zum Bestand und freiem Weg platziert. Baugruppen haben einen eigenen Baukontext. Zwischenzustände werden heuristisch auf Zerfall in Teilgruppen und Standfähigkeit bewertet; eine deklarierte Unterstützung verwandelt die Warnung in einen dokumentierten Hinweis.

## A9 – Erwartungen getrennt vom Validator

Grenzfälle sind Code-Fixtures (`src/fixtures`). Ihre Erwartungen und Begründungen stehen in `data/expectations/edge-cases.json`. Die Tests vergleichen nur Befundcodes und betroffene Instanzen mit diesen Erwartungen und rechnen die Prüfalgorithmen nicht nach. Zusätzliche unabhängige Kontrollen:

- Invarianz unter Verschiebung und Drehung
- Bezug des Standbefunds auf die Schwerkraft
- Unabhängigkeit der Stückliste von der Dateireihenfolge
- LDraw-Export und -Re-Import ergeben dieselbe Stückliste
- Stückliste gegen das unabhängige Rebrickable-Inventar

## A10 – Spätere Vision im Datenmodell, nicht im Code

Die Datenmodelle enthalten bereits Platz für Späteres: Anschlussarten für Technic, Stangen, Clips, Scharniere, SNOT und flexible Teile, Unterstützungsdeklarationen, Nutzungsprofil und Alterseignung, Provider und Angebote, eigenen Bestand und Konzeptbilder. Implementiert ist nur der Phase-1-Umfang. KI-Vorschläge sollen später als `ModelOrigin.kind = 'user'`-ähnliche Eingaben in denselben Validator laufen; der Validator bleibt die unabhängige Instanz.

## A11 – Pflichtdaten und optionale Kataloganreicherung getrennt (Auftrag 02A)

Der Datenlader (`src/core/data/bundle.ts`) unterscheidet Pflichtdaten (LDraw-Geometrie und -Farben, ID-Zuordnung, Referenzmodelle – alle im Repository) von der optionalen, privaten Katalogquelle. Die Lesefunktion liefert `null` nur für „Datei existiert nicht“; andere Lesefehler werden weitergegeben. Die Katalogquelle hat drei Zustände: `loaded`, `missing`, `corrupt`. Ein vorhandener Auszug wird gegen das Schema geprüft (`parseExtract`); bei Beschädigung nennt die Meldung Datei und Grund, und der Auszug wird nicht verwendet.

Ohne gültigen Katalog meldet die Katalogschicht genau einen Befund „ungeprüft“; Einzelaussagen zu Existenz, Farbe oder Beleg entstehen nicht. Die Stückliste wird dann aus den Modellinstanzen mit LDraw-Namen gebildet, der Inventarabgleich entfällt ausdrücklich.

## A12 – Öffentliche Builds über eine Positivliste

`publicDir` ist abgeschaltet. Das Vite-Plugin in `vite.config.ts` liefert unter `/data/` nur Dateien aus der Positivliste (`scripts/data-files.mjs`) aus; der Dev-Server zusätzlich die privaten lokalen Dateien. Unbekannte `/data/`-Pfade ergeben 404 statt SPA-Fallback. Der Build schreibt nur die Positivliste nach `dist/data/`, danach prüft `scripts/check-public-build.mjs` den Ordner. Die Prüfung ist selbst getestet (`tests/public-build.test.ts`, mit absichtlich verunreinigten Builds).

## A13 – Drei Testebenen

- **Regulär ohne Katalog** (`npm test`): Geometrie, Verbindungen, Montage, Versionen, Exporte, Referenzen und alle nicht-katalogbezogenen Erwartungen. Der private Auszug wird nie gelesen, auch wenn er lokal liegt.
- **Regulär mit Testfixture**: alle deklarierten Erwartungen inkl. Katalogbefunden sowie die Logik von Farbzuordnung, Belegen und Inventarabgleich – mit synthetischen, gekennzeichneten Daten.
- **Optional mit echtem Auszug** (`npm run test:rebrickable`): die fachlichen Abgleiche gegen echte Inventare. Fehlende Daten brechen den Lauf mit ausdrücklicher Meldung ab.

## A14 – Sonderregeln mit belegtem Geltungsbereich (Auftrag 02B)

Regeln können einen teilespezifischen Geltungsbereich (`scope`) tragen. Ein Anschluss gilt nur dann als implementiert, wenn die Paarung aus Regel und Teil im Geltungsbereich liegt (`isImplementedConnector`). Sonst bleibt er „ungeprüft“, auch wenn ein anderes Teil dieselbe Anschlussart hat. Geometrische Voraussetzungen werden aus versionierten, gegen LDraw nachgerechneten Maßen geprüft (`connectivity/upin.ts`); fehlende Maße verhindern die Verbindung.

Die Kollisionsfreistellung einer Sonderverbindung erfolgt pro Noppe (`studTarget`), nie pro Teilepaar. Die Montageprüfung behandelt die neue Verbindung wie eine Steckverbindung entlang der Achse des männlichen Anschlusses.

## A15 – Herstellerbaufolgen als abgeleitete Sequenz

Eine Herstelleranleitung wird nicht als Modell nachgebaut. Gespeichert wird nur die eigene Zuordnung ihrer Schritte auf die OMR-Gruppen (`data/references/sequences/*.json`, veröffentlichbar, ohne Anleitungsinhalte). `instructionSequenceModel` erzeugt daraus eine abgeleitete Baufolge mit unveränderter Geometrie: Untermodelle werden an Ort und Stelle gebaut, Einschubbilder werden zu separat gebauten Vormontagen. Eine unvollständige oder doppelte Zuordnung wird abgelehnt. So lässt sich die Herstellerfolge mit demselben Montageprüfer prüfen wie die OMR-Folge.

## A16 – Erzeugte Modelle bleiben gewöhnliche kanonische Modelle (Auftrag 03)

Der Raumschiff-Generator (`src/generator/spaceship.ts`) erzeugt ein normales `CanonicalModel` mit `origin.kind = 'generated'`, `stepsSource = 'generated'` und dem Feld `generator` (Name, Version, Eingaben). Das Feld geht in den Inhalts-Hash ein. Der Generator hat keine eigene Gültigkeitslogik, die den Validator ersetzt. Sein Belegungsraster dient nur dazu, beim Erzeugen nicht zu überschneiden. Ob das Modell gültig ist, entscheidet allein der unveränderte Validator, und alle Ansichten (3D, Bericht, Baufolge, Stückliste, Exporte) beziehen sich auf dieselbe Modellversion. Zufall kommt aus einem gesetzten PRNG (mulberry32); Sortierungen verwenden vorab gezogene Schlüssel, damit das Ergebnis nicht von der Sortierimplementierung der JS-Engine abhängt. Eine Änderung am Ergebnis erfordert eine neue Generatorversion; die festgeschriebenen Hashes der drei Varianten machen das sichtbar. Details: `RAUMSCHIFF.md`.

## A17 – Bauanleitung als versionierter Anleitungsplan (Auftrag 04)

Die Anleitung ist ein abgeleitetes Artefakt (`src/core/instructions/plan.ts`, `instr-plan@1.0.0`) mit eigenem Hash und `modelRef`. Sie teilt große kanonische Schritte nur innerhalb ihrer Grenzen und behält deren Reihenfolge bei. Die verfeinerte Folge wird mit dem unveränderten Montageprüfer erneut geprüft. Der Plan legt Kameras, Bildausschnitte und hervorgehobene Instanzen fest. Der Renderer (`src/ui/instructions/render.ts`) setzt nur um, was der Plan vorgibt, und zeichnet Einsetzpfeile nur für geprüfte Steckwege. Bildschirm, Druckansicht und PDF (jsPDF, lokal) nutzen dieselbe Datenbasis (`document.ts`). Eine Modelländerung macht den Plan über `modelRef` sichtbar veraltet und sperrt Druck und Export. Details: `BAUANLEITUNG.md`.
