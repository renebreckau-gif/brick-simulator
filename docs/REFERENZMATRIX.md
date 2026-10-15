# Referenzmatrix und Grenzfälle

## Auswahl der Referenzen

Alle 1470 Sets im LDraw-OMR wurden gegen die Rebrickable-Inventare gefiltert: 15–120 Teile, sortiert nach dem Anteil einfacher Steine, Platten und Fliesen. Entscheidend waren Datenqualität und unterstützter Teileumfang, nicht die Bekanntheit.

| | 40013-1 Halloween Ghost | 21002-1 Empire State Building | 1869-1 South African Flag |
|---|---|---|---|
| Rolle | positive Referenz, voll unterstützt | positive Referenz mit realen Sondertechniken | Endzustand und Verband, **ohne** Baufolge |
| Teile (Modell / Rebrickable) | 18 / 18 | 77 / 77 | 82 / 81 |
| Baufolge in der Quelle | 6 STEP-Gruppen + 1 Untermodell | 25 STEP-Gruppen, Untermodelle Base und Building | keine |
| Teileumfang | 3002, 3003, 3004 | 14 unterstützte Teile + 6541, 2458 (teilweise) + 59900, 30374 (nicht unterstützt) | 8 Steintypen, alle unterstützt |
| Stücklistenabgleich | 4/4 Zeilen gleich | gleich bis auf Jumper 3794a ↔ 3794b (Formvariante laut Rebrickable, offen) | 2 Abweichungen: 3004 gelb 7 statt 8, 3005 gelb 2 statt 0 (offen) |
| Prüfergebnis | keine Blocker; alle Steckwege frei; Beine werden von unten angesetzt (Hinweis) | keine Blocker; Technic-Pin/Loch, Hohlnoppe mit Unterseitenstift sowie Kegel und Stange **ungeprüft**; heuristische Hinweise: Turm mit durchgehenden Fugen, Spitze an einer Noppe | keine Blocker; Montage **ungeprüft**; heuristisch standfähig |
| Durch die Quelle gedeckt | Teile, Farben, Positionen, Schrittgruppen | dto. + Baugruppen | Teile, Farben, Positionen |
| Ungeprüft | Einschubrichtungen (abgeleitet), Reihenfolge innerhalb eines Schritts, Abgleich der OMR-Schritte mit der gedruckten Anleitung, Haltbarkeit, Kindersicherheit | dto. + nicht unterstützte Techniken | Baufolge, Haltbarkeit |
| Anleitung | [Brickset](https://brickset.com/sets/40013-1) | [LEGO, offiziell](https://www.lego.com/de-de/service/building-instructions/21002) | keine belegt |

Eine veröffentlichte Baufolge belegt nur, dass der Ablauf funktioniert. Sie ist kein Nachweis für Haltbarkeit oder Kindersicherheit.

**Offene externe Abnahmekriterien.** Die OMR-Schrittgruppen wurden nicht Bild für Bild mit den gedruckten Anleitungen verglichen. Die drei Quellenabweichungen (Jumpervariante, Flaggenteile, Erscheinungsjahr 2008/2009) sind dokumentiert, aber nicht aufgelöst.

## Grenzfall-Korpus (synthetische Fixtures)

Erwartungen und Begründungen stehen in `data/expectations/edge-cases.json`, getrennt vom Validator.

| Gruppe | Fall | Erwartung |
|---|---|---|
| Steckverbindung vs. Berührung | ec-01a / ec-01b | 8 Verbindungen, zusammenhängend / lose, aber keine Durchdringung |
| Verbunden vs. schwebend | ec-02 | schwebende Komponente (Blocker) |
| Zulässig vs. Durchdringung | ec-03a / ec-03b | Durchdringung 12 LDU / halbe Noppe ohne Jumper = Durchdringung |
| Verband vs. Fugen | ec-04a / ec-04b / ec-04c | keine durchgehende Fuge / Fuge über 3 Lagen (heuristisch) / zwei getrennte Säulen |
| Endposition passt, Weg/Reihenfolge nicht | ec-05a / b / c / d | ausführbar / Klemmposition / Weg blockiert / deklarierte Richtung widerspricht |
| Vormontiertes Modul vs. unzugänglich | ec-06a / ec-06b | ausführbar als Modul / Klemmposition ohne Modul |
| Handunterstützung | ec-07a / ec-07b | dokumentiert (Hinweis) / Warnung, aber kein Blocker |
| Halbnoppen & seitlich | ec-08a / b / c | Jumper unterstützt / Noppe in Röhre unterstützt / SNOT ausdrücklich „nicht unterstützt“ |
| Unbekannt, Farbe, veraltet | ec-09a / b / c / d | ungeprüft statt Blocker / Farbe ohne Zuordnung, Stücklistenzeile nicht auflösbar / Katalog belegt, Simulation nicht unterstützt / Bericht veraltet nach Änderung |
| Nutzung | ec-10 | keine Freigabe unter 3 Jahren |

## Fehlervarianten der Referenzen

Getestet an 40013-1 und 1869-1 (`tests/mutations.test.ts`), in der Oberfläche für 40013-1. In jedem Fall muss der Befund das veränderte Teil nennen.

| Variante | Erwarteter Befund |
|---|---|
| oberstes Teil um ½ Noppe verschoben | Durchdringung |
| oberstes Teil um 16 LDU angehoben | lose/schwebende Komponente |
| Teil um 10 % skaliert | Teil verformt |
| Farbe ohne Katalogzuordnung | Farbe ohne Zuordnung |
| oberstes Teil in Schritt 1 vorgezogen | Klemmposition oder Weg blockiert |

## Unabhängige Kontrollen

- Starre Bewegung des Gesamtmodells (Verschiebungen, Drehungen um Y und X): Verbindungen und Befunde zu Anschlüssen, Graph und Kollision bleiben identisch. Getestet an 7 Modellen × 5 Bewegungen.
- Standbefund: Drehung um Y ändert ihn nicht, Drehung um X schon, denn er bezieht sich auf Welt-Schwerkraft +Y.
- Stückliste unabhängig von Instanz- und Dateizeilenreihenfolge.
- LDraw-Export und -Re-Import ergeben dieselbe Stückliste und dieselbe Zahl an Verbindungen.
- Teil-Metadaten gegen LDraw-Primitive.
