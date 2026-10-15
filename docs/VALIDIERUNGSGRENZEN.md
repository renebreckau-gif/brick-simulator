# Validierungsgrenzen

Was der Prüfkern in Phase 1 kann, was er vereinfacht und wo er irren kann.

## Unterstützter Umfang

- **Teile**: 18 voll unterstützt (3001, 3002, 3003, 3004, 3005, 3009, 3010, 2456, 3023, 3024, 3030, 3032, 3069b, 3070b, 4162, 4162p0b, 6636, 3794a), 2 teilweise (6541, 2458), 2 nur mit grober Hülle (59900, 30374). Alles andere hat Simulation „none“.
- **Verbindungen**: Noppe ↔ Aufnahme und Noppe ↔ Röhre, gerade und achsparallel. Teile müssen in 90°-Schritten ausgerichtet sein.
- **Erfasst, aber nicht implementiert** (ergibt „ungeprüft“ bzw. „nicht unterstützt“):
  - Technic-Pin, -Loch und -Achse
  - Stange in Halter oder Hohlnoppe
  - Unterseitenstift in Hohlnoppe
  - Clips und Scharniere
  - seitliche Noppen (SNOT)
  - flexible Teile
  - frei gedrehte Teile

## Vereinfachungen (konservativ)

- **Kollision**: Körper als achsparallele Quader, Noppen als Quader 12 × 12 × 4 LDU. Der Quader ist etwas größer als der Zylinder, die Prüfung also eher strenger. Hohlräume sind nur als Noppenaufnahmen modelliert: Ein Teil, das in den Hohlraum eines anderen ragt (außer über Noppen), gilt als Durchdringung. Seitlich überstehende Pins (2458) sind nicht im Volumen enthalten.
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
