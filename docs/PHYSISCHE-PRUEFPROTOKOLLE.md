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
