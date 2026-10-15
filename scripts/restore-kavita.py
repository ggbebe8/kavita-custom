#!/usr/bin/env python3
"""Restore a verified Kavita package without overwriting existing data."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import tarfile
import tempfile


def run(*args, cwd=None):
    subprocess.run(args, cwd=cwd, check=True)


def verify(archive):
    expected = Path(str(archive) + '.sha256').read_text().split()[0]
    with archive.open('rb') as stream:
        actual = hashlib.file_digest(stream, 'sha256').hexdigest()
    if actual != expected:
        raise ValueError('Archive checksum mismatch')
    with tarfile.open(archive) as tar:
        manifest = json.load(tar.extractfile('manifest.json'))
        members = tar.getmembers()
        seen = set()
        for member in members:
            p = Path(member.name)
            if p.is_absolute() or '..' in p.parts or not member.isfile() or member.name in seen:
                raise ValueError('Unsafe archive entry')
            seen.add(member.name)
            if member.name != 'manifest.json':
                stream = tar.extractfile(member)
                if hashlib.file_digest(stream, 'sha256').hexdigest() != manifest['files'].get(member.name):
                    raise ValueError('File checksum mismatch: ' + member.name)
        if seen != set(manifest['files']) | {'manifest.json'}:
            raise ValueError('Manifest entries mismatch')
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path, nargs='?', help='Default: latest package next to this script')
    parser.add_argument('--project-dir', type=Path, default=Path.home() / 'docker/kavita')
    parser.add_argument('--books-dir', type=Path, default=Path('/mnt/d/Kavita/books'))
    parser.add_argument('--verify-only', action='store_true')
    parser.add_argument('--extract-only', action='store_true', help='Restore files without starting Docker')
    args = parser.parse_args()
    package_dir = Path(__file__).resolve().parent
    archive = (args.archive or package_dir / (package_dir / 'LATEST').read_text().strip()).resolve()
    manifest = verify(archive)
    print('Archive and all file checksums verified.', flush=True)
    if args.verify_only:
        return
    project, books = args.project_dir.resolve(), args.books_dir.resolve()
    if project.exists():
        raise ValueError('Project directory already exists; refusing to overwrite: ' + str(project))
    if any(c in str(books) for c in '\n\r:'):
        raise ValueError('Unsupported books directory')
    if books == project or books.is_relative_to(project) or project.is_relative_to(books):
        raise ValueError('Project and books directories must be separate')
    if books.exists():
        # Existing books can be reused only when every bundled file matches.
        for name, digest in manifest['files'].items():
            if not name.startswith('books/'):
                continue
            file = books / name.removeprefix('books/')
            if not file.is_file() or file.is_symlink():
                raise ValueError('Existing books differ; choose an empty --books-dir')
            with file.open('rb') as stream:
                if hashlib.file_digest(stream, 'sha256').hexdigest() != digest:
                    raise ValueError('Existing books differ; choose an empty --books-dir')
    if not args.extract_only:
        if not shutil.which('docker'):
            raise ValueError('Install Docker Engine and Compose first')
        run('docker', 'compose', 'version')
        run('docker', 'info', '--format', '{{.ServerVersion}}')
        for name in ['kavita', 'kavita-swipe-proxy']:
            if subprocess.run(['docker', 'inspect', name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
                raise ValueError('Existing Kavita container detected; refusing to replace it')
        if str(books).startswith('/mnt/d/') and not os.path.ismount('/mnt/d'):
            raise ValueError('Windows D: is not mounted at /mnt/d')
    project.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='kavita-restore-') as tmp:
        with tarfile.open(archive) as tar:
            tar.extractall(tmp, filter='data')
        staging = Path(tmp)
        for db in (staging / 'project/config').glob('*.db'):
            with sqlite3.connect(db.as_uri() + '?mode=ro', uri=True) as conn:
                if conn.execute('PRAGMA integrity_check').fetchone() != ('ok',):
                    raise ValueError('SQLite integrity check failed: ' + db.name)
        for name in ['compose.yaml', 'compose.swipe.yaml']:
            file = staging / 'project' / name
            file.write_text(file.read_text().replace('__KAVITA_BOOKS_PATH__', str(books)))
        # Never copy into an existing config or overwrite existing books.
        if not books.exists():
            shutil.copytree(staging / 'books', books)
        shutil.copytree(staging / 'project', project)
    print('Restored config to WSL:', project / 'config', flush=True)
    print('Books:', books, flush=True)
    if args.extract_only:
        print('Files restored; Docker was not changed.')
        return
    run('docker', 'compose', '-p', 'kavita', '-f', 'compose.swipe.yaml', 'config', '--quiet', cwd=project)
    run('docker', 'compose', '-p', 'kavita', '-f', 'compose.swipe.yaml', 'pull', '--ignore-buildable', cwd=project)
    run('docker', 'compose', '-p', 'kavita', '-f', 'compose.swipe.yaml', 'up', '-d', '--build', cwd=project)
    run('docker', 'compose', '-p', 'kavita', '-f', 'compose.swipe.yaml', 'ps', cwd=project)
    print('Kavita restored on port 5000. Allow startup to finish, then open the existing URL.')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError, tarfile.TarError) as error:
        raise SystemExit('Restore stopped: ' + str(error))
