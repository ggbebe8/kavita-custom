#!/usr/bin/env python3
"""Configure portable Kavita features; optionally build/start with --start."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import re


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--books-dir', type=Path, help='Default: TARGET/books (created automatically)')
    parser.add_argument('--config-dir', type=Path, help='Default: TARGET/config (created automatically)')
    parser.add_argument('--target', type=Path, default=Path.home() / 'docker/kavita-custom')
    parser.add_argument('--port', type=int, default=5000)
    parser.add_argument('--bind', default='0.0.0.0', choices=['0.0.0.0', '127.0.0.1'])
    parser.add_argument('--without-tts', action='store_true', help='Install existing features without server narration')
    parser.add_argument('--https-domain', help='Optional public DNS hostname; adds Caddy on ports 80/443')
    parser.add_argument('--start', action='store_true', help='Build and start the newly configured deployment')
    args = parser.parse_args()
    kit = Path(__file__).resolve().parent
    manifest = json.loads((kit / 'manifest.json').read_text())
    for name, digest in manifest.items():
        path = kit / name
        if Path(name).is_absolute() or '..' in Path(name).parts:
            raise ValueError('Invalid package manifest')
        if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            raise ValueError('Feature package checksum mismatch: ' + name)
    target = args.target.resolve()
    books = args.books_dir.resolve() if args.books_dir else target / 'books'
    config = args.config_dir.resolve() if args.config_dir else target / 'config'
    if not 1 <= args.port <= 65535:
        raise ValueError('Port must be between 1 and 65535')
    if args.https_domain and not re.fullmatch(r'(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}', args.https_domain):
        raise ValueError('HTTPS domain must be a plain DNS hostname')
    if args.https_domain and args.port in (80, 443):
        raise ValueError('HTTP service port conflicts with Caddy ports')
    for path, explicit in [(books, args.books_dir), (config, args.config_dir)]:
        if explicit and not path.is_dir():
            raise ValueError('Data directory must already exist: ' + str(path))
        if any(c in str(path) for c in '\n\r:'):
            raise ValueError('Use a Linux/WSL path without colons or newlines')
    if books == config or books.is_relative_to(config) or config.is_relative_to(books):
        raise ValueError('Books and config must be separate directories')
    if target.exists():
        raise ValueError('Target exists; refusing to overwrite: ' + str(target))
    if any(target == path or target.is_relative_to(path) for path in [books, config]):
        raise ValueError('Target cannot be inside a data directory')
    images = json.loads((kit / 'images.json').read_text())
    # Compose interpolation treats $$ as a literal $, including inside JSON/YAML strings.
    source = lambda path: str(path).replace('$', '$$')
    binding = f'{args.bind}:{args.port}'
    kavita = {'image': images['kavita'], 'environment': {'TZ': 'Asia/Seoul'},
              'volumes': [source(books) + ':/books', source(config) + ':/kavita/config'],
              'restart': 'unless-stopped'}
    proxy = {'image': images['nginx'], 'ports': [binding + ':80'],
             'volumes': ['./proxy/default.conf:/etc/nginx/conf.d/default.conf:ro',
                         './proxy/swipe.js:/usr/share/nginx/html/swipe.js:ro',
                         './proxy/pwa:/usr/share/nginx/html/pwa:ro'],
             'depends_on': ['kavita'], 'restart': 'unless-stopped'}
    original = dict(kavita, ports=[binding + ':5000'])
    services = {'kavita': kavita, 'swipe-proxy': proxy}
    volumes = {}
    if not args.without_tts:
        services['tts'] = {'build': './tts', 'image': 'kavita-server-tts:supertonic3-v1',
            'environment': {'KAVITA_URL': 'http://kavita:5000', 'TTS_THREADS': '2', 'TTS_CACHE_MB': '512'},
            'volumes': ['tts-data:/data'], 'restart': 'unless-stopped', 'cpus': 2, 'mem_limit': '1g',
            'security_opt': ['no-new-privileges:true'], 'cap_drop': ['ALL'],
            'depends_on': ['kavita']}
        volumes['tts-data'] = {}
    if args.https_domain:
        services['caddy'] = {'image': images['caddy'], 'ports': ['80:80', '443:443'],
            'volumes': ['./proxy/Caddyfile:/etc/caddy/Caddyfile:ro', 'caddy-data:/data', 'caddy-config:/config'],
            'depends_on': ['swipe-proxy'], 'restart': 'unless-stopped'}
        volumes.update({'caddy-data': {}, 'caddy-config': {}})
    target.mkdir(parents=True)
    if args.books_dir is None:
        books.mkdir()
    if args.config_dir is None:
        config.mkdir(mode=0o700)
    shutil.copytree(kit / 'proxy', target / 'proxy')
    shutil.copytree(kit / 'tts', target / 'tts')
    if args.https_domain:
        (target / 'proxy/Caddyfile').write_text(args.https_domain + ' {\n    reverse_proxy swipe-proxy:80\n}\n')
    shutil.copy2(kit / 'README.md', target / 'README.md')
    if (kit / 'OFFLINE.md').is_file():
        shutil.copy2(kit / 'OFFLINE.md', target / 'OFFLINE.md')
    shutil.copy2(kit / 'SERVER-TTS.md', target / 'SERVER-TTS.md')
    deployment = {'services': services}
    if volumes:
        deployment['volumes'] = volumes
    (target / 'compose.yaml').write_text(json.dumps(deployment, indent=2) + '\n')
    no_tts = dict(deployment, services={name: value for name, value in services.items() if name != 'tts'})
    (target / 'compose.no-tts.yaml').write_text(json.dumps(no_tts, indent=2) + '\n')
    (target / 'compose.original.yaml').write_text(json.dumps({'services': {'kavita': original}}, indent=2) + '\n')
    print('Feature configuration created:', target)
    print('User data was not copied or changed.' + (' Starting Docker next.' if args.start else ' Docker was not started.'))
    print('Books directory:', books, '(register /books in Kavita web library settings)')
    print('Config directory:', config)
    print('Service port:', args.port)
    print('Run in that directory: docker compose -p kavita-custom -f compose.yaml up -d --build')
    if args.start:
        subprocess.run(['docker', 'compose', '-p', 'kavita-custom', '-f', str(target / 'compose.yaml'), 'up', '-d', '--build'], cwd=target, check=True)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        raise SystemExit('Configuration stopped: ' + str(error))
