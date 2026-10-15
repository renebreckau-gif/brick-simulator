# Roadmap

Langfristige Kette: **Idee → visueller Entwurf → Konstruktion aus realen Teilen → Prüfung → Bauanleitung → Beschaffung.** Späterer Anwendungsfall: ein Dune-inspiriertes Raumschiff mit gemeinsam festgelegter Teilezahl, Größe, Budget und Nutzungsprofil.

## Phase 1 (dieser Stand) – belegbarer Kern ✔

Kanonisches Modell, LDraw-Import, Katalog mit getrennten Eigenschaften, versionierte Anschlussregeln, Prüfschichten, Referenz- und Grenzfallkorpus, lokales Prüflabor, Exporte, Beschaffungsschema.

## Vorschlag für Auftrag 02 – Teileumfang und Daten absichern

1. Rebrickable-Nutzungsbedingungen klären. Mit eigenem API-Schlüssel die ID-Zuordnung über `external_ids` (LDraw/BrickLink) bestätigen.
2. Die OMR-Schrittgruppen der drei Referenzen mit den gedruckten Anleitungen abgleichen und die Quellenabweichungen auflösen.
3. Teileumfang erweitern: weitere Platten (2×N, 1×N), Fliesen, Dachsteine. Je Teil Metadaten anlegen und gegen LDraw abgleichen.
4. Erste Sonderregeln implementieren und mit Grenzfällen absichern: Unterseitenstift in Hohlnoppe, Stange in Halter.
5. Zylindrische Noppen statt Quader, um Fehlalarme in engen Lagen zu vermeiden.

## Spätere Phasen (nicht begonnen)

- **Entwurf**: Konzeptbilder ausdrücklich als „Konzept“ gekennzeichnet. Eine Modellansicht gilt nur, wenn sie aus einer konstruierten Version gerendert ist.
- **Konstruktionsvorschläge durch KI**: Vorschläge erzeugen nur kanonische Modelle; Gültigkeit entscheidet allein der Validator.
- **Baufolgenplaner**: automatische Reihenfolge mit Baugruppenbildung; gegen die bekannten Baufolgen messen.
- **Anleitungen**: Schrittbilder aus der Modellversion, später PDF.
- **SNOT, Technic, Scharniere**: erst wenn Regeln implementiert und mit Grenzfällen belegt sind.
- **Beschaffung**: Provider (z. B. BrickLink Store API) mit echten Angeboten und Prüfzeitpunkt, Abzug des eigenen Bestands. Substitutionen lösen eine erneute Prüfung von Konstruktion, Anleitung und Stückliste aus.
- **Kalibrierung**: physische Prüfprotokolle (siehe `PHYSISCHE-PRUEFPROTOKOLLE.md`).
- **Raumschiff-Projekt**: Randbedingungen (Teilezahl, Größe, Budget, Nutzung) als Profil, dann Entwurf → Konstruktion → Prüfung.

Ausdrücklich **nicht** in Phase 1: Text-zu-Modell, allgemeine Physiksimulation, Mechanismenbibliothek, PDF-Anleitungen, automatische Bestellung.
