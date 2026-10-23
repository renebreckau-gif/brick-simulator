# Validierungsgrenzen

Was der Prüfkern in Phase 1 kann, was er vereinfacht und wo er irren kann.

## Unterstützter Umfang

- **Teile**: 18 voll unterstützt (3001, 3002, 3003, 3004, 3005, 3009, 3010, 2456, 3023, 3024, 3030, 3032, 3069b, 3070b, 4162, 4162p0b, 6636, 3794a), 2 teilweise (6541, 2458), 2 nur mit grober Hülle (59900, 30374). Seit 05B.1 zusätzlich Platten 3020, 3021, 3022, 3710, 3666, 3795 sowie Schrägsteine 3039, 3298, 4286 und Keilplatten 41769a, 41770a, 43722a, 43723a mit exaktem Prismenkörper. Alles andere hat Simulation „none“.
- **Verbindungen**: Noppe ↔ Aufnahme und Noppe ↔ Röhre, gerade und achsparallel. Teile müssen in 90°-Schritten ausgerichtet sein.
- **Sonderverbindung (seit 02B)**: Unterseitenstift in Hohlnoppe, **nur 3004 auf 6541** (Regel R-UPIN-HOLLOWSTUD, siehe unten).
- **Erfasst, aber nicht implementiert** (ergibt „ungeprüft“ bzw. „nicht unterstützt“):
  - Technic-Pin, -Loch und -Achse
  - Stange in Halter oder Hohlnoppe
  - Unterseitenstift in Hohlnoppe für alle anderen Teile (z. B. 3010, Jumper 3794a als Aufnahme)
  - Clips und Scharniere
  - seitliche Noppen (SNOT)
  - flexible Teile
  - frei gedrehte Teile

## Vereinfachungen (konservativ)

- **Kollision**: Körper als achsparallele Quader (Schrägsteine und Keilplatten seit 05B.1 als exakte konvexe Prismen, Trennachsentest), Noppen als Quader 12 × 12 × 4 LDU. Der Quader ist etwas größer als der Zylinder, die Prüfung also eher strenger. Hohlräume sind nur als Noppenaufnahmen modelliert: Ein Teil, das in den Hohlraum eines anderen ragt (außer über Noppen), gilt als Durchdringung. Seitlich überstehende Pins (2458) sind nicht im Volumen enthalten.
- **Montage**:
  - nur gerade Bewegung entlang der Noppenachse
  - kein Fingerzugang, keine Steckkraft, keine Toleranzen
  - kein seitliches Einschieben, Kippen oder Biegen
  - die Reihenfolge innerhalb eines Schritts wird gesucht, weil sie nicht belegt ist
  - Zwischenstände separat gebauter Baugruppen werden nicht auf Standfähigkeit geprüft (Annahme: Sie werden in der Hand gebaut)
- **Stand/Kippen (heuristisch)**: Schwerpunkt aus Hüllvolumen, nicht aus realen Massen. Starre Verbindungen und eine ebene, waagerechte Unterlage unter dem tiefsten Punkt sind angenommen. Bewertet wird nur die größte Komponente. Der „Kippwinkel der Unterlage“ ist ein rechnerischer Wert, kein Messwert.
- **Struktur (heuristisch)**:
  - Der schwächste Schnitt zählt Noppen, ohne Haltekräfte oder Hebelarme.
  - „Hängt an einer Noppe“ ist ein Hinweis, kein Bruchnachweis.
  - Durchgehende Fugen werden erst ab 3 Lagen als Hinweis gewertet.
- **Katalog**: Ein fehlender Beleg bedeutet nicht, dass die Kombination nicht existiert. Die ID-Zuordnung ist nicht über die Rebrickable-API bestätigt.

## Prüfumfang ohne Katalogauszug (frischer Checkout)

Der Rebrickable-Katalogauszug ist optional und nicht veröffentlicht. Je nach Zustand der Quelle gilt:

