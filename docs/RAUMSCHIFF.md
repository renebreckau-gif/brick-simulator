# Raumschiff-Labor (Auftrag 03)

Erstes eigenes Modell des Simulators: ein kleines, kantiges Ausstellungsmodell eines Raumschiffs mit industriellem Charakter (angelehnt an die Formensprache von Dune, ohne ein bestimmtes Schiff nachzubilden). Es ist ein **eigener Entwurf**, kein offizielles LEGO-Modell und keine Referenz. Das Modell ist nur digital geprüft; ein physischer Aufbau hat **nicht** stattgefunden.

## Generatorprinzip

`src/generator/spaceship.ts` (Version `spaceship-gen@1.0.0`) erzeugt aus wenigen Eingaben deterministisch ein kanonisches Modell. Gleiche Eingaben ergeben in Node und im Browser dieselben Instanzen, dieselbe Baufolge und denselben Inhalts-Hash (in `tests/spaceship.test.ts` festgeschrieben). Eingaben und Generatorversion stehen im Modell (`model.generator`) und gehen in den Hash ein.

Ablauf:

1. **Raster**: Felder von 20 LDU (eine Noppe) und Schichten von 8 LDU (eine Platte). Teile werden nur von oben auf freie Noppen gesetzt; ein Belegungsraster verhindert Überschneidungen schon beim Erzeugen. Die eigentliche Prüfung macht danach unabhängig der vorhandene Validator.
2. **Rumpf** (Modul *Rumpf*): Bodenplatten 4×10/4×6, darauf zwei durchgehende Steinlagen und zwei weitere Lagen nur als vorderer Cockpit-Turm und hinterer Antriebsblock. Dazwischen liegt eine niedrige Taille, in der die Ausleger sitzen (gestufte Silhouette).
3. **Verband**: Jede Steinreihe wird so aufgeteilt, dass keine Stoßfuge über einer Fuge der Lage darunter liegt. Ist das nicht möglich, lockert der Generator die Regel in festen Stufen („ohne Nachbarversatz“, dann „nur durchgehende Fugen vermieden“). Er rechnet bis zu 24 deterministisch abgeleitete Aufteilungen und nimmt die mit den wenigsten Lockerungen. Versuchsnummer und Lockerungen stehen im Plan und in der Oberfläche. Das ist die einzige automatische Korrektur; sie ist begrenzt und nachvollziehbar.
4. **Cockpit** (Modul *Cockpit*): Kanzelstein 2×3 in Fensterfarbe, seitliche Rahmen aus Platten, Fliesen als Abdeckung.
5. **Heckantrieb**: zwei 2×2-Steine mit Platten und Fliesen; die mittlere Fliese überbrückt beide Antriebe.
6. **Ausleger** (separat vormontierte Baugruppe): Querträger 4×10, je nach Spannweite Verlängerungen 2×6, Gondeln 2×2 mit Fliesen. Die Baugruppe wird einmal als Ganzes von oben auf die Taille gesetzt.
7. **Details**: Beplankung aus 1×2-/1×1-Platten und 1×2-Fliesen in drei Lagen (Rumpfdeck vorn, hinten, Querträger). Über die Anzahl der Beplankungseinheiten trifft der Generator die geplante Teilezahl exakt.
8. **Baufolge**: Schritte entstehen aus dem Konstruktionsablauf. Jedes Teil wird genau einmal hinzugefügt, mit denselben Instanzen wie im Endmodell. Zuerst wird die Ausleger-Baugruppe vormontiert, dann folgen Rumpf, Cockpit, Antrieb, Aufsetzen der Ausleger und Details. Liegen mehrere lose Bodenplatten, wird Handunterstützung ausdrücklich vermerkt. Die Baufolge ist **erzeugt und im Bewegungsmodell geprüft**. Sie ist keine Herstelleranleitung und nicht physisch erprobt.

## Parameter

| Eingabe | Werte | Wirkung |
| --- | --- | --- |
| Rumpflänge | 10, 12, 16, 20 Noppen | Kombination der Bodenplatten 4×10/4×6 |
| Spannweite | 10, 12, 14, 16 Noppen | Querträger 4×10, ab 12 mit Verlängerungen 2×6 |
| Teilezahl von/bis | ganze Zahlen | Ziel ist die Mitte des Bereichs, begrenzt auf das Erreichbare |
| Farbpalette | Arrakis, Stahl, Nacht | nur Farben, keine Geometrie |
| Variantenkennung (Seed) | ganze Zahl ≥ 0 | Steinaufteilung und Lage der Beplankung |

