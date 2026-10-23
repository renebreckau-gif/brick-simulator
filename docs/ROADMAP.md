# Roadmap

Langfristige Kette: **Idee → visueller Entwurf → Konstruktion aus realen Teilen → Prüfung → Bauanleitung → Beschaffung.** Späterer Anwendungsfall: ein Dune-inspiriertes Raumschiff mit gemeinsam festgelegter Teilezahl, Größe, Budget und Nutzungsprofil.

## Phase 1 (dieser Stand) – belegbarer Kern ✔

Kanonisches Modell, LDraw-Import, Katalog mit getrennten Eigenschaften, versionierte Anschlussregeln, Prüfschichten, Referenz- und Grenzfallkorpus, lokales Prüflabor, Exporte, Beschaffungsschema.

## Vorschlag für Auftrag 02 – Teileumfang und Daten absichern

1. Rebrickable-Nutzungsbedingungen klären. Mit eigenem API-Schlüssel die ID-Zuordnung über `external_ids` (LDraw/BrickLink) bestätigen.
2. Die OMR-Schrittgruppen der drei Referenzen mit den gedruckten Anleitungen abgleichen und die Quellenabweichungen auflösen – 21002-1 abgeglichen (02B); 40013-1 und 1869-1 offen (keine Herstellerquelle); Jumper-Variante teilweise, Druckteil offen.
3. Teileumfang erweitern: weitere Platten (2×N, 1×N), Fliesen, Dachsteine. Je Teil Metadaten anlegen und gegen LDraw abgleichen.
4. Erste Sonderregeln implementieren und mit Grenzfällen absichern: Unterseitenstift in Hohlnoppe ✔ (02B, nur 3004 auf 6541); Stange in Halter offen.
5. Zylindrische Noppen statt Quader, um Fehlalarme in engen Lagen zu vermeiden.

## Auftrag 03 – erstes eigenes Raumschiff ✔

Parametrischer, deterministischer Generator (`spaceship-gen@1.0.0`) mit drei Varianten, Raumschiff-Labor in der Oberfläche, erzeugte und geprüfte Baufolge, Protokoll für einen späteren physischen Probeaufbau (siehe `RAUMSCHIFF.md`). Nächste sinnvolle Schritte: Dachsteine und Keile mit belegten Regeln (Schrägen), physischer Probeaufbau der langgestreckten Variante, danach Einkaufsintegration und freie Text-zu-Modell-Generierung.

## Auftrag 04 – Bauanleitung ✔

Versionierter Anleitungsplan, Bereich „Bauanleitung“ mit Schrittnavigation, Druckansicht und PDF-Export für die drei Standardvarianten; Protokoll P4 für den späteren Probeaufbau nach Anleitung. Die Anleitung arbeitet für jedes kanonische Modell ohne Blocker mit Baufolge, nicht nur für Raumschiffe. Parallel möglich: physischer Probeaufbau der langgestreckten Variante nach P4.

## Auftrag 05A – Bildvorlage → bestätigter Entwurfsauftrag ✔

Bereich „Aus Bild entwerfen“ mit Upload und Inhaltsprüfung, Analyse über die Claude API (eingerichtet, aber mangels Schlüssel noch nicht live ausgeführt) oder manuell. Dazu kommen Korrektur, Anforderungen und ein versionierter, bestätigbarer Entwurfsauftrag (siehe `BILDENTWURF.md`).

## Auftrag 05B.0 – räumlicher Entwurf ✔

Volumenmodell aus einfachen Körpern mit gemeinsamem Koordinatensystem. Dazu gehören eine 3D-Ansicht und sechs orthografische Ansichten aus derselben Geometrie, ein lokaler Vorschlag aus der Interpretation, ein optionaler Dienstvorschlag (nicht live geprüft) sowie Bearbeiten, Prüfen und Bestätigen der Form (siehe `RAUMENTWURF.md`).

## Auftrag 05B.1 – erster Konstruktionsnachweis aus realen Steinen ✔

Bug und Kanzel aus einer gemessenen Formvorgabe, zwei Bautechniken (Keilplatten, Schrägsteine) bei 6 und 8 Noppen Breite. Neue Formteile mit exakten Prismenkörpern, sechs Ansichten derselben Instanzen neben der Vorlage, Umrissvergleich, Anleitung und Stückliste über die vorhandene Kette (siehe `KONSTRUKTIONSNACHWEIS.md`). Nächste Schritte:

- Mischtechnik: Keilplattenkontur als Rumpf, Schrägsteine als Deckprofil.
- Weitere Abschnitte (Rumpf, Gondeln) und deren Verbindung.
- Live-Ansichtserkennung im erweiterten Format; sie ist kostenpflichtig und braucht eine Freigabe.

## Auftrag 05B – bestätigten Entwurf in echte Bausteine konstruieren (Fortsetzung)