| Prüfung | Katalog geladen | Katalog fehlt | Katalog beschädigt |
|---|---|---|---|
| Teilgeometrie, Anschlüsse, Graph, Kollision, Montage | geprüft | geprüft | geprüft |
| Stand, Struktur (heuristisch) | geprüft | geprüft | geprüft |
| Simulationsunterstützung je Teil (eigene Metadaten) | geprüft | geprüft | geprüft |
| Stückliste aus Modellinstanzen | mit Rebrickable-Nummern | mit LDraw-Namen, Rebrickable-Spalten ungeprüft | wie „fehlt“ |
| Teilexistenz im Katalog, Farbzuordnung, Teil-Farb-Belege | geprüft | **ungeprüft** (`CAT_SOURCE_UNAVAILABLE`) | **ungeprüft** mit Grund (`CAT_SOURCE_CORRUPT`) |
| Inventarabgleich der Referenzen | geprüft | **ungeprüft** | **ungeprüft** |

Ohne Katalog entstehen keine Ersatzdaten. Aus dem Fehlen folgt weder Existenz noch Nichtexistenz einer Teil-Farb-Kombination und keine Aussage über Kaufverfügbarkeit. Farbcodes außerhalb von `LDConfig.ldr` (z. B. LDraw-Direktfarben) bleiben in jedem Fall nicht auflösbare Stücklistenzeilen.

Die Kataloglogik wird in der regulären Suite mit einer synthetischen, ausdrücklich gekennzeichneten Testfixture geprüft (`tests/fixtures/catalog-fixture.json`). Deren Inhalte belegen nichts über reale Teile; das Prüflabor und die Berichte kennzeichnen sie als „TESTFIXTURE“. Die fachlichen Abgleiche gegen echte Rebrickable-Inventare laufen nur in der optionalen Integrationssuite (`npm run test:rebrickable`) und melden fehlende Daten ausdrücklich.

## Bekannte Fehlermöglichkeiten

- Quader-Noppen können in sehr engen Sonderlagen eine Kollision melden, die mit runden Noppen nicht bestünde.
- Teile mit seitlichen Anbauten außerhalb des Körpers (z. B. 2458) können reale Kollisionen übersehen. Sie sind deshalb als „teilweise“ markiert.
- Für Teile mit grober Hülle bleiben alle Überschneidungen ungeprüft. Echte Fehler dort werden also nicht erkannt.
- Standbefunde können bei Modellen mit stark ungleich verteilter Masse (z. B. viele Platten gegenüber hohlen Steinen) abweichen.

## Keine Aussagen ohne Evidenz

- Es gibt **keine** Haltekräfte, Belastungsgrenzen oder Sicherheitsprozentwerte.
- Die Alterseignung ist ein eigenes Feld mit Herkunft. Sie wird nie aus Stabilität abgeleitet, und die Altersangabe eines Referenzsets wird nicht übernommen.
- Für Nutzer unter 3 Jahren gibt es grundsätzlich keine Freigabe. Laut Hersteller gilt DUPLO ab 18 Monaten; DUPLO ist hier eine spätere, separate Teilefamilie, und auch dann zertifiziert der Simulator keine frei entworfene Konstruktion.
- Es gibt kein Label „kindersicher“.
- Der Beschaffungsstatus ist „nicht geprüft“, solange keine realen Angebote vorliegen.

## Vergleich mit bestehenden Werkzeugen

BrickLink Studio beschreibt seine Kollisions- und Stabilitätsprüfung selbst als Orientierung: Sie sei konservativ, markiere oft auch gut verbundene Teile, und Kollisionen würden nicht immer korrekt erkannt. Dieser Prüfkern trennt deshalb ausdrücklich zwischen bestätigt, heuristisch und ungeprüft.

## Erzeugte Modelle (Raumschiff-Generator, seit Auftrag 03)

