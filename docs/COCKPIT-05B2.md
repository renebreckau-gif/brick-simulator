# Variante C – Bug mit zugänglichem Cockpit (Auftrag 05B.2, Zwischenstand)

Stand: gesichert vor Beginn von Auftrag 05C.1. Technisch geprüft; Dokumentation und Pull Request sind noch nicht abgeschlossen (siehe „Offen“).

## Umgesetzt

- **Formvorgabe** um Unterkante (`bottom`) und gemessenes Kanzelprofil (`canopy.profile`) erweitert.
  - Die Unterkante stammt aus der Seitenansicht; Landebeine werden per morphologischem Öffnen entfernt (8 % L).
  - Ober- und Unterkante beziehen sich auf den tiefsten Rumpfpunkt.
- **Funktionsmodell** `model.functional`:
  - freizuhaltende Volumen,
  - abnehmbare Baugruppen,
  - Anschlussnoppen.
  
  Die neue Prüfschicht „Funktion“ (`checkFunction.ts`) prüft sie: Freiraum gegen Körper und Noppen, gerade Entnahme (Verbindungsrichtung, Zusammenhalt, gefegter Weg) und freie Anschlussnoppen.
- **Bautechnik C** (`cockpitTechnique.ts`, Breite 8 aus der Vorlage gewählt):
  - Aufbau: Boden über die volle Breite, Wände, Ringanker, Keilsegmente in jeder zweiten Lage, angehobene Nase (inverse Schrägsteine 3747b), Nasenoberkante mit 3298.
  - Kanzel als separat gebaute, nach oben abnehmbare Baugruppe: Windschutzscheibe 2437, Glas-Steine 3066/3065, Rahmen, Dach, Verbindungsplatten 3023 in Trans-Brown.
  - Massivbau gleicher Außenform zum Vergleich.
  - Die Cockpitlänge ist als Funktionsanforderung änderbar.
- **Neue Teile mit geprüfter Geometrie** (in beide Richtungen gegen LDraw getestet):
  - 2437 als konvexe Hüllkörper je Teilbereich (`bodyHulls`),
  - 3747b, 41767/41768 (Keilsteine), 3034, 3068b, 3065, 3066.
- **Belege** (`data/procurement/evidence-05b2.json`, nur Repository und Entwicklungsserver, nicht im öffentlichen Build):
  - Je Teil-Farb-Kombination LEGO-Element-IDs (lokaler Rebrickable-Auszug) und ein konkretes BrickLink-Angebot: neu, Händler in Deutschland, Versand nach Deutschland, Menge, Preis, Zeitpunkt 2026-10-23 UTC.
  - Massen sind BrickLink-Katalogangaben.
  - Die Mengenabdeckung prüft `coverageFor`: Angebote nicht doppelt gezählt, unbekannt = nicht verfügbar.
- **Oberfläche:**
  - Variante C mit Hohl- oder Massivbau und Cockpitlänge.
  - 3D-Ansicht mit Längsschnitt, abgehobener Kanzel und gestrichelten Hilfsvolumen.
  - Ansicht „Varianten A · B · C“ mit Bugoberkante, Bugunterkante und Kanzel getrennt.
  - Belege und Angebote je Stücklistenposition, Massenvergleich.

## Ergebnis an der Vorlage (8 Noppen, lokal geprüft)

| | A | B | C |
|---|---|---|---|
| Teile | 184 | 61 | 65 |
| Blocker / Warnungen | 0 / 2 | 0 / 2 | 0 / 0 |
| Bugoberkante (mittlere/größte Abw.) | 0,7 / 2,3 | 7,1 / 8,0 | 1,2 / 2,0 Platten |
| Bugunterkante | 1,5 / 5,4 | 1,5 / 5,4 | 0,9 / 2,1 Platten |
| Kanzel | 0,9 / 2,5 | 3,3 / 6,1 | 2,2 / 4,8 Platten |
| Innenraum | – | – | 4 × 7 Noppen, 12,5 + 4 Platten |
| Masse (Katalog) | nicht schätzbar | nicht schätzbar | ≈ 104 g (massiv ≈ 160 g) |
| Beschaffung belegt | nein | nein | alle Positionen |

- **Breitentest Variante C:** 648 Formvorgaben (Breiten 6/8/10, hohl/massiv, zwei Öffnungslängen) ergeben 0 Blocker. Davor waren es 511 und später 44; behoben wurden Nasenschrägen ohne Halt, Keilsäulen ohne Verbund, Auskragung des Ringankers und Bodenfugen.
- **Visuell:**
  - Der Grundriss läuft spitz zu und die Nase ist unten angehoben.
  - Die Kanzel bleibt kastenförmig: 2437 steigt in einer Reihe an, die Vorlage über etwa fünf.
  - Ein flacheres Kanzelteil in Trans-Brown mit Steckbefestigung ist nicht belegt. 87752 hat zwar die passende Form, hält aber nur über Griff und Clip; diese Regel ist nicht implementiert, Montage und Entnahme wären also ungeprüft.

## Offen

- Ausführliche Dokumentation, Validierungsgrenzen, Variantenbewertung und Pull Request.
- Physische Belastbarkeit: nicht erprobt.
- Angebote sind zeitgebunden und vor einer Bestellung erneut zu prüfen; es wurde nichts bestellt.
