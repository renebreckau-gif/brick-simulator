# Konstruktionsnachweis: Bug und Kanzel aus realen Steinen (Auftrag 05B.1)

Erster Nachweis, dass aus der Formvorgabe einer Bildvorlage ein Modell aus **realen Teilinstanzen** entsteht. Die Geometrie stammt aus LDraw-Dateien, die Anschlüsse sind dokumentiert. Das Modell wird mit dem regulären Validator geprüft und mit der Vorlage verglichen. Dargestellt wird ein begrenzter Ausschnitt: der Bug mit Kanzel. Es ist ein eigener Entwurf, kein offizielles LEGO-Modell. **Physisch erprobt ist nichts**; über Belastbarkeit wird keine Aussage gemacht.

Bereich in der Oberfläche: **Konstruktionsnachweis**. Ansichten: „Modell & Prüfung“, „Sechs Ansichten & Vorlage“ und „Bauanleitung“.

## Kette

```
Vorlage (lokal, nur gelesen) + Ansichtszuordnung
   │  templateTarget.ts – Messung je Ansicht, gemeinsamer Maßstab, Quellen je Angabe
   ▼
Formvorgabe BowTarget (Breite und Oberkante je Reihe, Kanzel) ── oder synthetische Testform
   │  bowTechnique.ts – Bautechnik A oder B, Breite 6 oder 8 Noppen
   ▼
kanonisches Modell (Teilinstanzen, Baugruppen, Baufolge, design-Herkunft)
   │  regulärer Validator · Stückliste · Bauanleitung (unverändert)
   ▼
Vergleich mit der Vorlage (compare.ts): sechs Ansichten derselben Instanzen, Umrissprofile, Abweichungen
```

Die Volumenkörper des räumlichen Entwurfs (05B.0) sind nur eine interne Planungshilfe. Sie erscheinen nicht in der Modellansicht. Die Hauptansicht zeigt ausschließlich das Teilemodell.

## 1. Vorlage und Zielgeometrie

| Angabe | Quelle | Verfahren |
|---|---|---|
| Bugkontur (Breite je Reihe) | Draufsicht „OBEN“ (Vorderseite im Bild unten) | Objektlauf quer zur Rumpfmittellinie je Messlinie |
| Maßstab | Draufsicht | größte gezeichnete Bugbreite im Abschnitt ≙ gewählte Breite (6 bzw. 8 Noppen); Länge und Höhe gleich skaliert |
| Abschnittslänge | linke Seite | Spitze bis Kanzelende + 25 % der Kanzellänge |
| Höhenprofil (Oberkante je Reihe) | linke Seite | Oberkante über der Rumpfunterkante (Median der Unterkanten im Abschnitt) |
| Kanzellage und -höhe | Bildbereich der Kanzel-Baugruppe in der linken Seite | Vorder-/Hinterkante; Höhe = höchster Punkt über der Rumpfoberkante kurz vor der Kanzel |
| Kanzelbreite | Bildbereich der Kanzel in der Draufsicht | Breite im gemeinsamen Maßstab |