- Erzeugte Modelle durchlaufen denselben Validator ohne Ausnahmen oder abgeschwächte Regeln. Dass der Generator kollisionsfrei plant, wird nicht als Beleg gewertet.
- Die Baufolge ist erzeugt und im Bewegungsmodell geprüft, aber nicht physisch erprobt. Sie ist keine Herstelleranleitung.
- Heuristische Strukturwarnungen in der Beplankung (1 Noppe breite Streifen) sind bekannte Entwurfsgrenzen und werden angezeigt, nicht unterdrückt.
- Kaufbarkeit, Preise und Verfügbarkeit sind nicht geprüft. Teil-Farb-Belege gibt es nur mit lokalem Katalogauszug.
- Mechanische Belastbarkeit ist ungeprüft (siehe `RAUMSCHIFF.md`, offene Fragen).

## Bauanleitung (seit Auftrag 04)

- Die Anleitung übernimmt nur Prüfergebnisse; sie fügt keine eigene Gültigkeitsaussage hinzu. Einsetzpfeile stehen nur bei im Bewegungsmodell geprüften geraden Steckwegen.
- Die Teilung großer Schritte wird erneut mit dem Montageprüfer geprüft. Verständlichkeit, Fingerzugang und Steckkraft sind nicht geprüft.
- Eine gedruckte Anleitung ist kein Nachweis mechanischer Belastbarkeit.

## Bildvorlagen und Entwurfsaufträge (seit Auftrag 05A)

- Eine Interpretation ist eine Beschreibung, keine Prüfaussage. Der Validator bewertet erst ein daraus konstruiertes Modell.
- Ein Bild belegt weder Rückseite noch Innenkonstruktion, reale Abmessungen, Teilenummern oder Stabilität. Solche Angaben sind Annahmen oder Nutzervorgaben.
- Anforderungen (Teilezahl, Maße, Nutzung) sind Wünsche, keine Machbarkeitszusage. Es gibt keine Alters- oder Sicherheitsfreigabe.

## Mehrere Ansichten (seit Auftrag 05A.5)

- Beschriftete Maße einer Vorlage sind Behauptungen der Vorlage, keine Messung. Gezeichnete Ansichten können unterschiedlich skaliert sein. Abweichungen werden benannt und gemittelt, nicht aufgelöst.
- Entworfene Ansichten (z. B. eine ergänzte Unterseite) sind kein Beleg für die tatsächliche Form.
- Mehrteilige Baugruppen (z. B. mehrere Landebeine) erscheinen im räumlichen Entwurf als ein umhüllender Körper.

## Räumlicher Entwurf (seit Auftrag 05B.0)

- Ein räumlicher Entwurf beschreibt eine Form aus einfachen Körpern, keine Bausteine. Überlappungen sind keine Kollisionen, und Lücken sind kein Beleg für fehlende Verbindungen.
- Lagen und Proportionen aus einem perspektivischen Bild sind Schätzungen. Tiefe, verdeckte Seiten und Innenkonstruktion sind Annahmen. Gekoppelte Spiegelbilder beruhen auf einer Symmetrieannahme.
- Die Bestätigung gilt nur der Form, nicht Stabilität, Montage oder Verfügbarkeit. Reale Maße gibt es nur als Zielvorgabe über einen Maßstab.

## Sonderverbindung „Unterseitenstift in Hohlnoppe“ (R-UPIN-HOLLOWSTUD, connect-rules@1.1.0)

**Technische Beschreibung (aus LDraw geprüft, trifft zu).** Der massive Unterseitenstift eines 1×2-Steins greift koaxial in das Loch einer Hohlnoppe. Die Noppenwand sitzt im Hohlraum zwischen Stift und Seitenwänden.

