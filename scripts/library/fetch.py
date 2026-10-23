"""Teilebibliothek (Auftrag 05C.1, korrigiert in 05C.1.1): beschafft die festgelegten Quellstände.

Aufruf:
  npm run library:fetch                     festgelegte Stände holen und prüfen
  npm run library:fetch -- --update         neue Stände der Quell-URLs bewusst übernehmen (lädt immer neu)
  python -I scripts/library/fetch.py --make-recipe <Grundstand-URL> <Update-ID> …
                                            Wiederherstellungsrezept für den festgelegten LDraw-Stand erzeugen
  python -I scripts/library/fetch.py --reconstruct [ldraw]
                                            Probe: Stand ausschließlich über das Rezept herstellen und prüfen

Maßgeblich ist der Inhalts-Prüfwert („tree“ in data/library/sources.json), nicht die Archiv-Prüfsumme: Er hängt nur
vom Inhalt ab. Liefert die Quell-URL einen anderen Stand (LDraw ersetzt complete.zip mit jedem Release), wird der
festgelegte Stand – sofern ein Rezept vorliegt – aus einem archivierten Grundstand, den versionierten Monats-Updates
und den im Repository abgelegten Korrekturen wiederhergestellt und gegen den Prüfwert geprüft.

Ziel: data-cache/ (nicht versioniert). Jede Quelle wird in einen eigenen, frisch geleerten Ordner geschrieben.
Heruntergeladener Code wird nie ausgeführt; gelesen werden nur Daten.
"""
import datetime
import importlib.util
import json
import os
import shutil
import sys
import time
import urllib.request
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location('library_common', os.path.join(HERE, 'common.py'))
common = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(common)

ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
REGISTRY = os.environ.get('LIBRARY_REGISTRY') or os.path.join(ROOT, 'data', 'library', 'sources.json')  # Umleitung nur für Tests
# Quellpakete: data-cache/ oder ein eigener Ort (z. B. außerhalb eines synchronisierten Ordners) per LIBRARY_CACHE
CACHE = os.environ.get('LIBRARY_CACHE') or os.path.join(ROOT, 'data-cache')
UA = {'User-Agent': 'baustein-simulator/0.1 (Teilebibliothek, lokale Entwicklung)'}


def now():
    return datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def download(url, dest):
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    tmp = dest + '.part'
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=900) as res, open(tmp, 'wb') as out:
        shutil.copyfileobj(res, out, common.CHUNK)
        last_modified = res.headers.get('Last-Modified')
    os.replace(tmp, dest)
    return last_modified


def cached_download(url, dest, sha=None):
    """Lädt nur, wenn die Datei fehlt oder ihre Prüfsumme nicht der erwarteten entspricht."""
    if os.path.exists(dest) and (sha is None or common.sha256_file(dest) == sha):
        return
    print(f'  lade {url}')
    download(url, dest)


def prefix_of(z, spec):
    if spec != 'auto':
        return spec
    tops = {i.filename.split('/', 1)[0] for i in z.infolist()}
    return (tops.pop() + '/') if len(tops) == 1 else ''


def fresh_dir(target):
    """Neuer, leerer Arbeitsordner neben dem Ziel. Der fertige Stand ersetzt das Ziel erst danach (swap_in), damit
    ein abgebrochener Lauf nie einen halben Stand hinterlässt und gesperrte Dateien (z. B. OneDrive-Synchronisation)
    das Löschen nicht blockieren."""
    work = f'{target}.neu-{os.getpid()}'
    if os.path.exists(work):
        remove_tree(work)
    os.makedirs(work)
    return work


def remove_tree(path, attempts=5):
    for i in range(attempts):
        try:
            shutil.rmtree(path)
            return True
        except OSError:
            time.sleep(1 + i)
    shutil.rmtree(path, ignore_errors=True)
    if os.path.exists(path):
        print(f'  Hinweis: alter Ordner {os.path.basename(path)} konnte nicht vollständig entfernt werden (Datei gesperrt?) – bitte später löschen.')
    return not os.path.exists(path)


def swap_in(work, target):
    old = None
    if os.path.exists(target):
        old = f'{target}.alt-{int(time.time())}'
        os.replace(target, old)
    os.replace(work, target)
    if old:
        remove_tree(old)


def safe_extract(z, target):
    base = os.path.realpath(target)
    for info in z.infolist():
        dest = os.path.realpath(os.path.join(target, info.filename))
        if not (dest == base or dest.startswith(base + os.sep)):
            raise SystemExit(f'Unsicherer Pfad im Archiv: {info.filename}')
    z.extractall(target)


def write_marker(target, src, method, root, archive_sha=None):
    with open(os.path.join(target, '.fetched.json'), 'w', encoding='utf8') as fh:
        json.dump({'id': src['id'], 'tree': src['tree']['sha256'], 'method': method, 'root': root, 'archiveSha256': archive_sha, 'at': now()}, fh)