- **Nicht gemittelt:** Die rechte Seite wird gemessen und nur verglichen. Bei 6 Noppen weicht sie um höchstens 0,5 Plattenhöhen ab, bei 8 Noppen um 0,6; das wird festgehalten. Die Frontansicht wird nur gezeigt.
- **Nicht verwendet:** Die Maßbeschriftungen der Vorlage („B ≈ 0,72 L“, „H ≈ 0,38 L“, „L = 1,00“) sind Angaben der Vorlage. Sie sind als Hinweis vermerkt, aber nicht übernommen. Die gemessene größte Bugbreite beträgt 0,25 L; sie betrifft nur den Bug und widerspricht deshalb nicht der Gesamtbreite mit Gondeln.
- **Keine Quelle:** „UNTEN · ENTWURF“ ist eine entworfene Ansicht.
- **Annahme (verdeckt):** Die Rumpfoberkante unter der Kanzel ist eben in Höhe der Kanzelvorderkante.
- **Messverfahren** (`silhouette.ts`): Der Hintergrund wird aus dem Ausschnittrand geschätzt (Schwelle 40). Morphologisches Öffnen (Radius 2) entfernt Maß- und Hilfslinien. Lücken bis 2 % der Rumpflänge werden geschlossen, damit sandfarbene Steine auf dem Papier nicht als Lücke gelten. Gemessen wird nur innerhalb des Rumpf-Bildbereichs. Die Messung wurde lokal als Überlagerung auf der Vorlage geprüft; die Ränder liegen auf dem Umriss.
- **Herkunft der Ansichtszuordnung:** Für die Sandwächter-Vorlage stammt sie aus `tests/fixtures/design/interpretation-sechs-ansichten-synthetic.json`. Das ist eine **synthetische Testantwort bzw. manuelle Eingabe durch Claude Code**, keine Live-Analyse. Die Oberfläche zeigt die Herkunft an (`viewAssignmentOrigin`). „Automatische Erkennung“ gilt nur dann als nachgewiesen, wenn eine Live-Analyse im erweiterten Ansichtsformat gelaufen ist. Das ist **nicht** der Fall.
- **Kanzel-Baugruppe:** Sie wird von Ihnen gewählt. Ein Namensabgleich („Kanzel“, „Cockpit“) erscheint nur als gekennzeichneter Vorschlag.

Gemessene Formvorgabe (Sandwächter, 6 Noppen): 10 Reihen. Breite von hinten nach vorn 5,9 · 6 · 6 · 5,8 · 5,3 · 4,7 · 4,1 · 3,4 · 2,7 · 2,0 Noppen. Oberkante 14,2 · 8,9 (Reihe 1–7, unter der Kanzel eben) · 8,1 · 7,3 Plattenhöhen. Kanzel in Reihe 1–6, Höhe 4,6 Plattenhöhen.

## 2. Teile und Bautechniken

Neu aus der LDraw-Bibliothek, Herkunft und Prüfsummen in `data/ldraw/manifest.json`, jede Datei „Licensed under CC BY 4.0“:

| Teil | Bezeichnung | Verwendung |
|---|---|---|
| 3039 | Schrägstein 45° 2×2 | Kanzelscheibe |
| 3298 | Schrägstein 33° 3×2 | Variante B, Bugprofil |
| 4286 | Schrägstein 33° 3×1 | Variante B bei ungerader Breite |
| 41769a / 41770a | Keilplatte 4×2 rechts/links | Variante A, Bugkontur |
| 43722a / 43723a | Keilplatte 3×2 rechts/links | Variante A, kürzere Segmente |
| 3020, 3021, 3022, 3710, 3666, 3795 | Platten 4×2, 3×2, 2×2, 4×1, 6×1, 6×2 | Grundplatten und Plattenlagen |

**Geprüft, aber nicht übernommen:**

| Teil | Grund |
|---|---|
| 3040b | Schrägstein 45° 2×1; für die Kanzel genügt 3039 |
| 3665 / 3660 | inverse Schrägsteine; die Unterseite des Bugs ist keine Konstruktionsquelle |
| 15068 | gebogene Fliese |
| 3823 | Windschutzscheibe |
| 99781 / 87087 | seitliche Halter, SNOT |
| 3068b | Fliese |

Ihre Dateien sind nicht mehr im Repository. Die Wurzelliste enthält die Keilplatten direkt als `41769a.dat` usw. (die bisherigen Einträge waren „~Moved to …a“-Verweise).

**Teilemetadaten** (`part-meta@1.2.0`):

- **Körper:** Der Körper jedes Schrägteils ist ein exaktes konvexes Prisma.
- **Noppen:** nur in den vollen Reihen.
- **Unterseitenstifte:** bei 3040b und 4286 als Stift.
- **Aufnahmen:** dort, wo der Noppenkreis (r = 6 LDU) vollständig unter dem Körper liegt.
- **Röhren:** Die Röhren der Schrägsteine (`stud4a`, verkürzt) zählen nicht als Anschluss.
- **Prüfung in beide Richtungen** (`tests/part-meta-shaped.test.ts`): Jeder LDraw-Körperpunkt liegt im Prisma, jede Prismenecke liegt auf LDraw-Geometrie.
- **Weitere Abgleiche:** Noppen und Stifte werden gegen `stud.dat`/`stud2.dat`/`stud3.dat`/`stud3a.dat` abgeglichen, die Aufnahmen gegen eine von Hand hergeleitete Tabelle.

