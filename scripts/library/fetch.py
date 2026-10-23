"""Teilebibliothek (Auftrag 05C.1): lädt die festgelegten Quellpakete und prüft ihre Prüfsummen.

Aufruf:  npm run library:fetch            (bzw. python -I scripts/library/fetch.py)
         npm run library:fetch -- --update  übernimmt neue Versionen und schreibt Prüfsummen ins Quellenregister

Quellenregister: data/library/sources.json (versioniert). Ziel: data-cache/ (nicht versioniert).
Jede Quelle wird in einen eigenen, frisch geleerten Ordner entpackt. Heruntergeladener Code wird nie ausgeführt.
"""
import datetime
import hashlib
import json
import os
import shutil
import sys
import urllib.request
import zipfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
REGISTRY = os.path.join(ROOT, 'data', 'library', 'sources.json')
CACHE = os.path.join(ROOT, 'data-cache')
UA = {'User-Agent': 'baustein-simulator/0.1 (Teilebibliothek, lokale Entwicklung)'}


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest().upper()


def download(url, dest):
    tmp = dest + '.part'
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as res, open(tmp, 'wb') as out:
        shutil.copyfileobj(res, out, 1 << 20)
        last_modified = res.headers.get('Last-Modified')
    os.replace(tmp, dest)
    return last_modified


def extract(zip_path, target):
    """Entpackt in einen leeren Ordner; Pfade außerhalb des Ziels (../, absolute Pfade) werden abgelehnt."""
    if os.path.exists(target):
        shutil.rmtree(target)
    os.makedirs(target)
    base = os.path.realpath(target)
    with zipfile.ZipFile(zip_path) as z:
        for info in z.infolist():
            dest = os.path.realpath(os.path.join(target, info.filename))
            if not (dest == base or dest.startswith(base + os.sep)):
                raise SystemExit(f'Unsicherer Pfad im Archiv: {info.filename}')
        z.extractall(target)
    tops = [n for n in os.listdir(target)]
    return tops[0] if len(tops) == 1 and os.path.isdir(os.path.join(target, tops[0])) else ''


def main():
    update = '--update' in sys.argv
    only = [a for a in sys.argv[1:] if not a.startswith('--')]
    with open(REGISTRY, encoding='utf8') as fh:
        reg = json.load(fh)
    os.makedirs(os.path.join(CACHE, 'downloads'), exist_ok=True)
    changed = False
    for src in reg['sources']:
        if only and src['id'] not in only:
            continue
        zip_path = os.path.join(CACHE, 'downloads', src['id'] + '.zip')
        have = os.path.exists(zip_path) and src.get('sha256') and sha256(zip_path) == src['sha256']
        if not have:
            print(f"[{src['id']}] lade {src['url']}")
            src_lm = download(src['url'], zip_path)
        else:
            src_lm = src.get('lastModified')
            print(f"[{src['id']}] Paket vorhanden, Prüfsumme stimmt")
        digest, size = sha256(zip_path), os.path.getsize(zip_path)
        if src.get('sha256') and digest != src['sha256']:
            if not update:
                raise SystemExit(
                    f"[{src['id']}] Prüfsumme weicht ab ({digest} statt {src['sha256']}).\n"
                    '  Die Quelle hat vermutlich eine neue Version. Übernehmen mit: npm run library:fetch -- --update')
            print(f"[{src['id']}] neue Version übernommen: {src['sha256']} -> {digest}")
        if src.get('sha256') != digest or src.get('bytes') != size:
            if src_lm:
                src['lastModified'] = src_lm
            src.update(sha256=digest, bytes=size,
                       pinnedAt=datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'))
            changed = True
        target = os.path.join(CACHE, src['id'])
        marker = os.path.join(target, '.fetched.json')
        current = None
        if os.path.exists(marker):
            with open(marker, encoding='utf8') as fh:
                current = json.load(fh)
        if not current or current.get('sha256') != digest:
            top = extract(zip_path, target)
            with open(marker, 'w', encoding='utf8') as fh:
                json.dump({'id': src['id'], 'sha256': digest, 'root': top}, fh)
            print(f"[{src['id']}] entpackt nach data-cache/{src['id']}/{top}")
    if changed:
        with open(REGISTRY, 'w', encoding='utf8', newline='\n') as fh:
            json.dump(reg, fh, ensure_ascii=False, indent=2)
            fh.write('\n')
        print('Quellenregister aktualisiert: data/library/sources.json')
    print('Fertig. Weiter mit: npm run library:import')


if __name__ == '__main__':
    main()
