"""Exercise portable restore without touching Docker or production data."""
from pathlib import Path
import hashlib
import sqlite3
import subprocess
import tempfile
import importlib.util
import shutil
from unittest.mock import patch
import json

root = Path(__file__).resolve().parents[1]
restore = root / 'scripts/restore-kavita.py'
with tempfile.TemporaryDirectory(prefix='kavita-restore-test-') as tmp:
    tmp = Path(tmp)
    # Exercise the real backup and restore scripts using only synthetic data.
    # Never package the user's books or read a production DB in this test.
    fixture=tmp/'fixture';fixture.mkdir()
    for folder in ['proxy','tts']:
        shutil.copytree(root/folder,fixture/folder,ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
    (fixture/'scripts').mkdir();(fixture/'tests').mkdir()
    shutil.copy2(restore,fixture/'scripts/restore-kavita.py')
    for name in ['README.swipe.md','REINSTALL.md','OFFLINE.md','SERVER-TTS.md']:
        shutil.copy2(root/name,fixture/name)
    source_config,source_books=tmp/'source-config',tmp/'source-books'
    source_config.mkdir();source_books.mkdir();(source_books/'fixture.epub').write_bytes(b'fixture book')
    with sqlite3.connect(source_config/'kavita.db') as db:
        db.execute('CREATE TABLE fixture(value TEXT)');db.execute("INSERT INTO fixture VALUES ('preserve')")
    for name in ['compose.yaml','compose.swipe.yaml']:
        (fixture/name).write_text((root/name).read_text().replace('/mnt/d/Kavita/config',str(source_config)).replace('/mnt/d/Kavita/books',str(source_books)))
    spec=importlib.util.spec_from_file_location('backup_fixture',root/'scripts/backup-kavita.py')
    backup=importlib.util.module_from_spec(spec);spec.loader.exec_module(backup)
    backup.__file__=str(fixture/'scripts/backup-kavita.py')
    inspect=[{'Mounts':[{'Destination':'/kavita/config','Source':str(source_config)},{'Destination':'/books','Source':str(source_books)}],'Config':{'Image':'ghcr.io/kareadita/kavita:fixture'}}]
    output=tmp/'backup-output'
    with patch('sys.argv',['backup-kavita.py','--output-dir',str(output)]),patch.object(backup.subprocess,'check_output',return_value=json.dumps(inspect).encode()):
        backup.main()
    archive=output/(output/'LATEST').read_text().strip()
    project, books = tmp / 'project', tmp / 'books'
    command = ['python3', str(restore), str(archive), '--extract-only', '--project-dir', str(project), '--books-dir', str(books)]
    subprocess.run(command, check=True)
    assert (project / 'config/kavita.db').is_file()
    assert any(books.rglob('*.epub'))
    assert (project / 'proxy/swipe.js').read_bytes() == (root / 'proxy/swipe.js').read_bytes()
    assert (project/'tts/server.py').read_bytes()==(root/'tts/server.py').read_bytes()
    assert (project/'SERVER-TTS.md').is_file()
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