1. Konstrukteur, der einen bestätigten räumlichen Entwurf (samt Entwurfsauftrag) liest: Baugruppen, relative Größen, Farben, Prioritäten, Teilebudget und Höchstmaße. Er erzeugt ein `CanonicalModel` mit `design` aus `toDesignProvenance` und einer Baufolge.
2. Abbildung der Proportionen auf das Noppenraster innerhalb der Höchstmaße; Farbabbildung auf belegte LDraw-/Katalogfarben. Jede Abweichung kommt nach `design.deviations`.
3. Prüfung mit dem unveränderten Validator; Bauanleitung und Stückliste über die vorhandene Kette.
4. Visueller Abgleich: Rendering des Modells gegen die Bildbereiche der Vorlage.
5. Voraussetzung für überzeugende Ergebnisse: weitere Teilefamilien mit belegten Regeln (Dachsteine und Keile für Schrägen, später SNOT und Scharniere).

## Gesamtkette Bild zu Modell (Überblick; Schritt 1 und Teile von Schritt 2 mit 05A umgesetzt)

Ziel: Aus einem hochgeladenen Konzeptbild entsteht ein kanonisches Modell aus realen Teilen, das danach dieselbe Kette durchläuft: Validierung, visueller Abgleich, Bauanleitung, Teileliste (siehe `ARCHITEKTUR.md`, A18). Vorgeschlagene Reihenfolge:

1. Bildaufnahme mit Prüfsumme, Rechteangabe und `design.sources`. Das Bild bleibt außerhalb des Modells und wird nicht veröffentlicht.
2. Einfache räumliche Interpretation für eine eng begrenzte Bildklasse (z. B. Seitenansicht eines symmetrischen Objekts). Annahmen werden ausdrücklich in `design.assumptions` festgehalten.
3. Konstruktion aus dem bestehenden, geprüften Teileumfang. Abweichungen kommen nach `design.deviations`; fehlende Formen (Schrägen, Rundungen) werden ehrlich ausgewiesen.
4. Visueller Abgleich zwischen Bild und Rendering. Das Ergebnis ist ein Hinweis, kein Gültigkeitsnachweis.
5. Bauanleitung und Teileliste ohne Sonderpfad aus dem vorhandenen System.

## Spätere Phasen (nicht begonnen)

- **Entwurf**: Konzeptbilder ausdrücklich als „Konzept“ gekennzeichnet. Eine Modellansicht gilt nur, wenn sie aus einer konstruierten Version gerendert ist.
- **Konstruktionsvorschläge durch KI**: Vorschläge erzeugen nur kanonische Modelle; Gültigkeit entscheidet allein der Validator.
- **Baufolgenplaner**: automatische Reihenfolge mit Baugruppenbildung; gegen die bekannten Baufolgen messen.
- **Anleitungen**: Schrittbilder aus der Modellversion, später PDF.
- **SNOT, Technic, Scharniere**: erst wenn Regeln implementiert und mit Grenzfällen belegt sind.
- **Beschaffung**: Provider (z. B. BrickLink Store API) mit echten Angeboten und Prüfzeitpunkt, Abzug des eigenen Bestands. Substitutionen lösen eine erneute Prüfung von Konstruktion, Anleitung und Stückliste aus.
- **Kalibrierung**: physische Prüfprotokolle (siehe `PHYSISCHE-PRUEFPROTOKOLLE.md`).
- **Raumschiff-Projekt**: erste Stufe mit Teilezahl und Größe umgesetzt (Auftrag 03); Budget und Nutzungsprofil folgen mit der Beschaffung.

Ausdrücklich **nicht** in Phase 1: Text-zu-Modell, allgemeine Physiksimulation, Mechanismenbibliothek, PDF-Anleitungen, automatische Bestellung.

## Auftrag 05C.1 – allgemeine Teile- und Anschlussbibliothek ✔ (PR offen)

Vollständige LDraw-Bibliothek als Index, Anschlüsse aus LDCad Shadow Library und BrickNet, Suche, Abdeckungsbericht – siehe `TEILEBIBLIOTHEK.md`. Nächster Schritt 05C.2 „Bauwissen aus digitalen Modellen“ (Empfehlung dort, Abschnitt 8; noch nicht begonnen).

## Auftrag 05C.1.1 – Verlässlichkeit der Teilebibliothek ✔ (PR offen)

Farbbelege nur aus belegter Identität, gemeinsame Identitätsauflösung mit dem Prüfkern (3023b), getrennte Bezugsgrößen und eindeutige Set-Gewichte, Datenlader mit Laufzeitprüfung, plattformunabhängiger Import (Ursache der Linux-Abweichung: MSVC-pow), Wiederherstellung des festgelegten LDraw-Stands – siehe `TEILEBIBLIOTHEK.md`, Abschnitt 9. 05C.2 noch nicht begonnen.