| Größe | Wert (LDU) | Quelle |
|---|---|---|
| Stift 3004 | r 4, Länge 20 (y 4–24), bündig am Teilboden | `s/3004s01.dat`: `stud3.dat` an (0,4,0), Skalierung y −5 |
| Hohlraum 3004 | lichte halbe Weite x 16, z 6; Tiefe 20 | `box5.dat` mit BFC INVERTNEXT |
| Hohlnoppe 6541 | Wand r 6, Loch r 4, Lochtiefe 4 (Boden = Teiloberseite) | `p/stud2.dat`, `rect.dat` bei y 0 in `6541.dat` |
| Einstecktiefe | 4 (Noppenhöhe) | Teilboden liegt auf der Noppenbasis |

Die Werte stehen versioniert in `part-meta@1.1.0` und werden in `tests/upin-geometry.test.ts` unabhängig aus den LDraw-Primitiven nachgerechnet.

**Geltungsbereich.** Nur 3004 (Stift) auf 6541 (Hohlnoppe), belegt durch das Set 21002-1 (LEGO-Anleitung Schritt 24, OMR-Datei). Andere Teile mit gleicher Anschlussart bleiben ungeprüft, auch der Jumper 3794a mit identischer Hohlnoppen-Primitive. Eine Erweiterung braucht je Paarung eigene Evidenz.

**Bedingungen und Toleranzen.**
- Achsabstand ≤ 0,25 LDU, Achsen entgegengesetzt (Skalarprodukt < −0,999)
- Teilboden auf der Noppenbasis
- Nennmaßvergleich mit 0,05 LDU Toleranz: Stiftradius ≤ Lochradius (4 ≤ 4), Noppen-Außenradius ≤ halbe lichte Weite (6 ≤ 6), Hohlraumtiefe ≥ Einstecktiefe (20 ≥ 4), Lochtiefe ≥ Eintauchtiefe des Stifts (4 ≥ 4)
- Fehlen Maße, entsteht keine Verbindung.
- Drehung des 3004 um die gemeinsame Achse in 90°-Schritten ist erlaubt.

**Getrennt ausgewiesen.**
- *Geometrisch kompatibel*: bestätigt nach LDraw-Nennmaßen. Diese haben **kein Spiel**; reale Fertigungstoleranzen und Klemmung sind nicht modelliert.
- *Im Bewegungsmodell montierbar*: gerade Steckbewegung entlang der Achse (3004 von oben oder 6541 von unten), Weg bis zur Endposition geprüft.
- *Mechanisch belastbar*: **ungeprüft** (`CON_UPIN_MECHANICS_UNCHECKED`). Keine Haltekraft, keine Belastungsgrenze. Für den Strukturindikator zählt die Verbindung als eine Verbindung.

**Kollisionen.** Freigestellt wird ausschließlich das Volumen genau dieser einen Hohlnoppe im Körper des 3004. Alle übrigen Überschneidungen desselben Teilepaars und mit Nachbarteilen bleiben Durchdringungen (Grenzfall ec-11f).

**Falsche Einstecktiefe.** Steht eine Noppe koaxial unter ihrer Aufnahme, ist aber nur teilweise eingesteckt, meldet der Prüfkern seit 02B „falsche Einstecktiefe“ (`COL_PARTIAL_INSERTION`, Blocker) statt einer allgemeinen Durchdringung. Das gilt auch für reguläre Noppen. Zu tiefe Teile bleiben Durchdringungen.

**Nicht durchgeführt.** Kein physischer Probebau, keine Kraftmessung. Ein Probebau bleibt offener Validierungsschritt (Protokolle in `PHYSISCHE-PRUEFPROTOKOLLE.md`).

## Konstruktionsnachweis (seit Auftrag 05B.1)

- **Formvorgabe aus einer Vorlage:**
  - Sie ist eine Messung der Zeichnung (Umriss gegen hellen Hintergrund) und beschreibt nur einen Abschnitt (Bug und Kanzel).
  - Verdeckte Flächen sind Annahmen, etwa die Rumpfoberkante unter der Kanzel.
  - Andere Vorlagen können falsch gemessen werden; geprüft wurde die Messung an einer Vorlage.
