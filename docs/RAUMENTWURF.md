# Räumlicher Entwurf (Auftrag 05B.0)

**Räumlicher Entwurf – noch keine Steine, Baubarkeit ungeprüft.**

Zwischenstufe zwischen bestätigter Bildinterpretation und späterer Bausteinkonstruktion. Der räumliche Entwurf beschreibt das Objekt aus wenigen einfachen Körpern in einem gemeinsamen Koordinatensystem. Alle Ansichten entstehen aus genau dieser Geometrie:

- die frei drehbare 3D-Ansicht (Three.js),
- die sechs orthografischen Ansichten (vorne, hinten, links, rechts, oben, unten),
- der Vergleich mit einer Referenzansicht.

Es gibt keine separat erzeugten oder KI-generierten Ansichten. Damit ist das ursprüngliche Problem behoben, dass einzeln generierte Ansichten des Sandwächters widersprüchliche Proportionen hatten.

Der Entwurf enthält keine Teilinstanzen. Er wird über `CanonicalModel.design.spatial` mit einem späteren Modell verknüpft.

## Koordinatensystem und Maßstab

- **Achsen:** `+x` = vorn, `+y` = links (aus Sicht des Objekts), `+z` = oben. Das System ist rechtshändig.
- **Maßstab:** Länge des Hauptkörpers = 1, auf allen drei Achsen gleich. Breite und Höhe sind echte Verhältnisse zu dieser Länge; keine Achse wird einzeln auf 1 normiert.
- **Reale Größe:** unbekannt. Ein Maßstab (Hauptkörperlänge in Noppen) ist eine **Zielvorgabe des Nutzers**, kein Messwert. Erst mit Maßstab werden die Höchstmaße des Entwurfsauftrags geprüft. Dabei gilt 1 Steinhöhe = 1,2 Noppenraster.
- **Körper:**
  - Quader
  - Keil: hinten volle Höhe, vorn „Verjüngung × Höhe“
  - Zylinder: entlang der Länge, elliptischer Querschnitt
  - verjüngter Körper: Vorderfläche skaliert
  - Je Körper gibt es Mittelpunkt, Maße und Drehung (Gieren/Nicken/Rollen in Grad, R = Rz·Ry·Rx), Farbe, Bezug zur Baugruppe der Interpretation, Annahmen und Unsicherheit.
- **Grundlage je Angabe:**
  - „aus Bild geschätzt“ (perspektivisch, kein Geometriebeleg)
  - „angenommen“
  - „vom Nutzer gesetzt“
  - „Beobachtet“ gibt es hier bewusst nicht: Auch eine KI-Schätzung ist kein Geometriebeleg.

## Wie der lokale Vorschlag entsteht

Die Aktion **„Räumlichen Entwurf erstellen“** arbeitet lokal und sendet keine Daten. Im Entwurf heißt das Verfahren *„Lokale Ableitung (Bildbereiche der Hauptreferenz + relative Größen der Interpretation; keine 3D-Erkennung)“*. Die Ableitung (`deriveSpatialProposal`) läuft so:

1. **Hauptreferenz:** Standardmäßig ist das das ganze erste Bild. Einschübe einer Collage lassen sich als eigene Referenzansicht mit Richtung angeben, etwa „von hinten“. Sie zeigen dasselbe Objekt und erzeugen keine zusätzliche Baugruppe. Ihre Bildbereiche bestimmen keine Lage.
2. **Hauptkörper:** Länge 1. Was sich aus dem Bild schätzen lässt, hängt von der Ansicht ab; jede Lücke erscheint als offene Frage.
   - Seiten- oder Schrägansicht: Höhe aus dem Seitenverhältnis seines Bildbereichs; Breite 0,5 angenommen.
   - Front- oder Heckansicht: Breite 0,5 angenommen, Höhe im Verhältnis dazu.
   - Drauf- oder Untersicht: Höhe 0,4 angenommen.
3. **Lage der Baugruppen:** Die Lage in Bildrichtung (längs und in der Höhe) kommt aus dem Mittelpunkt des größten Bildbereichs in der Hauptreferenz, relativ zum Hauptkörper und in Hauptkörperlängen. Die Tiefe senkrecht zum Bild ist unbekannt und wird als mittig angenommen.
4. **Größen:** „relative Größe der Interpretation × Hauptkörpermaß“. Das sind Schätzungen der Interpretation, keine Messungen.
5. **Paare:**
   - Zwei Baugruppen gleicher relativer Größe werden nur dann seitlich gespiegelt angeordnet und gekoppelt, wenn die Interpretation Links-rechts-Symmetrie nennt.
   - Das ist eine **Symmetrieannahme**, kein Beleg dafür, dass beide Seiten im Original gleich sind.
   - Ein gekoppeltes Spiegelbild trägt immer die Grundlage „angenommen“. Die Kopplung lässt sich lösen.