Nicht erfüllbare Eingaben führen zu keinem Modell, sondern zu einer Meldung mit dem erreichbaren Bereich und Hinweisen, zum Beispiel: „Teilezahlbereich 300–400 … nicht erfüllbar: möglich sind 72–134 Teile“. Die Oberfläche zeigt dann weiter den letzten gültigen Stand, kennzeichnet ihn aber als nicht zu den Eingaben passend und sperrt die Exporte.

## Die drei Varianten (Stand `spaceship-gen@1.0.0`, Palette Arrakis, Bereich 100–180)

| Variante | Eingaben | Teile (geplant = tatsächlich) | erreichbar | Außenmaße (aus LDraw-Geometrie) | Schritte | Heuristische Strukturwarnungen |
| --- | --- | --- | --- | --- | --- | --- |
| Kompakt | L 10, S 12, Seed 1 | 109 | 65–109 | 10 × 12 Noppen, 144 LDU hoch (≈ 80 × 96 × 57,6 mm) | 19 | 7 × durchgehende Fuge über 3 Lagen |
| Langgestreckt | L 16, S 12, Seed 2 | 140 | 86–170 | 16 × 12 Noppen, 144 LDU hoch (≈ 128 × 96 × 57,6 mm) | 17 | keine |
| Breit | L 12, S 16, Seed 3 | 138 | 72–138 | 12 × 16 Noppen, 144 LDU hoch (≈ 96 × 128 × 57,6 mm) | 19 | 11 × durchgehende Fuge über 3 Lagen |

Bei der breiten Variante liegt das Ziel (140) über dem Erreichbaren. Der Generator setzt deshalb 138 Teile, was im Bereich 100–180 bleibt. Ohne Katalogauszug haben alle drei Varianten **keine Blocker**. Sie sind vollständig verbunden, kollisionsfrei und ohne verformte, gespiegelte oder frei gedrehte Teile. Sie nutzen keine Sondertechnik, und die Baufolge ist ausführbar. Die Standsicherheit ist heuristisch bewertet („steht“). Offen bleiben die Katalogprüfung (ohne Auszug), Nutzungsfragen und die Beschaffung.

## Teileumfang

Nur Teile mit voller Simulationsunterstützung und vorhandener LDraw-Geometrie, unverändert und unskaliert:
Platten 3030 (4×10), 3032 (4×6), 3023 (1×2), 3024 (1×1); Steine 3001, 3002, 3003, 2456 (2×N), 3004, 3005, 3009, 3010 (1×N); Fliesen 3069b (1×2), 3070b (1×1).
Verbindungen: ausschließlich Noppe ↔ Aufnahme/Röhre, gerade, achsparallel. Es gibt keine Sonderregeln: R-UPIN-HOLLOWSTUD wird nicht verwendet.

## Farben und Belege

| Palette | Rumpf | Rumpf 2 | Kanzel | Antrieb | Details |
| --- | --- | --- | --- | --- | --- |
| Arrakis | Tan (19) | Dark Tan (28) | Black (0) | Dark Bluish Gray (72) | Reddish Brown (70) |
| Stahl | Light Bluish Gray (71) | Dark Bluish Gray (72) | Black (0) | Black (0) | Tan (19) |
| Nacht | Dark Bluish Gray (72) | Black (0) | Light Bluish Gray (71) | Black (0) | Dark Tan (28) |

Ohne Katalogauszug bleiben Teil-Farb-Belege ungeprüft (`CAT_SOURCE_UNAVAILABLE`). Mit dem lokalen, privaten Rebrickable-Auszug prüft `npm run test:rebrickable` alle Paletten × Varianten. Alle Kombinationen sind im Auszug belegt, die Katalogprüfung ergibt keine Blocker. Ein Beleg sagt nur, dass die Kombination in Rebrickable-Daten vorkommt. Kaufbarkeit, Preise und Bestände sind **nicht** geprüft und werden nicht angezeigt. In Referenzen beobachtete Farben gelten nicht als Beleg.

## Grenzen

