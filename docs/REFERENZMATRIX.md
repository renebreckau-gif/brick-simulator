# Referenzmatrix und Grenzfälle

## Auswahl der Referenzen

Alle 1470 Sets im LDraw-OMR wurden gegen die Rebrickable-Inventare gefiltert: 15–120 Teile, sortiert nach dem Anteil einfacher Steine, Platten und Fliesen. Entscheidend waren Datenqualität und unterstützter Teileumfang, nicht die Bekanntheit.

| | 40013-1 Halloween Ghost | 21002-1 Empire State Building | 1869-1 South African Flag |
|---|---|---|---|
| Rolle | positive Referenz, voll unterstützt | positive Referenz mit realen Sondertechniken | Endzustand und Verband, **ohne** Baufolge |
| Teile (Modell / Rebrickable) | 18 / 18 | 77 / 77 | 82 / 81 |
| Baufolge in der Quelle | 6 STEP-Gruppen + 1 Untermodell | 25 STEP-Gruppen, Untermodelle Base und Building | keine |
| Teileumfang | 3002, 3003, 3004 | 14 unterstützte Teile + 6541, 2458 (teilweise) + 59900, 30374 (nicht unterstützt) | 8 Steintypen, alle unterstützt |
| Stücklistenabgleich | 4/4 Zeilen gleich | gleich bis auf Jumper 3794a ↔ 3794b (Formvariante; LEGO-Teileliste spricht für 3794b, s. u.) | 2 Abweichungen: 3004 gelb 7 statt 8, 3005 gelb 2 statt 0 (offen) |
| Prüfergebnis | keine Blocker; alle Steckwege frei; Beine werden von unten angesetzt (Hinweis) | keine Blocker; Unterseitenstift in Hohlnoppe (3004 auf 6541) seit 02B **erkannt**; Technic-Pin/Loch sowie Kegel und Stange **ungeprüft**; heuristische Hinweise: Turm mit durchgehenden Fugen, Spitze an einer Noppe | keine Blocker; Montage **ungeprüft**; heuristisch standfähig |
| Durch die Quelle gedeckt | Teile, Farben, Positionen, Schrittgruppen | dto. + Baugruppen | Teile, Farben, Positionen |
| Ungeprüft | Einschubrichtungen (abgeleitet), Reihenfolge innerhalb eines Schritts, Abgleich mit einer Originalanleitung (keine Herstellerquelle), Haltbarkeit, Kindersicherheit | Einschubrichtungen, nicht unterstützte Techniken, Haltekraft der Sonderverbindung, Haltbarkeit, Kindersicherheit | Baufolge, Haltbarkeit |
| Originalanleitung | keine Herstellerquelle (LEGO-Seite ohne Eintrag; Brickset nur Drittanbieter) | 3 LEGO-PDFs (4580898, 4644793, 4656136), **abgeglichen** | keine Herstellerquelle |

Eine veröffentlichte Baufolge belegt nur, dass der Ablauf funktioniert. Sie ist kein Nachweis für Haltbarkeit oder Kindersicherheit.

## Abgleich mit Originalanleitungen (Auftrag 02B, Stand 2026-10-15)

Alle Abgleiche sind **Quellenabgleiche am Dokument**. Ein physischer Probebau hat nicht stattgefunden.

### 21002-1 Empire State Building – abgeglichen

Quellen: drei Ausgaben der LEGO-Bauanleitung vom LEGO-CDN (über die Anleitungsliste von Brickset gefunden). PDF 4580898 (Ausgabe 2010) Seite für Seite (S. 4–16), dazu PDF 4644793 (V29, 2011) und 4656136 (V39, 2011) für Teileliste und Schritte 1–2. Prüfsummen und Rollen in `data/references/sequences/21002-1.instructions.json`. Die PDFs werden nur verlinkt.

| Anleitung | OMR-Gruppe | Teile laut Anleitung | Ergebnis |
|---|---|---|---|
| 1–4 | Base #1–#4 | 2× Platte 4×10 schwarz; 4× Fliese 1×8 schwarz; 2× Platte 4×6 grau; 4× Fliese 1×6 grau | gleich |
| 5–10 | Building #1–#6 | 3× 2×4; 1× Platte 4×6; 2× Fliese 1×6 + 2× Fliese 1×2; 2× Jumper + 2× Platte 1×2; 1× 1×2; 2× 2×3 | gleich |
| 11–20 | Building #7–#16 | 4× 2×3 + 2× 1×2; 1× Jumper + 2× Platte 1×1; 4× Fliese 1×2 + 2× Fliese 1×1; 1× 2×4; 4× Jumper; 1× 2×3; 2× Platte 1×2 + 1× Jumper; 1× 1×1; 2× 1×2; 6× 1×2 + 3× 1×1 | gleich |
| 21 | Building #17 | 6541 + 2458, **Einschubbild**: 6541 seitlich auf den Pin, dann gemeinsam aufsetzen | Teile gleich; Vormontage fehlt in OMR |
| 22 | Building #18 | 6541 + 3004 | gleich |
| 23 | Building #19 | 4× Platte 1×2 + 2× Fliese 1×2, **Einschubbild**: 2× Stapel | Teile gleich; Vormontage fehlt in OMR |
| 24 | Building #20 | 1× Jumper + 1× 1×2 (der 1×2 sitzt mittig auf 6541) | gleich – Grundlage der Sonderverbindung |
| 25 | Building #21 | Stange + Kegel, **Einschubbild**: Stange in Kegel | Teile gleich; Vormontage fehlt in OMR |