6. **Form:** Jeder Körper beginnt als **neutraler Quader**. Aus Namen oder Wörtern wird keine 3D-Form abgeleitet. Erwähnt die Beschreibung eine Form (etwa „rund“), erscheint das nur als Hinweis zur Prüfung.
7. **Details:** Baugruppen mit der Rolle „Detail“ werden nicht als Körper übernommen. Alle Baugruppen ohne Körper stehen ausdrücklich unter **„Noch nicht räumlich modelliert“**. Ein Name in der Liste ist kein dargestellter Körper.

Ohne API-Zugang bleibt dieser Weg vollständig nutzbar. Fehlende räumliche Angaben erscheinen als offene Fragen und lassen sich numerisch korrigieren.

### Optionaler Vorschlag durch den Analysedienst

`POST /api/design/spatial` sendet Bilder **und** die geprüfte Interpretation erneut an den Dienst. Das geschieht nur nach einem Einwilligungsdialog, der genau nennt, was gesendet wird. Es gibt genau einen Aufruf, keine automatische Wiederholung und keinen Aufruf bei Reglerbewegungen.

Die Antwort wird geprüft: Format, bekannte Baugruppen, genau ein Hauptkörper und positive Maße. Die Zuordnung läuft über ein Ticket, das an Auftrag, Grundlage (Bilder, Interpretation, Höchstmaße) und Entwurfsstand gebunden ist:

- Bei geänderter Grundlage wird die Antwort verworfen.
- Bei Nutzerkorrekturen oder einem zwischenzeitlich geänderten Entwurf wird sie zurückgehalten und nur ausdrücklich übernommen.

**Stand:** Der Weg ist mit einem Testanbieter geprüft, live aber **nicht** aufgerufen worden, weil kein zusätzlicher kostenpflichtiger Aufruf beauftragt war.

## Bearbeiten, Prüfen, Bestätigen

- **Bearbeiten:**
  - Körper per Liste, 3D-Ansicht oder einer der sechs Ansichten auswählen.
  - Numerisch ändern: Lage, Länge, Breite, Höhe, Orientierung, Form, Farbe und Verjüngung. Jede Änderung ist sofort in allen Ansichten sichtbar.
  - Rückgängig und Wiederholen gibt es auch per Strg+Z bzw. Strg+Y; jede Wiederherstellung ist eine neue Version.
  - Gekoppelte Spiegelbilder laufen mit (y gespiegelt, Gieren und Rollen mit umgekehrtem Vorzeichen) und lassen sich nicht direkt verschieben.
- **Gemeinsamer Maßstab:** Alle sechs Fenster nutzen denselben Maßstab, den größten, der überall passt. Ein Maßstabsbalken von 0,25 Hauptkörperlängen zeigt ihn an.
- **Vergleich:** Referenzausschnitt und Modellprojektion der gleichen Richtung stehen nebeneinander. Eine Überlagerung gibt es nicht; sie bräuchte eine ausdrücklich eingestellte Kamera. Perspektivische Bilder sind keine orthografische Messgrundlage. `compareWithReferences` nennt grobe Abweichungen (Seitenverhältnis Faktor > 1,5, vertauschte Seiten) in Ansichten mit bekannter Richtung.
- **Prüfung (`checkSpatial`):**
  - Maße positiv und endlich, Lage endlich, Drehung in ±180°, Verjüngung 0–1
  - eindeutige Kennungen, genau ein Hauptkörper mit Länge 1, gültige Baugruppen- und Bildbezüge
  - konsistente Spiegelkopplung, die nur bei vorgegebener oder angenommener Symmetrie erlaubt ist
  - Zielmaße, falls ein Maßstab gesetzt ist
  - Überlappende oder getrennte Körper sind **kein Befund**: Es sind keine Bausteine.
- **Bestätigung:** „Räumliche Form bestätigen“ bestätigt nur die Form, weder Stabilität noch Montage noch Kaufverfügbarkeit. Jede Änderung macht die Bestätigung veraltet.
- **Veraltung:**
  - Änderungen an Bildern, Ansichten, Interpretation oder Höchstmaßen markieren den Entwurf sichtbar als veraltet. Inhalt und Korrekturen bleiben, nichts wird überschrieben.
  - Teilezahl und Nutzung ändern die Form nicht.
  - „Für den aktuellen Entwurfsauftrag neu bewerten“ übernimmt den Stand protokolliert.
- **Speichern:** IndexedDB (eigener Schlüssel `spatial`; der Entwurfsauftrag bleibt unverändert).
  - Export und Import als `*.raumentwurf.json` mit vollständiger Prüfung (JSON → Schema → Hash → Fachregeln).
  - Unstimmige Dateien werden nur zur Korrektur geladen, die Bestätigung wird dabei aufgehoben.
  - Die Dateien sind von Git ausgeschlossen, und der öffentliche Build weist sie ab.