def pinned_tree(src):
    return src.get('tree', {}).get('sha256')


def marker_ok(src):
    p = os.path.join(CACHE, src['id'], '.fetched.json')
    if not os.path.exists(p):
        return False
    with open(p, encoding='utf8') as fh:
        return pinned_tree(src) is not None and json.load(fh).get('tree') == pinned_tree(src)


def zip_tree(zip_path, src):
    with zipfile.ZipFile(zip_path) as z:
        pre = prefix_of(z, src['tree']['prefix'])
        t = common.tree_of_zip(z, pre, src['tree'].get('scope', []), src['tree'].get('lower', False))
        return pre, t


def reconstruct(src, why='Quell-URL liefert einen anderen Stand'):
    """Festgelegten Stand aus Grundstand + versionierten Updates + Korrekturen wiederherstellen."""
    rec = src.get('reconstruct')
    if not rec:
        raise SystemExit(f"[{src['id']}] {why} und es gibt kein Wiederherstellungsrezept. Neuen Stand bewusst übernehmen: "
                         'npm run library:fetch -- --update')
    print(f"[{src['id']}] {why} – Wiederherstellung aus Grundstand und Updates")
    dl = os.path.join(CACHE, 'downloads', src['id'] + '-recipe')
    scope, lower = src['tree'].get('scope', []), src['tree'].get('lower', False)
    files = {}  # rel -> (zip path, member name) oder Repository-Datei

    def add_zip(entry, name):
        path = os.path.join(dl, name)
        cached_download(entry['url'], path, entry['sha256'])
        if common.sha256_file(path) != entry['sha256']:
            raise SystemExit(f"[{src['id']}] Prüfsumme von {entry['url']} weicht ab – Wiederherstellung abgebrochen.")
        with zipfile.ZipFile(path) as z:
            pre = prefix_of(z, rec.get('prefix', src['tree']['prefix']))
            for info in z.infolist():
                n = info.filename.replace('\\', '/')
                if info.is_dir() or not n.lower().startswith(pre.lower()):
                    continue
                rel = common.norm(n[len(pre):], lower)
                if common.in_scope(rel, scope):
                    files[rel] = ('zip', path, info.filename)

    add_zip(rec['base'], 'base.zip')
    for u in rec['updates']:
        add_zip(u, f"update-{u['id']}.zip")
    for rel in rec.get('remove', []):
        files.pop(rel, None)
    for rel, repo_path in rec.get('override', {}).items():
        files[rel] = ('repo', os.path.join(ROOT, *repo_path.split('/')), None)
    final = os.path.join(CACHE, src['id'])
    target = fresh_dir(final)
    root = rec.get('root', 'ldraw')
    open_zips = {}
    for rel, (kind, path, member) in sorted(files.items()):
        dest = os.path.join(target, root, *rel.split('/'))
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        if kind == 'zip':
            if path not in open_zips:  # nicht setdefault: das würde das Archiv bei jeder Datei neu öffnen
                open_zips[path] = zipfile.ZipFile(path)
            data = open_zips[path].read(member)
        else:
            with open(path, 'rb') as fh:
                data = fh.read()
        with open(dest, 'wb') as out:
            out.write(data)
    for z in open_zips.values():
        z.close()
    tree = common.tree_of_dir(os.path.join(target, root), scope, lower)
    digest = common.tree_digest(tree)
    if digest != src['tree']['sha256']:
        raise SystemExit(f"[{src['id']}] Wiederhergestellter Stand weicht vom festgelegten ab ({digest}).")
    write_marker(target, src, 'wiederhergestellt', root)
    swap_in(target, final)
    print(f"[{src['id']}] festgelegter Stand wiederhergestellt und geprüft ({len(tree)} Dateien)")


