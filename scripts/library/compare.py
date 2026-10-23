"""Diagnose (05C.1.1): vergleicht zwei Bibliotheksdateien eintragsweise und nennt abweichende Teile mit Werten.

Aufruf: python -I scripts/library/compare.py <alt.json> <neu.json> [--annotate N]
Mit --annotate werden die ersten N Abweichungen als GitHub-Actions-Hinweise ausgegeben (öffentlich lesbar).
"""
import json
import sys


def main():
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    a_path, b_path = sys.argv[1:3]
    n = int(sys.argv[sys.argv.index('--annotate') + 1]) if '--annotate' in sys.argv else 0
    a = json.load(open(a_path, encoding='utf8'))
    b = json.load(open(b_path, encoding='utf8'))
    pa, pb = a.get('parts', {}), b.get('parts', {})
    diffs = []
    for k in sorted(set(pa) | set(pb)):
        if pa.get(k) != pb.get(k):
            ea, eb = pa.get(k) or {}, pb.get(k) or {}
            fields = sorted(f for f in set(ea) | set(eb) if ea.get(f) != eb.get(f))
            diffs.append((k, {f: (ea.get(f), eb.get(f)) for f in fields}))
    head = {k for k in set(a) | set(b) if k != 'parts' and a.get(k) != b.get(k)}
    print(f'{len(diffs)} Einträge verschieden; Kopffelder verschieden: {sorted(head)}')
    by_field = {}
    for _, d in diffs:
        for f in d:
            by_field[f] = by_field.get(f, 0) + 1
    print('nach Feld:', by_field)
    for k, d in diffs[:max(n, 20)]:
        line = f'{k}: ' + '; '.join(f'{f} {json.dumps(x)} -> {json.dumps(y)}' for f, (x, y) in d.items())
        print(line[:400])
    for k, d in diffs[:n]:
        line = f'{k}: ' + '; '.join(f'{f} {json.dumps(x)} -> {json.dumps(y)}' for f, (x, y) in d.items())
        print(f'::notice title=Abweichung {b_path}::{line[:350]}')
    return 1 if diffs or head else 0


if __name__ == '__main__':
    sys.exit(main())
