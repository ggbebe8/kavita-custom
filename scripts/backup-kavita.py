#!/usr/bin/env python3
"""Create a portable package including books, online SQLite backups and custom UI."""
import argparse
import datetime
import hashlib
import io
import json
from pathlib import Path
import shutil
import sqlite3
import subprocess
import tarfile
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', type=Path, default=Path(__file__).resolve().parents[1] / 'reinstall')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    inspect = json.loads(subprocess.check_output(['docker', 'inspect', 'kavita']))[0]
    mounts = {m['Destination']: Path(m['Source']) for m in inspect['Mounts']}
    config, books = mounts['/kavita/config'], mounts['/books']
    output = args.output_dir.resolve()
    if any(output == source or output.is_relative_to(source) for source in [config, books]):
        raise ValueError('Output must be outside config and books')
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    archive = output / ('kavita-' + datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f') + '.tar.gz')
    files = {}
    with tempfile.TemporaryDirectory(prefix='kavita-backup-') as tmp:
        snapshots = Path(tmp)
        for db in config.glob('*.db'):
            with sqlite3.connect(db.as_uri() + '?mode=ro', uri=True) as source, sqlite3.connect(snapshots / db.name) as target:
                source.backup(target)
                if target.execute('PRAGMA integrity_check').fetchone() != ('ok',):
                    raise ValueError('SQLite integrity check failed')
        with tarfile.open(archive, 'x:gz') as tar:
            def add_bytes(name, data):
                entry = tarfile.TarInfo(name)
                entry.size, entry.mode = len(data), 0o600
                tar.addfile(entry, io.BytesIO(data))
                files[name] = hashlib.sha256(data).hexdigest()
            for name in ['compose.yaml', 'compose.swipe.yaml']:
                content = (root / name).read_text()
                content = content.replace(str(config), './config').replace(str(books), '__KAVITA_BOOKS_PATH__')
                if './config:/kavita/config' not in content or '__KAVITA_BOOKS_PATH__:/books' not in content:
                    raise ValueError('Compose mounts do not match the running container')
                if name == 'compose.yaml':
                    content = content.replace('ghcr.io/kareadita/kavita:latest', inspect['Config']['Image'])
                add_bytes('project/' + name, content.encode())
            for folder in ['proxy', 'scripts', 'tests', 'tts']:
                for path in (root / folder).rglob('*'):
                    if path.is_file() and '__pycache__' not in path.parts:
                        add_bytes('project/' + str(path.relative_to(root)), path.read_bytes())
            for name in ['README.swipe.md', 'REINSTALL.md', 'OFFLINE.md', 'SERVER-TTS.md']:
                add_bytes('project/' + name, (root / name).read_bytes())
            print('Packing config and books without stopping the service...', flush=True)
            for source, prefix in [(config, 'project/config'), (books, 'books')]:
                for path in source.rglob('*'):
                    if not path.is_file():
                        continue
                    if path.is_symlink():
                        raise ValueError('Symlinks are not supported: ' + str(path))
                    if source == config and path.name.endswith(('.db', '.db-wal', '.db-shm')):
                        continue
                    add_bytes(prefix + '/' + str(path.relative_to(source)), path.read_bytes())
            for path in snapshots.glob('*.db'):
                add_bytes('project/config/' + path.name, path.read_bytes())
            manifest = {'created': datetime.datetime.now().isoformat(), 'files': files, 'sqlite': 'online backup, integrity_check ok'}
            data = json.dumps(manifest, ensure_ascii=False, indent=2).encode()
            entry = tarfile.TarInfo('manifest.json'); entry.size = len(data); entry.mode = 0o600
            tar.addfile(entry, io.BytesIO(data))
    archive.chmod(0o600)
    with archive.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    Path(str(archive) + '.sha256').write_text(digest + '  ' + archive.name + '\n')
    restore = output / 'restore-kavita.py'
    shutil.copy2(root / 'scripts/restore-kavita.py', restore)
    shutil.copy2(root / 'REINSTALL.md', output / 'REINSTALL.md')
    subprocess.run(['python3', str(restore), str(archive), '--verify-only'], check=True)
    (output / 'LATEST').write_text(archive.name + '\n')
    print('Verified package:', archive)
    print('Copy this entire output folder to storage outside the disk you will format.')


if __name__ == '__main__':
    main()