**Kollision** (`solids.ts`, `validator@0.3.0`): Prismen und Quader werden mit dem Trennachsentest geprüft. Die Durchdringungstiefe ist die kleinste Überlappung über alle Flächennormalen und Kantenkreuzprodukte. Steckwege werden als gefegte Körper geprüft (`assembly-rules@1.1.0`). Die gültigen und ungültigen Fälle stehen in `tests/solids-collision.test.ts`:

| Fall | Ergebnis |
|---|---|
| Platte unter der Schräge von 3039 | berührt nur; ein Quadermodell hätte fälschlich eine Durchdringung gemeldet |
| dieselbe Platte 4 LDU tiefer in die Schräge | dringt ein (≈ 2,8 LDU) |
| Platte neben der abgeschnittenen Keilplattenecke | frei |
| dieselbe Platte 5 LDU weiter innen | dringt ein |
| Versatz um eine halbe Noppe | ergibt keine Verbindung |
| Zelle unter der abgeschnittenen Keilecke | ergibt keine Verbindung |

## 3. Konstruktion und Varianten

Beide Varianten bauen Lage für Lage aus Rechteckteilen und Formteilen. Die Belegung einer Lage wird aus bis zu 16 Strategien gewählt: Ausrichtung, Reihen- und Spaltenversatz, Brücken an Breitensprüngen. Die Auswahl erfolgt in dieser Reihenfolge:

1. wenigste getrennte Gruppen (Union-Find über die Noppenverbindungen aus den Teilemetadaten),
2. wenigste übereinanderliegende Fugen,
3. wenigste Teile.

Zwei Lücken traten erst bei zusätzlichen Formen auf und sind behoben:

- **Spitzenreihen** vor dem Ende der zweiten Lage bzw. vor dem letzten Schrägstein haben nichts über sich. Dort reichen jetzt längs gedrehte Platten von unter der zweiten Lage bis in die Spitze. Was weiter vorn läge, entfällt mit Abweichungsmeldung.
- **Grundplatte von Variante B:** Sie wird mit Vorschau auf die erste Steinlage gewählt. Zusätzliche Strategie: Platten, die Fugen einer probeweise gelegten Steinlage überbrücken, werden bevorzugt.

Ein Lauf über **432 Kombinationen** ergab **0 Blocker**:

- 4 Längen, 3 Spitzenlängen, 3 Höhenprofile, 3 Kanzellagen,
- 2 Varianten, 2 Breiten.

Vor den Korrekturen hatten 9 dieser Kombinationen eine lose Spitze. 48 dieser Kombinationen, darunter alle früher fehlerhaften, laufen als Regressionstest mit (`tests/construct-bow.test.ts`).

- **Variante A – Platten mit Keilplattenkontur.** Plattenlagen; jede zweite Lage und die oberste trägt an der Spitze Keilplattenpaare. Je Paar wird der Bug um 2 Noppen schmaler. Dazwischen liegen eingezogene Lagen, die die Noppen der vollen Keilplattenreihe überdecken.
- **Variante B – Steinlagen mit Schrägsteinprofil.** Auf einer Grundplatte liegen Steinlagen, die vorn mit 33°-Schrägsteinen enden; die nächste Lage beginnt auf deren Noppenreihe. Die Neigung ist fest: 1 Steinhöhe je 2 Reihen.
- **Kanzel (beide Varianten).** Steinlagen mit 45°-Schrägsteinen 3039 als Scheibe auf der ebenen Rumpfoberkante; jede Lage beginnt eine Reihe weiter hinten. Ist die Oberkante unter der Kanzel nirgends eben, entfällt die Kanzel mit Abweichungsmeldung.
- **Reaktion auf die Form.** Kein festes Modell: Eine geänderte Formvorgabe (Testform B: kürzere Spitze, Kanzel weiter vorn; synthetisches Bild mit verschobener Kanzel) ergibt ein anderes Modell, eine andere Modell-ID und ein anderes Profil. Die Kanzelteile liegen dann weiter vorn (Tests in `construct-bow` und `construct-template`). Eine Modell-ID enthält Variante, Breite und den Hash der Formvorgabe.

