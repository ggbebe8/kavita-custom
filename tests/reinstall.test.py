"""Exercise portable restore without touching Docker or production data."""
from pathlib import Path
import hashlib
import sqlite3
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
archive = root / 'reinstall' / (root / 'reinstall/LATEST').read_text().strip()
restore = root / 'scripts/restore-kavita.py'
with tempfile.TemporaryDirectory(prefix='kavita-restore-test-') as tmp:
    tmp = Path(tmp)
    project, books = tmp / 'project', tmp / 'books'
    command = ['python3', str(restore), str(archive), '--extract-only', '--project-dir', str(project), '--books-dir', str(books)]
    subprocess.run(command, check=True)
    assert (project / 'config/kavita.db').is_file()
    assert any(books.rglob('*.epub'))
    assert (project / 'proxy/swipe.js').read_bytes() == (root / 'proxy/swipe.js').read_bytes()
    compose = (project / 'compose.swipe.yaml').read_text()
    assert './config:/kavita/config' in compose
    assert str(books) + ':/books' in compose
    subprocess.run(['docker', 'compose', '-f', str(project / 'compose.swipe.yaml'), 'config', '--quiet'], check=True)
    for db in (project / 'config').glob('*.db'):
        with sqlite3.connect(db.as_uri() + '?mode=ro', uri=True) as conn:
            assert conn.execute('PRAGMA integrity_check').fetchone() == ('ok',)
    before = hashlib.sha256((project / 'config/kavita.db').read_bytes()).hexdigest()
    result = subprocess.run(command, capture_output=True, text=True)
    assert result.returncode != 0 and 'refusing to overwrite' in result.stderr
    assert before == hashlib.sha256((project / 'config/kavita.db').read_bytes()).hexdigest()
    fake = tmp / 'corrupt.tar.gz'
    fake.write_bytes(b'not a valid backup')
    Path(str(fake) + '.sha256').write_text('0' * 64)
    result = subprocess.run(['python3', str(restore), str(fake), '--verify-only'], capture_output=True, text=True)
    assert result.returncode != 0 and 'checksum mismatch' in result.stderr
print('Restore tests passed: data/JS preserved, WSL config layout, valid Compose, existing data protected, corrupt package rejected. Docker was not changed.')