def fetch_source(src, update):
    if marker_ok(src) and not update:
        print(f"[{src['id']}] vorhanden, Inhalts-Prüfwert stimmt")
        return False
    zip_path = os.path.join(CACHE, 'downloads', src['id'] + '.zip')
    if update or not os.path.exists(zip_path) or common.sha256_file(zip_path) != src.get('sha256'):
        print(f"[{src['id']}] lade {src['url']}")
        last_modified = download(src['url'], zip_path)  # bei --update immer frisch: der Zwischenspeicher könnte veraltet sein
    else:
        last_modified = src.get('lastModified')
    archive_sha = common.sha256_file(zip_path)
    pre, tree = zip_tree(zip_path, src)
    digest = common.tree_digest(tree)
    changed = False
    if digest != pinned_tree(src):
        if not update:
            reconstruct(src, 'Quell-URL liefert einen anderen Stand' if pinned_tree(src) else 'Stand ist noch nicht festgelegt')
            return False
        print(f"[{src['id']}] neuer Stand übernommen: Prüfwert {(pinned_tree(src) or 'keiner')[:12]}… → {digest[:12]}…")
        if src.get('reconstruct'):
            print(f"[{src['id']}] Hinweis: Das Wiederherstellungsrezept galt dem alten Stand und wurde entfernt. "
                  'Neues Rezept: python -I scripts/library/fetch.py --make-recipe <Grundstand-URL> <Update-IDs>')
            del src['reconstruct']
        src['tree'].update(sha256=digest, files=len(tree))
        changed = True
    if archive_sha != src.get('sha256'):
        if not update and digest == pinned_tree(src):
            print(f"[{src['id']}] Archiv neu gepackt, Inhalt unverändert")
        src.update(sha256=archive_sha, bytes=os.path.getsize(zip_path), pinnedAt=now())
        if last_modified:
            src['lastModified'] = last_modified
        changed = changed or update
    final = os.path.join(CACHE, src['id'])
    target = fresh_dir(final)
    with zipfile.ZipFile(zip_path) as z:
        safe_extract(z, target)
    write_marker(target, src, 'Quell-URL', pre.rstrip('/'), archive_sha)
    swap_in(target, final)
    print(f"[{src['id']}] entpackt nach data-cache/{src['id']}/{pre}")
    return changed


def make_recipe(reg, base_url, update_ids):
    """Erzeugt das Wiederherstellungsrezept für den festgelegten LDraw-Stand (aus dem vorhandenen Quellpaket)."""
    src = next(s for s in reg['sources'] if s['id'] == 'ldraw')
    zip_path = os.path.join(CACHE, 'downloads', 'ldraw.zip')
    pre, pinned = zip_tree(zip_path, src)
    if common.tree_digest(pinned) != src['tree']['sha256']:
        raise SystemExit('Das vorhandene Quellpaket entspricht nicht dem festgelegten Stand.')
    dl = os.path.join(CACHE, 'downloads', 'ldraw-recipe')
    scope, lower = src['tree']['scope'], src['tree']['lower']
    entries, state = [], {}
    for name, url in [('base.zip', base_url)] + [(f'update-{u}.zip', f'https://library.ldraw.org/library/updates/lcad{u}.zip') for u in update_ids]:
        path = os.path.join(dl, name)
        cached_download(url, path)
        with zipfile.ZipFile(path) as z:
            state.update(common.tree_of_zip(z, prefix_of(z, src['tree']['prefix']), scope, lower))
        entries.append({'url': url, 'sha256': common.sha256_file(path), 'bytes': os.path.getsize(path)})
    remove = sorted(set(state) - set(pinned))
    override = {}
    for rel in sorted(k for k in pinned if state.get(k) != pinned[k]):
        repo_rel = f'data/library/ldraw-overrides/{rel}'
        dest = os.path.join(ROOT, *repo_rel.split('/'))
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with zipfile.ZipFile(zip_path) as z:
            member = next(i.filename for i in z.infolist() if common.norm(i.filename[len(pre):], lower) == rel)
            with open(dest, 'wb') as out:
                out.write(z.read(member))
        override[rel] = repo_rel
    src['reconstruct'] = {
        'note': 'Grundstand (Webarchiv) + versionierte LDraw-Monats-Updates; Löschungen und außerhalb der Updates '
                'geänderte Dateien sind ausdrücklich aufgeführt. Ergebnis wird gegen tree.sha256 geprüft.',
        'base': entries[0], 'updates': [dict(e, id=u) for e, u in zip(entries[1:], update_ids)],
        'remove': remove, 'override': override, 'root': 'ldraw',
    }
    print(f'Rezept: {len(update_ids)} Updates, {len(remove)} Löschungen, {len(override)} Korrekturdateien')


def main():
    args = sys.argv[1:]
    with open(REGISTRY, encoding='utf8') as fh:
        reg = json.load(fh)
    changed = False
    if args[:1] == ['--make-recipe']:
        make_recipe(reg, args[1], args[2:])
        changed = True
    elif args[:1] == ['--reconstruct']:  # Probe: festgelegten Stand ausschließlich über das Rezept herstellen
        for src in reg['sources']:
            if src['id'] in (args[1:] or ['ldraw']):
                reconstruct(src, 'Probe der Wiederherstellung')
    else:
        update = '--update' in args
        only = [a for a in args if not a.startswith('--')]
        for src in reg['sources']:
            if not only or src['id'] in only:
                changed = fetch_source(src, update) or changed
    if changed:
        with open(REGISTRY, 'w', encoding='utf8', newline='\n') as fh:
            json.dump(reg, fh, ensure_ascii=False, indent=2)
            fh.write('\n')
        print('Quellenregister aktualisiert: data/library/sources.json – danach: npm run library:import')
    print('Fertig.')


if __name__ == '__main__':
    # Ausgabe immer UTF-8 (Windows-Konsole/Umleitung nutzt sonst cp1252 und bricht bei Umlauten/Pfeilen ab)
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    main()