- **Formensprache**: Ohne Dachsteine, Keile, SNOT, Scharniere und Clips bleibt die Form treppenartig und rechtwinklig. Schrägen, Flügelprofile und seitlich angesetzte Details sind erst mit weiteren, belegten Regeln möglich.
- **Nur von oben**: Alle Teile werden senkrecht von oben gesetzt; es gibt keine Überhänge außer den Auslegern auf dem Querträger.
- **Beplankung**: Auf 1 Noppe breiten Streifen gibt es nur 1×N-Platten und -Fliesen. Dort entstehen heuristische Warnungen „durchgehende Fuge über 3 Lagen“ (kompakt, breit). Sie sind ausgewiesen und nicht unterdrückt. Am Rumpf selbst verhindert der Verband solche Fugen.
- **Rumpfverband**: In Lage 2 (mittlere Reihe) ist bei allen drei Varianten die Stufe „ohne Nachbarversatz“ nötig. Das heißt: keine Fuge über einer Fuge darunter, aber Fugen neben der Nachbarreihe sind erlaubt.
- **Mechanik**: Belastung, Klemmkraft, Fallverhalten und Spielbarkeit sind **ungeprüft**. Die Varianten sind als Ausstellungsmodelle gedacht.
- **Baufolge**: Sie ist geometrisch geprüft (Einschubwege, Zwischenstände). Ob sie sich mit der Hand angenehm bauen lässt, ist nicht geprüft.

## Protokoll für einen späteren physischen Probeaufbau (noch nicht durchgeführt)

Empfohlene Variante: **Langgestreckt** (L 16, S 12, Seed 2, Palette Arrakis, 140 Teile). Sie ist die einzige Variante ohne heuristische Strukturwarnungen, und ihre Bodenplatten-Fuge bietet einen echten Prüfpunkt für Handunterstützung.

1. **Vorbereitung**: Mit dem Simulator Modell-JSON, Prüfbericht, Stückliste (CSV) und LDraw exportieren und den Inhalts-Hash notieren (Sollwert `1985663483f52a`). Teile nach Stückliste bereitlegen. Herkunft (original LEGO oder kompatibel), Zustand und Farbabweichungen je Position festhalten.
2. **Aufbau nach der erzeugten Bauanleitung** (PDF aus dem Bereich „Bauanleitung“, siehe `BAUANLEITUNG.md`; Beobachtungen nach Protokoll P4 in `PHYSISCHE-PRUEFPROTOKOLLE.md`), Schritt für Schritt, je Schritt notieren:
   - lässt sich jedes Teil auf dem angegebenen Weg von oben setzen?
   - Wurde Handunterstützung gebraucht? Erwartet wird sie nur bei Schritt „Rumpf: Bodenplatten“, bis die erste Steinlage die Plattenfuge überbrückt.
   - Fühlt sich ein Teil lose an, oder sitzt es nicht vollständig?
   - Wie lange dauerte der Schritt?
3. **Ausleger-Baugruppe**: separat vormontieren, als Ganzes aufsetzen. Prüfen, ob sie beim Aufsetzen in sich zusammenhält und ob alle Noppen gleichzeitig greifen.
4. **Endmodell vermessen**: Länge, Breite, Höhe mit Messschieber (Soll laut Geometrie ≈ 128 × 96 × 57,6 mm; die Höhe von 144 LDU reicht bis zur Oberkante der Antriebsfliesen).
5. **Handhabung** nach Protokoll P2 in `PHYSISCHE-PRUEFPROTOKOLLE.md`: am Rumpf anheben, an einem Ausleger anheben (nur leicht), auf den Tisch setzen. Lösen sich Teile, mit Instanz-ID aus der LDraw-Datei protokollieren.
6. **Auswertung** nach P3: Ergebnisse den Befunden des Prüfberichts gegenüberstellen. Wichtige Fragen sind, ob der Rumpfverband mit der Stufe „ohne Nachbarversatz“ ausreichend steif ist und ob die Ausleger auf der Taille (4×10-Querträger auf zwei Steinlagen) wackeln. Abweichungen gehen als Kalibrierungsdaten zurück. Das Prüfergebnis des Simulators wird dadurch nicht nachträglich „bestätigt“.

## Offene konstruktive und physische Fragen

- Reicht die Klemmung des Querträgers 4×10 auf der Taille, wenn man das Modell an einem Ausleger anhebt?
- Wie steif ist der Rumpf an der Stufe zwischen Taille und Türmen (die Türme stehen nur auf Lage 2)?
- Sind die heuristischen Fugenwarnungen der Beplankung (kompakt, breit) praktisch relevant? Sie liegen nur in Detail-Lagen ohne tragende Funktion.
- Wie schwer ist der Aufbau ohne bebilderte Anleitung? Die Baufolge besteht bisher nur aus Text und 3D-Schritten.
- Ästhetik: Wirkt die gestufte Silhouette aus rechtwinkligen Teilen ausreichend „industriell“, oder braucht es zuerst Dachsteine und Keile (Roadmap)?