- **„Umrissüberdeckung“:** ein grober Hinweis (normierte Profile, 60 Stützstellen), kein Gültigkeitsnachweis.
- **Formteile, konservativ modelliert:**
  - Unter einer teilweise überdeckten Keilplattenzelle wird keine Aufnahme gezählt.
  - Die Röhren der Schrägsteine sind kein Anschluss.
  - Schräg aufgesetzte Teile, gekrümmte Teile und seitliche Noppen sind nicht unterstützt.
- **Ohne Katalogauszug:** Neue Teile sind ohne Katalogauszug „ungeprüft“; auch mit Auszug fehlen sie darin, also „nicht belegt“. Keine Farbe eines neuen Teils gilt als real bestätigt, insbesondere nicht 3039 in Trans Brown (LDraw 40).
- **Nicht physisch erprobt:**
  - Halt der Plattenstapel, Klemmung der Schrägsteine, Steifigkeit der Spitze.
  - Strukturbefunde (z. B. durchgehende Fugen) sind Heuristiken.

## Teilebibliothek (Auftrag 05C.1)

Die Teilebibliothek erweitert **nicht** den Prüfumfang. Geprüft werden weiterhin nur Teile mit eigenen Teil-Metadaten (`partMeta.ts`). Für alle anderen Teile gilt:

- **Importierte Anschlüsse** (LDCad, BrickNet) sind Suchhinweise. Der Validator wertet sie nicht als Verbindung. Ein Teil mit importierten Anschlüssen bleibt „nicht unterstützt“, bis seine Metadaten geprüft eingetragen sind.
- **Fehlende Anschlussdaten** bedeuten „unbekannt“. Daraus folgt weder „verbindbar“ noch „unverbindbar“. Widersprechen sich die Quellen, wird das als „widersprüchlich“ ausgewiesen.
- **Geometrie-Kennwerte** (geneigt, gekrümmt, runde Wand …) sind Messungen über Flächenrichtungen ohne Anschluss-Primitive.
  - Sie zählen nur außenliegende Flächen (Stützebenen der Hülle, Toleranz 1 LDU).
  - Schwellen: geneigt ≥ 8 %, gekrümmt/runde Wand ≥ 15 %, schräge Kante ≥ 5 % der Körperoberfläche.
  - Grenzfälle (sehr kleine Fasen, Gitter) können anders eingeordnet werden, als ein Mensch es täte.
- **Hüllquader** enthalten keine Anschluss-Primitive (Noppen, Röhren). Bei schief gedrehten Unterdateien sind sie genähert und als „genähert“ markiert.
- **Farbbelege** stammen aus Set-Inventaren (Rebrickable, nur lokal). Sie belegen, dass eine Kombination existierte, aber keine heutige Verfügbarkeit. Ohne lokale Daten ist keine Farbe belegt.
- **Druckvarianten** behalten ihre eigene LDraw-Datei. Kennwerte, Anschlüsse und Unterstützung des Grundteils werden nicht auf sie übertragen.

### Ergänzung 05C.1.1

- **Prüfkern-Identität:** Teil-Metadaten gelten für eine andere LDraw-Nummer nur über eine belegte reine Umbenennung, derzeit 3023 → 3023b. Formvarianten (z. B. 3794a/3794b) bleiben getrennt und brauchen eigene Metadaten.
- **Farbbelege:** Sie stammen nur aus belegter Identität. Rund 760 mehrdeutige Rebrickable-Nummern bleiben ohne Beleg und gelten als unbekannt, nicht als „nicht vorhanden“.
- **Geometrie-Kennwerte unter Linux und Windows:** Die Klassifikation verwendet keine Winkelfunktionen mehr. Einzig die Achsen der BrickNet-Anschlüsse nutzen für Winkel, die kein Vielfaches von 90° sind, noch `sin` und `cos`; das Ergebnis wird auf 0,01 gerundet.
