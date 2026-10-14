#!/usr/bin/env python3
"""Export only custom features, pinned images and configurable Compose setup."""
import hashlib
import json
import re
from pathlib import Path
import shutil
import tarfile

root = Path(__file__).resolve().parents[1]
# Any offline UI change creates a new worker script/cache version. Installed
# PWAs then fetch the new shell rather than retaining an older module forever.
offline = root / 'proxy/pwa/offline'
if offline.is_dir():
    worker = offline / 'worker.js'
    source = worker.read_text()
    normalised = re.sub(r"const VERSION='[^']+';", "const VERSION='@VERSION@';", source)
    digest = hashlib.sha256(normalised.encode())
    for path in sorted(offline.glob('*')):
        if path.is_file() and path != worker:
            digest.update(path.name.encode()); digest.update(path.read_bytes())
    worker.write_text(re.sub(r"const VERSION='[^']+';", "const VERSION='kavita-offline-shell-" + digest.hexdigest()[:16] + "';", source))
kit = root / 'portable-features'
kit.mkdir(exist_ok=True)
(kit / 'proxy').mkdir(exist_ok=True)
for name in ['swipe.js', 'default.conf', 'https.Caddyfile.example']:
    shutil.copy2(root / 'proxy' / name, kit / 'proxy' / name)
shutil.copytree(root / 'proxy/pwa', kit / 'proxy/pwa', dirs_exist_ok=True)
shutil.copy2(root / 'scripts/configure-features.py', kit / 'install.py')
shutil.copy2(root / 'PORTABLE-FEATURES.md', kit / 'README.md')
shutil.copy2(root / 'OFFLINE.md', kit / 'OFFLINE.md')
images = {
    'kavita': 'ghcr.io/kareadita/kavita@sha256:31181a32f0dda73cae68721867028a7253d57881b58bea5754cd9e578e75421a',
    'nginx': 'nginx@sha256:0985e772fb9f729e6fa0980da05fca5d9c468e870eed43071545afa9d2e27d94',
}
(kit / 'images.json').write_text(json.dumps(images, indent=2) + '\n')
names = ['install.py', 'README.md', 'OFFLINE.md', 'images.json', 'proxy/swipe.js', 'proxy/default.conf', 'proxy/https.Caddyfile.example']
names += sorted(str(path.relative_to(kit)) for path in (kit / 'proxy/pwa').rglob('*') if path.is_file())
(kit / 'manifest.json').write_text(json.dumps({name: hashlib.sha256((kit / name).read_bytes()).hexdigest() for name in names}, indent=2) + '\n')
archive = root / 'kavita-features.tar.gz'
with tarfile.open(archive, 'w:gz') as tar:
    for name in names + ['manifest.json']:
        tar.add(kit / name, arcname='portable-features/' + name)
Path(str(archive) + '.sha256').write_text(hashlib.sha256(archive.read_bytes()).hexdigest() + '  ' + archive.name + '\n')
print('Feature-only package:', archive)
print('Books, databases, accounts and original server paths are not included.')
