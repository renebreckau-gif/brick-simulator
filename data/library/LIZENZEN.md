# Lizenzen der Teilebibliothek (data/library/)

Die Dateien in diesem Ordner wurden mit `scripts/library/build.py` aus den in `sources.json` festgelegten Quellpaketen erzeugt; Prüfsummen und Versionen stehen in `build-info.json`. Je Quelle und Lizenz gibt es eine eigene Datei.

| Datei | Quelle | Lizenz |
|---|---|---|
| `parts.json` | LDraw Official Parts Library (ldraw.org), Kopfdaten und daraus berechnete Geometrie-Kennwerte | CC BY 4.0 – Autoren je Teil in den LDraw-Dateien; siehe CAreadme.txt der LDraw-Bibliothek |
| `connectors-ldcad.json` | LDCad Shadow Library (Roland Melkert und Mitwirkende, github.com/RolandMelkert/LDCadShadowLibrary), aufgelöste SNAP-Metadaten | CC BY-SA 4.0 – diese abgeleitete Datei steht ebenfalls unter CC BY-SA 4.0 |
| `connectors-bricknet.json` | BrickNet, Katalog v1 (Peter Kulits, github.com/kulits/BrickNet), umgerechnete Anschlussbeschriftungen | MIT (Lizenztext unten); BrickNet leitet aus LDraw (CC BY 4.0) ab |
| `sources.json`, `build-info.json`, `LIZENZEN.md` | eigene Angaben dieses Projekts | wie das Projekt |

Veränderungen gegenüber den Quellen: Formatumwandlung, Auflösung von Unterdateien und Rastern in Teilkoordinaten, Rundung (0,1 LDU), grobe Klasseneinteilung der Anschlüsse; die Rohform jeder Quelle bleibt je Anschluss erhalten.

Nicht enthalten (nur lokal, git-ignoriert): `private/rebrickable-colors.json` – aus Rebrickable-Dumps abgeleitete Farbbelege; deren Weitergabe ist ungeklärt.

## MIT-Lizenz (BrickNet)

MIT License

Copyright (c) 2026 Peter Kulits

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
