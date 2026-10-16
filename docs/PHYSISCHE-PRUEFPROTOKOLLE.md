# Physische Prüfprotokolle (für spätere Kalibrierung)

**Status: Es wurden keine physischen Tests durchgeführt.** Dieses Dokument legt nur fest, wie spätere Tests ablaufen sollen, damit ihre Ergebnisse den heuristischen Befunden zugeordnet werden können.

## Grundsätze

- Jeder Test bezieht sich auf genau eine Modellversion: Modell-ID, Version, Inhalts-Hash, gespeicherter Modell-Export (JSON) und Prüfbericht (JSON).
- Echte Teile mit Herkunft (Set, Kauf, Zustand neu/gebraucht). Abweichungen von der Stückliste werden protokolliert.
- Ein Durchgang wird nicht für eine allgemeine Aussage verwendet. Mindestens 5 Wiederholungen je Szenario, mit Streuung.

## Protokoll P1 – Referenzaufbau

1. Modell nach der exportierten Baufolge bauen; jede Abweichung (Reihenfolge, Hilfe, Probleme) notieren.
2. Je Schritt festhalten: Steckweg möglich (ja/nein), Handunterstützung nötig (ja/nein), Zwischenzustand steht (ja/nein).
3. Mit den Montagebefunden des Berichts vergleichen (bestätigt, heuristisch oder ungeprüft).

## Protokoll P2 – Definierte Handhabung

Die Szenarien entsprechen `handlingScenarios` im Modell:

| ID | Ablauf | Messgröße |
|---|---|---|
| H1-lift | an der Basis 10 cm anheben, abstellen | gelöste Teile (welche, wie viele) |
| H2-tilt | Unterlage in 1°-Schritten neigen (Neigungsmesser) | Winkel beim Kippen bzw. Rutschen |
| H3-carry | an der höchsten Stelle tragen, 2 m gehen | gelöste Teile, Stelle des Versagens |

## Protokoll P4 – Aufbau nach der erzeugten Bauanleitung (Raumschiff)

Grundlage ist das PDF aus dem Bereich „Bauanleitung“. Modell-ID, Version, Modellhash und Planversion stehen im PDF; sie werden zum Protokoll notiert und müssen zum exportierten Modell-JSON passen. Je Anleitungsschritt wird erfasst:

| Beobachtung | Erfassung |
|---|---|
| Teile gefunden | Ließen sich alle Teile der Schrittübersicht anhand von Bild, Teilenummer und Farbe eindeutig zuordnen? Verwechslungen notieren (z. B. Dark Tan ↔ Tan, 3023 ↔ 3024). |
| Position verstanden | Wurde die Einbaustelle aus dem Hauptbild erkannt (ja / nur mit Detailansicht / nein)? Bei „nein“: welche Teile, was war unklar (Verdeckung, Bildgröße, gleiche Farben)? |
| Einsetzrichtung | Ließ sich jedes Teil wie angegeben senkrecht von oben aufstecken? Abweichungen (gekippt, seitlich, Nacharbeit) mit Instanz-ID notieren. |
| Handunterstützung | Wo nötig, und deckt sich das mit den Hinweisen? Zusätzliche Stellen notieren. |
| Zwischenzustand | Steht und hält der Bauzustand nach dem Schritt? Lose Teile oder Teilgruppen notieren. |
| Ansichtswechsel | Wurde jeder angekündigte Wechsel (Vormontage, Bildausschnitt) bemerkt und verstanden? |
| Vormontage | Hält die Ausleger-Baugruppe beim Anheben zusammen? Greifen beim Aufsetzen alle Noppen gleichzeitig? Wie viel Druck war nötig (gering/mittel/hoch)? |
| Fehler und Rückbau | Musste etwas wieder gelöst werden? Bei welchem Schritt wurde der Fehler bemerkt? |
| Zeit | Dauer je Schritt (min), Gesamtdauer, Pausen. |
| Stückliste | Stimmt die Endkontrolle mit der vollständigen Stückliste überein (fehlende Teile, übrige Teile)? |

Zusätzlich: Druckmedium (Papier oder Bildschirm), Lesbarkeit der kleinsten Beschriftung, Qualität der Farbunterscheidung im Ausdruck (Farbe oder Graustufen).

Auswertung: Unverständliche Schritte gehen als Verbesserungsbedarf an den Anleitungsplan (Kamera, Abschnittsgröße, Detailansicht). Montageprobleme werden mit den Montagebefunden des Prüfberichts verglichen. Ein gelungener Aufbau bestätigt nur die Machbarkeit dieses einen Aufbaus, keine Belastbarkeit.

## Protokoll P3 – Ergebnisse

Je Durchgang festhalten:

- Datum
- Person
- Modell-Referenz (ID, Version, Hash)
- Teileherkunft
- Szenario
- Messwerte
- Fotos
- Abweichungen

Ablage später unter `data/physical-tests/` als JSON mit Schema-Version.

## Kalibrierung

Erst wenn genug Protokolle vorliegen, dürfen heuristische Indikatoren (Kippwinkel, schwächster Schnitt, Ein-Noppen-Anbau) mit Messwerten verglichen und gegebenenfalls kalibriert werden. Bis dahin bleibt ihre Evidenzstufe „heuristisch“.
