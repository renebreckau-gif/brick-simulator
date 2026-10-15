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

Versionierter Anleitungsplan, Bereich „Bauanleitung“ mit Schrittnavigation, Druckansicht und PDF-Export für die drei Standardvarianten; Protokoll P4 für den späteren Probeaufbau nach Anleitung. Nächste sinnvolle Schritte: physischer Probeaufbau der langgestreckten Variante nach P4, danach Verbesserung der Anleitung anhand der Beobachtungen.

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