Teileliste (S. 16, in allen drei Ausgaben gleich): 77 Teile, Mengen je Element identisch mit dem Modell.

**Darstellung vs. Montageabhängigkeit.**
- Gruppierung: Die Anleitung baut das Gebäude direkt auf dem Sockel, die OMR-Datei als separat vorgebautes Untermodell. Die Herstellerfolge ist als abgeleitete Baufolge (Laborauswahl „Baufolge nach LEGO-Anleitung“) im Bewegungsmodell ohne Blocker ausführbar – reiner Darstellungsunterschied.
- Einschubbilder 23 und 25: Vormontagen ohne neue Abhängigkeit (die OMR-Gruppierung ist ebenfalls ausführbar).
- Einschubbild 21: montagerelevant (seitliche Pinbewegung in das Loch von 6541), bleibt aber ungeprüft, weil Technic nicht unterstützt ist.

**Abweichungen.**
- Jumper 3794a ↔ 3794b: Die Herstellerteileliste nennt Element **4155708** (Design 3794). Laut Rebrickable `elements.csv` gehört 4155708 zu **3794b** (mit Nut). Damit spricht die Evidenz für 3794b; die Zuordnung Element→Formvariante stammt aber von Rebrickable, nicht vom Hersteller, und die Nut ist in den Anleitungsbildern nicht erkennbar. **Teilweise geklärt**, Modell (OMR: 3794a) unverändert.
- Bedruckte Fliese: Schritt 2 zeigt den Aufdruck, die Teileliste nennt aber 4× Element 416226 (laut Rebrickable unbedruckte 4162 schwarz). OMR und Rebrickable-Inventar führen eine bedruckte Fliese. **Offen.**
- Erscheinungsjahr 2008/2009: ohne Belang für die Baufolge, **offen**.

### 40013-1 Halloween Ghost – offen

Die LEGO-Anleitungsseite liefert für 40013 keinen Eintrag (abgerufen 2026-10-15). Brickset verweist nur auf Drittanbieter-Scanseiten. Diese wurden nicht verwendet, weil Authentizität und Rechte ungeklärt sind und Herstellerquellen bevorzugt werden. Die OMR-STEP-Gruppen bleiben **ungeprüft**; die Stückliste ist weiterhin über Rebrickable unabhängig bestätigt.

### 1869-1 South African Flag – offen

Ebenfalls kein Eintrag auf der LEGO-Anleitungsseite, nur Drittanbieter-Verweise bei Brickset. Die Teilezahl-Abweichung (OMR 82, Rebrickable 81, Brickset 80) und 3004/3005 gelb (7+2 vs. 8+0) bleiben **offen**: Ohne Herstellerteileliste ist nicht entscheidbar, welche Angabe dem Originalset entspricht. Modell und Inventar unverändert.

**Offene externe Abnahmekriterien.** Originalanleitungen für 40013-1 und 1869-1; Klärung von Druckteil und Jumper-Variante bei 21002-1 am physischen Teil oder über eine Herstellerangabe zur Formvariante; physischer Probebau aller drei Referenzen.

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
| Sonderverbindung Unterseitenstift in Hohlnoppe | ec-11a | Mikro-Baugruppe 3004 auf 6541: Verbindung erkannt, keine Kollision, Montage frei, Haltekraft ungeprüft |
| | ec-11b / ec-11c | seitlich versetzt (4 LDU) / kopfüber: Durchdringung, keine Verbindung |
| | ec-11d / ec-11e | Einstecktiefe 2 statt 4 LDU: „falsche Einstecktiefe“ / 2 LDU zu tief: Durchdringung |
| | ec-11f | gültige Verbindung + Störer im 3004: Durchdringung 3004/Störer, keine Kollision 3004/6541 |
| | ec-11g | Endposition gültig, Steckweg durch Brücke blockiert |
| | ec-11h / ec-11i / ec-11j | 3010 auf 6541 und 3004 auf Jumper: ungeprüft (außerhalb Geltungsbereich) / 3004 auf Vollnoppe: Durchdringung |
| | Referenz 21002-1 | 3004 (L89) auf 6541 (L79) erkannt, in OMR-Folge und in der Herstellerfolge (Schritt 24) |

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
