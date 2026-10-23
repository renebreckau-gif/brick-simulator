"""Gemeinsame Hilfen für fetch.py und build.py (Auftrag 05C.1.1).

Inhalts-Prüfwert („Baum“): SHA-256 über die sortierte Liste „Pfad<TAB>SHA-256 des Inhalts“ aller Dateien im
festgelegten Umfang. Er hängt nur vom Inhalt ab – nicht von Zip-Kompression, Archivreihenfolge, Dateisystem oder
Betriebssystem – und ist daher das maßgebliche Kennzeichen eines Quellstands.
"""
import hashlib
import os

CHUNK = 1 << 20


def sha256_bytes(data):
    return hashlib.sha256(data).hexdigest().upper()


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as fh:
        for chunk in iter(lambda: fh.read(CHUNK), b''):
            h.update(chunk)
    return h.hexdigest().upper()


def in_scope(rel, scope):
    return not scope or any(rel.startswith(s) for s in scope)


def norm(rel, lower):
    rel = rel.replace('\\', '/')
    return rel.lower() if lower else rel


def tree_of_dir(base, scope=(), lower=False):
    """Pfad → SHA-256 für alle Dateien unter base (Pfade relativ, mit '/')."""
    out = {}
    for root, _dirs, files in os.walk(base):
        for f in files:
            full = os.path.join(root, f)
            rel = norm(os.path.relpath(full, base), lower)
            if rel.startswith('.fetched') or not in_scope(rel, scope):
                continue
            out[rel] = sha256_file(full)
    return out


def tree_of_zip(z, prefix='', scope=(), lower=False):
    """Wie tree_of_dir, aber direkt aus einem Zip (prefix = Ordner im Archiv, der als Wurzel gilt)."""
    out = {}
    for info in z.infolist():
        if info.is_dir():
            continue
        name = info.filename.replace('\\', '/')
        if prefix and not name.lower().startswith(prefix.lower()):
            continue
        rel = norm(name[len(prefix):], lower)
        if in_scope(rel, scope):
            out[rel] = sha256_bytes(z.read(info))
    return out


def tree_digest(tree):
    text = ''.join(f'{k}\t{v}\n' for k, v in sorted(tree.items()))
    return sha256_bytes(text.encode('utf8'))