### Variantenvergleich an der Vorlage

Umrissüberdeckung = Schnitt durch Vereinigung der normierten Profile (grob, 60 Stützstellen über die Abschnittslänge). Das ist ein Hinweis, kein Gültigkeitsnachweis.

| | A, 6 Noppen | B, 6 Noppen | A, 8 Noppen | B, 8 Noppen |
|---|---|---|---|---|
| Teile / Schritte | 75 / 16 | 30 / 6 | 185 / 21 | 61 / 7 |
| Blocker | 0 | 0 | 0 | 0 |
| Warnungen | – | – | durchgehende Fugen | durchgehende Fugen |
| Abweichungsmeldungen | 1 | 14 | 2 | 18 |
| Überdeckung Draufsicht | 92 % | 90 % | 97 % | 94 % |
| Überdeckung linke / rechte Seite | 81 % / 80 % | 68 % / 69 % | 88 % / 87 % | 66 % / 67 % |

- **Erkennbarkeit und Silhouette:**
  - **Variante B:** Sie hat das schräge Bugprofil, wirkt also eher wie ein Bug. Ihre feste 33°-Neigung macht die Spitze aber viel flacher und spitzer als die stumpfe, hohe Bugnase der Vorlage (vorderste Reihe: 1,6 statt 7,3 Plattenhöhen bei 6 Noppen). Dazu kommen viele Höhenabweichungen.
  - **Variante A:** Sie folgt Kontur und Höhen genauer. Die Höhe springt aber in Plattenstufen, die Kanzel ist ein kantiger Block, und die gestreiften Farblagen wirken unruhig.
  - **Gemeinsam:** Die Kanzel der Vorlage ist eine schräge Glashaube; beide Varianten bauen sie höher und kantiger (größte Seitenabweichung im Kanzelbereich). Die Unterseite der Vorlagennase ist angehoben, das Modell ist unten eben.
- **Proportionen:** In der Draufsicht passen beide gut. Die größte Breitenabweichung von A liegt an der Spitze: 2 Noppen statt etwa 1, die Mindestbreite eines Keilplattenpaars.
- **Verbindungen und Montage:**
  - Beide Varianten sind zusammenhängend, kollisionsfrei und im Bewegungsmodell montierbar.
  - Variante A besteht nur aus Platten. Sie braucht viele Schritte und hat bei 8 Noppen durchgehende Fugen (Warnung). Plattenstapel ohne Steine sind in Wirklichkeit vermutlich weniger steif; nicht geprüft.
  - Variante B ist kompakt und hat wenige Schritte.
  - Die unterste Lage liegt bei beiden lose, bis die nächste sie verbindet (Hinweis „mit der Hand halten“ im ersten Schritt).
- **Teilezahl und Aufwand:** Variante B braucht etwa 40 % (6 Noppen) bzw. ⅓ (8 Noppen) der Teile von A.
- **Fazit:** Keine Variante gibt die Vorlage überzeugend wieder.
  - Variante A trifft Maße und Umriss besser.
  - Variante B trifft den Charakter einer schrägen Nase besser, aber nicht deren Höhe.
  - Als nächster Schritt liegt eine Mischung nahe: Plattenlagen mit Keilplattenkontur, oben 33°- und 45°-Schrägsteine, also A als Rumpf und B als Deckprofil. Sie wurde hier bewusst nicht gebaut, damit die beiden Techniken getrennt vergleichbar bleiben.

### Größere Ausführung (8 Noppen)

Bei 8 Noppen steigt die Überdeckung der Draufsicht (A: 97 %), die Seitenansicht wird bei A besser (88 %). Der Preis ist hoch: 185 statt 75 Teile bei A. Bei B (61 Teile) bleibt das Profilproblem bestehen, weil die Neigung fest ist.

