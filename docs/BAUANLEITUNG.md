# Bauanleitung (Auftrag 04)

Aus der geprüften Baufolge eines kanonischen Modells entsteht eine Anleitung, die einen Menschen durch einen realen Aufbau führen soll. Die Anleitung ist ein **abgeleitetes Artefakt**. Sie verändert weder Modell noch kanonische Baufolge und ist kein Nachweis mechanischer Belastbarkeit.

**Geltungsbereich:** Die Anleitung arbeitet mit jedem kanonischen Modell ohne Blocker, das eine Baufolge hat. Sie ist nicht an den Raumschiffgenerator, seine Module oder Varianten gebunden; ein Test stellt sicher, dass der Anleitungscode den Generator nicht importiert. Erprobt ist sie mit den drei Raumschiffvarianten, mit den Referenzen 40013-1 und 21002-1 (auch mit der Baufolge nach LEGO-Anleitung und deren verschachtelten Vormontagen) und mit allen Grenzfällen ohne Blocker. Modelle mit Blockern oder ohne Baufolge (z. B. 1869-1) erhalten eine klare Ablehnung statt einer Anleitung.

## Verwendung

1. Ein Modell anzeigen: im Prüflabor eine Referenz oder einen Grenzfall wählen, im Raumschiff-Labor eine Variante oder Eingaben.
2. Oben im Hauptbereich auf **Bauanleitung** wechseln. Der Plan wird für das angezeigte Modell abgeleitet.
3. Der Bereich zeigt eine **Übersicht**: fertiges Modell, tatsächliche Teilezahl und Außenmaße, Modell-ID, Version, Hash, Planversion, Hinweis zum Prüfumfang und Legende der Markierungen.
4. Mit **Zurück/Weiter** oder der Schrittauswahl durch die Schritte gehen. Fortschritt und aktuelle Baugruppe stehen unter der Navigation; der letzte Eintrag ist die **vollständige Stückliste**.
5. **Druckansicht** zeigt alle Schritte untereinander (Drucken über den Browser). **PDF exportieren** erzeugt ein A4-PDF lokal im Browser (jsPDF, ohne Serverdienst). Der Dateiname enthält Modell-ID, Version und Hash.

## Anleitungsplan (`src/core/instructions/plan.ts`, `instr-plan@1.0.0`)

Der Plan bezieht sich über `modelRef` (Modell-ID, Version, Inhalts-Hash) auf genau einen Modellstand und trägt eine eigene Planversion und einen Plan-Hash. Je Anleitungsschritt hält er fest:

- den kanonischen Ursprungsschritt (`sourceStepId`) und die neuen Teilinstanzen (`add`) bzw. angesetzten Baugruppen (`attach`),
- die gezeigten und hervorgehobenen Instanzen (Bauzustand des Baukontexts nach dem Schritt),
- Kameraperspektive, Bildausschnitt und gegebenenfalls eine Detailansicht,
- die Einsetzrichtung aus der Montageprüfung, Hinweise auf Handunterstützung und offene Prüfungen,
- die Teileübersicht des Schritts (Teilenummer, Farbe, Menge, Instanzen).

**Verfeinerung statt Umbau:** Kanonische Schritte mit mehr als 6 neuen Teilen werden in kleinere Teilschritte geteilt: zuerst nach Höhe, dann entlang der längeren waagerechten Achse des Baukontexts. Die Reihenfolge der kanonischen Schritte bleibt unverändert, und jeder Teilschritt gehört zu genau einem kanonischen Schritt. Die verfeinerte Folge wird mit dem unveränderten Montageprüfer erneut geprüft. Nur wenn dabei kein Montageblocker entsteht, wird sie verwendet; sonst gelten die kanonischen Schritte unverändert (im Plan als `canonical-only` vermerkt).

**Kameras:** Es gibt „schräg von vorn“, „schräg von hinten“ und die Draufsicht. Je Baukontext gilt eine feste Perspektive: die, in der über alle Schritte die wenigsten neuen Teile verdeckt sind. Bleibt ein neues Teil verdeckt (Strahltest gegen die Begrenzungsboxen des Bauzustands), kommt eine Draufsicht als Detailansicht hinzu. Wechsel von Baukontext, Blickrichtung oder Bildausschnitt werden im Schritt ausdrücklich angekündigt.

**Vormontage:** Die Ausleger werden isoliert gezeigt, mit eigenem Bildausschnitt und deutlich markierter Schrittkarte. Beim Einbau zeigt das Bild das Hauptmodell mit der Baugruppe leicht angehoben über ihrer Einbaustelle und einen Pfeil nach unten. Das ist genau der Steckweg, den der Montageprüfer als frei geprüft hat. Die Baugruppe erscheint dabei als **eine** Position („1× Vormontage …, nicht erneut entnehmen“); ihre Teile werden nicht noch einmal gezählt.

**Bilder:** Gerendert werden ausschließlich die Teilinstanzen des Modells mit LDraw-Geometrie, orthografisch und mit festem Bildausschnitt je Rahmen. Neue Teile erscheinen in voller Farbe mit dunklen Kanten, bereits verbaute Teile aufgehellt mit schwachen Kanten. Zusätzlich gibt es Markierungen, damit Farbe nicht das einzige Merkmal ist: Ein Pfeil nach unten erscheint nur bei geprüftem Steckweg von oben. Ein gestrichelter Ring markiert eine Position ohne geprüfte Richtung, zum Beispiel beim Ablegen.

