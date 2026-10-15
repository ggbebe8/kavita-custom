from pathlib import Path
import json
import os
import subprocess
import tarfile
import tempfile

root=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='kavita-portable-test-') as tmp:
    tmp=Path(tmp)
    with tarfile.open(root/'kavita-features.tar.gz') as archive:
        assert all(m.name.startswith('portable-features/') for m in archive.getmembers())
        assert not any(m.name.endswith('.db') for m in archive.getmembers())
        archive.extractall(tmp,filter='data')
    books,config,target=tmp/'my books $literal',tmp/'custom settings',tmp/'deployment'
    books.mkdir();config.mkdir()
    (books/'preserve.txt').write_text('book-data');(config/'preserve.txt').write_text('config-data')
    command=['python3',str(tmp/'portable-features/install.py'),'--books-dir',str(books),'--config-dir',str(config),'--target',str(target),'--port','15800']
    subprocess.run(command,check=True)
    rendered=json.loads(subprocess.check_output(['docker','compose','-f',str(target/'compose.yaml'),'config','--format','json']))
    mounts=rendered['services']['kavita']['volumes']
    assert any(v['source'] in [str(books),str(books).replace('$','$$')] and v['target']=='/books' for v in mounts)
    assert any(v['source']==str(config) and v['target']=='/kavita/config' for v in mounts)
    assert rendered['services']['swipe-proxy']['ports'][0]['published']=='15800'
    assert 'tts' in rendered['services'] and 'ports' not in rendered['services']['tts']
    assert int(rendered['services']['tts']['mem_limit'])==1073741824
    assert (target/'tts/server.py').read_bytes()==(root/'tts/server.py').read_bytes()
    assert (target/'SERVER-TTS.md').is_file()
    no_tts=json.loads(subprocess.check_output(['docker','compose','-f',str(target/'compose.no-tts.yaml'),'config','--format','json']))
    assert 'tts' not in no_tts['services'] and 'swipe-proxy' in no_tts['services']
    assert all('container_name' not in service for service in rendered['services'].values())
    assert (target/'proxy/swipe.js').read_bytes()==(root/'proxy/swipe.js').read_bytes()
    assert json.loads((target/'proxy/pwa/manifest.webmanifest').read_text())['display']=='standalone'
    assert (target/'proxy/pwa/icon-512.png').read_bytes()==(root/'proxy/pwa/icon-512.png').read_bytes()
    for name in ['app.js','store.js','sync.js','download.js','worker.js','bridge.js','index.html','offline.css','disable-worker.js']:
        assert (target/'proxy/pwa/offline'/name).read_bytes()==(root/'proxy/pwa/offline'/name).read_bytes()
    assert 'Service-Worker-Allowed' in (target/'proxy/default.conf').read_text()
    assert (target/'OFFLINE.md').is_file()
    assert any(v['target']=='/usr/share/nginx/html/pwa' and v['read_only'] for v in rendered['services']['swipe-proxy']['volumes'])
    assert (books/'preserve.txt').read_text()=='book-data'
    assert (config/'preserve.txt').read_text()=='config-data'
    assert list(config.iterdir())==[config/'preserve.txt']
    result=subprocess.run(command,capture_output=True,text=True)
    assert result.returncode!=0 and 'refusing to overwrite' in result.stderr
    subprocess.run(['docker','compose','-f',str(target/'compose.original.yaml'),'config','--quiet'],check=True)
    # No options: use HOME/docker/kavita-custom and create books/config safely.
    fake_home=tmp/'new-home';fake_home.mkdir()
    env=dict(os.environ,HOME=str(fake_home))
    subprocess.run(['python3',str(tmp/'portable-features/install.py')],env=env,check=True)
    default_target=fake_home/'docker/kavita-custom'
    assert (default_target/'books').is_dir() and (default_target/'config').is_dir()
    defaults=json.loads((default_target/'compose.yaml').read_text())['services']
    assert str(default_target/'books')+':/books' in defaults['kavita']['volumes']
    assert str(default_target/'config')+':/kavita/config' in defaults['kavita']['volumes']
    assert defaults['swipe-proxy']['ports']==['0.0.0.0:5000:80']
    subprocess.run(['docker','compose','-f',str(default_target/'compose.yaml'),'config','--quiet'],check=True)
    # Mixed options: provided config, automatic books under a custom target.
    mixed=tmp/'mixed-target'
    subprocess.run(['python3',str(tmp/'portable-features/install.py'),'--target',str(mixed),'--config-dir',str(config)],check=True)
    mixed_services=json.loads((mixed/'compose.yaml').read_text())['services']
    assert (mixed/'books').is_dir() and not (mixed/'config').exists()
    assert str(config)+':/kavita/config' in mixed_services['kavita']['volumes']
    assert (config/'preserve.txt').read_text()=='config-data'
    missing=tmp/'missing-target'
    result=subprocess.run(['python3',str(tmp/'portable-features/install.py'),'--target',str(missing),'--books-dir',str(tmp/'nonexistent')],capture_output=True,text=True)
    assert result.returncode!=0 and not missing.exists()
    https_target=tmp/'https-target'
    subprocess.run(['python3',str(tmp/'portable-features/install.py'),'--target',str(https_target),'--https-domain','books.example.com','--without-tts'],check=True)
    https=json.loads(subprocess.check_output(['docker','compose','-f',str(https_target/'compose.yaml'),'config','--format','json']))
    assert 'caddy' in https['services'] and 'tts' not in https['services']
    assert {p['published'] for p in https['services']['caddy']['ports']}=={'80','443'}
    assert (https_target/'proxy/Caddyfile').read_text()=='books.example.com {\n    reverse_proxy swipe-proxy:80\n}\n'
    invalid=tmp/'invalid-domain'
    result=subprocess.run(['python3',str(tmp/'portable-features/install.py'),'--target',str(invalid),'--https-domain','bad;hostname'],capture_output=True,text=True)
    assert result.returncode!=0 and not invalid.exists()
    (tmp/'portable-features/proxy/swipe.js').write_text('corrupted')
    corrupt_command=command.copy();corrupt_command[corrupt_command.index('--target')+1]=str(tmp/'other')
    result=subprocess.run(corrupt_command,capture_output=True,text=True)
    # Integrity validation happens before any data or target mutation.
    assert result.returncode!=0 and 'checksum mismatch' in result.stderr
    assert not (tmp/'other').exists()
print('Portable feature tests passed: no-option defaults, mixed options, arbitrary paths/spaces/dollars, custom port, original JS, valid Compose/rollback, unchanged data, overwrite protection. No Docker containers were changed.')