## Verdeckung und 3D-Ressourcen (Korrekturauftrag 05B.0.1)

- **Verdeckung je Bildpunkt:** Die orthografischen Ansichten nutzen einen Tiefenpuffer (`src/core/design/raster.ts`).
  - Je Bildpunkt gewinnt die tatsächlich nächste Fläche.
  - Die frühere Sortierung ganzer Körper nach ihrem größten Kameraabstand war falsch. Beispiel: Ein Quader vor der Schräge eines größeren Keils wurde übermalt, weil der Keil hinten weiter nach vorn reicht.
  - Gemeinsamer Maßstab, Mittelpunkt, Achsen und Ansichtsrichtungen sind unverändert.
  - Die Auswahl per Klick liest denselben Puffer, wählt also immer den sichtbaren Körper.
  - Flächennormalen werden nach Newell über alle Ecken berechnet. Damit bleiben auch die Seitenflächen spitzer Keile (zusammenfallende Ecken) erhalten.
- **3D-Ansicht:** Die 3D-Objekte werden je Körper verwaltet (`src/ui/design/spatialMeshes.ts`).
  - Bei Farbe oder Auswahl werden sie wiederverwendet.
  - Bei geänderter Form oder Lage werden sie ersetzt und freigegeben: Flächengeometrie, Kantengeometrie und beide Materialien.
  - Beim Abbau werden auch OrbitControls, Zeiger-Listener, ResizeObserver, Achsen, Raster, Lichter, Renderer und WebGL-Kontext freigegeben.

## Nachweis

- **Projektionstests (`tests/spatial-sollwerte.test.ts`):** Ein asymmetrischer Testkörper mit Rumpf, Bug, nur links angebrachter Gondel und Turm wird gegen **von Hand berechnete Sollwerte** geprüft:
  - Außenmaße inklusive Anbauten 1,3 × 0,75 × 0,4
  - Ausdehnung je Ansicht
  - Seite der Gondel in allen sechs Ansichten
  - Spiegelung, auch mit Gieren ±30°
  - Änderungen an Länge, Breite und Gondelposition, die genau in den betroffenen Ansichten erscheinen
- **Verdeckung (`tests/spatial-raster.test.ts`):** sichtbare Flächen je Bildpunkt, verglichen mit einem unabhängigen Strahltest (Halbräume der konvexen Körper). Geprüft werden der Keil/Quader-Fall in allen sechs Ansichten, teilweise verdeckte und gedrehte Körper sowie die Auswahl des sichtbaren Körpers. Freigabe der 3D-Ressourcen: `tests/spatial-meshes.test.ts`.
- **Geometrie (`tests/spatial-projection.test.ts`):** Jede Ansicht ist eine echte Drehung ohne Spiegelung, die Achsabbildung ist für alle Körper gleich, dazu gemeinsamer Maßstab, Tiefenreihenfolge und Körperformen.
- **Fachlich (`tests/spatial-design.test.ts`, `tests/spatial-endpoint.test.ts`):** Ableitung, Einschübe, Symmetrie, Prüfregeln, Versionierung, Veraltung, Import, Erhalt älterer Entwurfsaufträge und verspätete Antworten.
- **Korrigierte Erwartung „22 Noppen“:**
  - Im synthetischen Entwurf reicht der Anbau „Kasten links“ bis x = 0,875: Bildversatz (0,125 − 0,5) / 0,6 = −0,625 Hauptkörperlängen, Vorderseite links, also x = +0,625, plus halbe Länge 0,25.
  - Die Gesamtlänge ist damit 1,375 und bei 16 Noppen je Hauptkörperlänge 22 Noppen. Der Test belegt das einzeln.
- **Sandwächter (Browser, getrennte Testablage, keine neue API-Anfrage):** Auf Basis der Live-Interpretation aus 05A.4 waren alle sechs Ansichten im Browser pixelgenau konsistent. Länge, Breite und Höhe wurden in jeweils vier Ansichten nachgemessen, mit gleichem Maßstab.

## Grenzen

- Aus einem einzelnen, perspektivischen Bild sind Tiefe, verdeckte Formen und Innenkonstruktion nicht ableitbar. Alle Lagen sind Schätzungen oder Annahmen.
- Die Körperformen sind grob. Rundungen, Facetten, Schrägen und bewegliche Teile werden nur angenähert oder gar nicht dargestellt.
- Die Abweichungsprüfung gegenüber Referenzansichten ist ein grober Hinweis, keine Messung.
- Es wird nichts über Steine, Steckverbindungen, Stabilität, Montage oder Beschaffbarkeit ausgesagt.