### Seitliches Bauen (SNOT): nicht ergänzt

- **Draufsicht:** Die verbleibenden Abweichungen liegen in der Seitenansicht. Die Draufsicht-Kontur deckt sich bereits zu 90–97 %.
- **Seitenansicht:** Die Ursachen sind feste Schrägneigung, Plattenstufen, kantige Kanzel und die ebene Unterseite. Keine davon behebt SNOT: Die Bugseiten sind in der Vorlage im Wesentlichen senkrecht, das Stapeln liefert sie bereits.
- **Wo SNOT helfen könnte:** bei seitlichen Verkleidungsdetails und geneigten Seitenfacetten. Dafür wären Halter (99781/87087) oder Scharniere nötig, mit noch nicht implementierten Anschlussregeln (seitliche Noppen sind bisher „nicht unterstützt“).
- **Entscheidung:** Für die erkennbare Form ist SNOT nicht notwendig. Die Halter-Dateien wurden wieder entfernt.

## 4. Sichtbares Ergebnis

- **Modell & Prüfung:** frei drehbares Teilemodell aus LDraw-Geometrie, Prüfbericht, Bauschritte, Stückliste, Exporte.
- **Sechs Ansichten & Vorlage:**
  - Sechs orthografische Renderings derselben Instanzen, ausgerichtet wie die jeweilige Ansicht der Vorlage (Draufsicht mit Bug unten, Seiten mit Bug links bzw. rechts).
  - Daneben der Vorlagenausschnitt (bei Messansichten der gemessene Abschnitt), seine Rolle (Quelle, Vergleich, nur Ansicht, keine Quelle) und für gemessene Ansichten der Umrissvergleich mit größter Abweichung in Noppen bzw. Plattenhöhen.
- **Bauanleitung:** die vorhandene Kette, unverändert.
- **Seitenleiste:**
  - Formvorgabe, Herkunft der Ansichtszuordnung, Kanzelwahl, Variante und Breite.
  - Teilezahl, Maße und Lagen, Entscheidungen, Abweichungen, Quellen je Angabe.
  - Teilestatus mit getrennten Angaben zu Katalogexistenz, Teil-Farb-Beleg und Kaufverfügbarkeit.
- **Farben:**
  - Rumpf 72 (Dark Bluish Grey), Akzent 330 (Olive Green), Scheibe 40 (Trans Brown).
  - **Kein Teil-Farb-Beleg** für eines der neuen Teile: Die neuen Teile sind nicht im privaten Katalogauszug; ohne Auszug ist der Beleg ungeprüft. Insbesondere ist **3039 in Trans Brown nicht als real bestätigt**.
  - Transparenz wird im Rendering nicht dargestellt.
- **Kaufverfügbarkeit:** nicht geprüft.

## 5. Grenzen und offene Fragen

- **Nicht physisch erprobt:**
  - Halt der Keilplatten- und Plattenstapel, Klemmkraft der Schrägsteine, Steifigkeit der Spitze.
  - Die Strukturprüfung bleibt heuristisch.
- **Konservative Annahmen:**
  - Unter einer teilweise überdeckten Keilplattenzelle wird keine Aufnahme gezählt.
  - Die Röhren der Schrägsteine zählen nicht als Anschluss.
- **Messung:**
  - Sie misst die Zeichnung, nicht das Objekt.
  - Bei anderen Vorlagen (dunkler Hintergrund, Schatten, überlappende Ansichten) kann der Umriss falsch erkannt werden. Die Überlagerung wurde nur für diese eine Vorlage geprüft.
- **Abschnitt:**
  - Nur Bug und Kanzel; Rumpf, Gondeln, Turm und Landebeine fehlen.
  - Das hintere Ende ist eine Schnittfläche; Heck- und Frontansicht sind deshalb nur qualitativ vergleichbar.
- **Ansichtszuordnung:** nicht automatisch erkannt (siehe oben). Ein Live-Lauf im erweiterten Format steht aus und ist kostenpflichtig; er wurde nicht ohne Freigabe ausgeführt.