## Konsistenz und Modellbezug

`checkInstructionPlan(plan, model)` und `tests/instructions.test.ts` prüfen Folgendes:

- Jede Instanz wird genau einmal als neu benötigt gezählt.
- Die Summe der Schrittmengen entspricht der Modellstückliste (`computeBom`).
- Vormontagen werden nicht doppelt gezählt.
- Kein Schritt nennt eine unbekannte Instanz.
- Die gezeigten Zwischenzustände entsprechen exakt dem Plan.
- Die verfeinerte Folge besteht den Montageprüfer.

Nach einer Modelländerung (Teil verschoben oder entfernt) bleibt die vorhandene Anleitung sichtbar, ist aber als **veraltet** markiert. Druck und PDF-Export sind dann gesperrt, bis die Anleitung für den neuen Modellstand erstellt ist. Modelle mit Blockern erhalten keine Anleitung. Bildschirm, Druckansicht und PDF verwenden dieselbe Datenbasis (`src/ui/instructions/document.ts`) und tragen Modell-ID, Version und Hash.

## Erprobter Stand (Raumschiffe: Palette Arrakis, 100–180 Teile)

Diese Werte werden nicht in die Anleitung geschrieben, sondern dort jeweils aus dem Modell abgeleitet. Sie sind hier nur zur Orientierung festgehalten.

| Modell | Teile | Anleitungsschritte (kanonisch → Anleitung) | PDF-Seiten |
| --- | --- | --- | --- |
| Kompakt | 109 | 19 → 28 | 17 |
| Langgestreckt | 140 | 17 → 32 | 19 |
| Breit | 138 | 19 → 31 | 18 |
| Referenz 40013-1 (OMR-Baufolge) | 18 | 7 → 7 | 6 |
| Referenz 21002-1 (Baufolge nach LEGO-Anleitung, 4 verschachtelte Vormontagen) | 77 | 29 → 30 | 21 |

## Entwurfsherkunft

Modelle können eine Entwurfsherkunft tragen (`CanonicalModel.design`, Schema `baustein-sim/design-provenance@1`). Dazu gehören die Quellen (z. B. ein Konzeptbild mit Prüfsumme und Rechteangabe, ohne die Bilddaten selbst), das Interpretationsverfahren, konstruktive Annahmen, bewusste Abweichungen vom Konzept und der Stand des visuellen Abgleichs. Die Herkunft geht in den Modellhash ein. Der Plan übernimmt sie unverändert, und Übersicht und PDF zeigen Annahmen und Abweichungen. Heute befüllt noch kein Erzeuger dieses Feld. Es ist der Anschlusspunkt für Bild-zu-Modell (`ARCHITEKTUR.md`, A18).

## Grenzen

- **Kein physischer Nachweis**: Die Anleitung ist digital abgeleitet und im unterstützten Umfang geprüft (gerade Steckwege, Geometrie, Kollisionen). Fingerzugang, Steckkraft, Toleranzen und Belastbarkeit sind nicht geprüft.
- **Positionsfindung**: Viele Teile sind 1×1- und 1×2-Platten derselben Farbe. Die Stellen ergeben sich nur aus Bild, Hervorhebung und Pfeil, nicht aus Koordinaten im Text. Geteilte Schritte nennen nur „Abschnitt k von n“.
- **Teilenamen**: Nur exakte Grundteile werden übersetzt (Stein, Platte, Fliese mit Maßen). Sonderformen wie Jumper, Steine mit Pin oder bedruckte Teile behalten ihren vollständigen LDraw-Titel, damit nichts verwechselt wird.
- **Schritttitel**: Schritttitel stammen aus der Quelle der Baufolge. Ohne Angabe nennt der Titel die Baugruppe, etwa „Base“ bei Referenzen.
- **Bildgröße**: Der Bildausschnitt bleibt je Rahmen fest, damit Lage und Maßstab stabil bleiben. In frühen Schritten eines großen Rahmens erscheinen die Teile daher klein. Am Handy werden die Bilder schmal.
- **Detailansicht**: Ob eine Draufsicht nötig ist, entscheidet ein Strahltest gegen Begrenzungsboxen. Er erkennt Verdeckung grob, nicht pixelgenau.
- **Druckansicht**: Die HTML-Druckansicht nutzt Druck-CSS (A4, keine geteilten Schrittkarten). Visuell geprüft wurde das PDF aus dem Export; die Ausgabe über den Druckdialog des Browsers wurde nicht auf Papier oder als Druck-PDF kontrolliert.
- **Schrift im PDF**: Das PDF verwendet die Standardschrift Helvetica. Zeichen außerhalb von Latin-1 werden ersetzt (z. B. Gedankenstrich → „-“, „≈“ → „ca.“).
- **Ohne Katalog**: Teilenummern und Farbnamen kommen aus LDraw, Teil-Farb-Belege bleiben ungeprüft. Elementnummern, Preise und Verfügbarkeit gibt es nie.
