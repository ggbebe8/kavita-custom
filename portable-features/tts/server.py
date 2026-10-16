"""Authenticated EPUB narration, delivered as one continuous MP3 response.

The server reads Kavita through its authenticated API. It never mounts books
or config and never writes reading progress, annotations or the Kavita DB.
"""
import base64
from dataclasses import dataclass, field
import hashlib
from html.parser import HTMLParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import logging
import math
import os
from pathlib import Path
import re
import secrets
import subprocess
import threading
import time
import urllib.error
import urllib.request
from urllib.parse import urlsplit, parse_qs

from model import Engine, NAME

LOG = logging.getLogger('tts')
UPSTREAM = os.environ.get('KAVITA_URL', 'http://kavita:5000').rstrip('/')
DATA = Path(os.environ.get('TTS_DATA_DIR', '/data'))
CACHE_DAYS = 14
CACHE_LIMIT = int(os.environ.get('TTS_CACHE_MB', '512')) * 1024 * 1024
LANGUAGES = {'ko', 'en', 'ja', 'ar', 'bg', 'cs', 'da', 'de', 'el', 'es', 'et', 'fi', 'fr', 'hi', 'hr', 'hu', 'id', 'it', 'lt', 'lv', 'nl', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sv', 'tr', 'uk', 'vi'}


class RequestError(Exception):
    def __init__(self, code, message):
        self.code, self.message = code, message


class Text(HTMLParser):
    """Ignore non-reading markup and normalize text consistently with the UI."""
    OMIT = {'script', 'style', 'noscript', 'button', 'input', 'textarea', 'select', 'svg', 'audio', 'video'}
    VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack, self.parts = [], []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        skip = tag in self.OMIT or a.get('aria-hidden') == 'true' or 'hidden' in a or bool(re.search(r'display\s*:\s*none|visibility\s*:\s*hidden', a.get('style', ''), re.I))
        if tag not in self.VOID:
            self.stack.append((tag, skip or any(item[1] for item in self.stack)))

    def handle_startendtag(self, tag, attrs):
        pass

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index][0] == tag:
                del self.stack[index:]
                break

    def handle_data(self, data):
        if not any(item[1] for item in self.stack) and data.strip():
            self.parts.append(re.sub(r'\s+', ' ', data).strip())


def plain(html):
    parser = Text()
    parser.feed(html)
    return ' '.join(parser.parts)


def sentences(text):
    # Preserve full sentences across rendered screen pages. Extremely long
    # unpunctuated paragraphs are split at whitespace to bound inference RAM.
    for match in re.finditer(r'.+?(?:[.!?。！？]+(?:["”’\x27」』)]*)(?=\s|$)|$)', text, re.S):
        body = match.group().strip()
        while len(body) > 500:
            split = body.rfind(' ', 0, 500)
            if split < 100:
                split = 500
            yield body[:split].strip()
            body = body[split:].strip()
        if body:
            yield body


def read_api(path, authorization, json_body=True):
    request = urllib.request.Request(UPSTREAM + path, headers={'Authorization': authorization, 'Accept': 'application/json' if json_body else 'text/html'})
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            body = response.read(8 * 1024 * 1024 + 1)
            if len(body) > 8 * 1024 * 1024:
                raise RequestError(413, '본문 구간이 너무 큽니다.')
            value = body.decode('utf-8-sig')
            return json.loads(value) if json_body else value
    except urllib.error.HTTPError as error:
        code = error.code if error.code in (401, 403, 404) else 502
        raise RequestError(code, '로그인 또는 책 접근 권한을 확인하세요.') from None
    except (OSError, ValueError):
        raise RequestError(502, 'Kavita에서 책 정보를 받지 못했습니다.') from None


def identify(authorization):
    # Only used AFTER a successful authenticated Kavita request, never as a
    # substitute for signature verification by Kavita itself.
    try:
        payload = authorization.split()[1].split('.')[1]
        claims = json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4)))
        owner = claims.get('nameid') or claims.get('sub') or claims.get('http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier')
        if not owner:
            raise ValueError()
        return hashlib.sha256(str(owner).encode()).hexdigest()
    except (ValueError, KeyError, IndexError):
        raise RequestError(401, 'Kavita 로그인 토큰이 필요합니다.') from None


@dataclass
class Session:
    owner: str
    chapter: int
    section: int
    anchor: str
    voice: int
    language: str
    authorization: str = field(repr=False)
    title: str = ''
    pages: int = 0
    id: str = field(default_factory=lambda: secrets.token_urlsafe(32), repr=False)
    created: float = field(default_factory=time.time)
    updated: float = field(default_factory=time.monotonic)
    position: float = 0
    rate: float = 1
    playing: bool = True
    started: bool = False
    done: bool = False
    stopped: bool = False
    error: str = ''
    duration: float = 0
    size: int = 0
    chunks: list = field(default_factory=list)
    condition: threading.Condition = field(default_factory=threading.Condition, repr=False)
    readers: int = 0

    @property
    def path(self):
        return DATA / 'sessions' / (self.id + '.mp3')

    def clock(self):
        return self.position + ((time.monotonic() - self.updated) * self.rate if self.playing and self.started else 0)

    def stop(self):
        with self.condition:
            self.stopped = True
            self.authorization = ''
            self.condition.notify_all()


class Service:
    def __init__(self, engine):
        self.engine, self.sessions = engine, {}
        self.lock, self.engine_lock = threading.Lock(), threading.Lock()
        for folder in ['cache', 'sessions']:
            (DATA / folder).mkdir(parents=True, exist_ok=True, mode=0o700)
        # Previous sessions have no valid in-memory capability after restart.
        for path in (DATA / 'sessions').glob('*.mp3'):
            path.unlink()
        self.prune()

    def prune(self):
        now = time.time()
        with self.lock:
            expired = [s for s in self.sessions.values() if now - s.created > 12 * 3600 or s.stopped and s.readers == 0]
            for s in expired:
                s.stop()
                if not s.readers:
                    s.path.unlink(missing_ok=True)
                    self.sessions.pop(s.id, None)
        files = sorted((DATA / 'cache').glob('*.mp3'), key=lambda p: p.stat().st_mtime)
        total = sum(p.stat().st_size for p in files)
        for path in files:
            stat = path.stat()
            if now - stat.st_mtime > CACHE_DAYS * 86400 or total > CACHE_LIMIT:
                path.unlink(missing_ok=True)
                total -= stat.st_size

    def create(self, body, authorization):
        chapter, section, voice = body.get('chapterId'), body.get('section'), body.get('voice', 10)
        if type(chapter) is not int or chapter < 1 or type(section) is not int or type(voice) is not int or not 0 <= voice <= 10:
            raise RequestError(400, '책·구간·음성 설정이 올바르지 않습니다.')
        language, anchor = body.get('language', 'ko'), body.get('anchor', '')
        if language not in LANGUAGES or not isinstance(anchor, str) or len(anchor) > 300:
            raise RequestError(400, '언어 또는 시작 위치가 올바르지 않습니다.')
        if voice == 10 and language != 'ko':
            raise RequestError(400, '빠른 한국어 음성은 한국어에서 선택하세요.')
        info = read_api(f'/api/book/{chapter}/book-info', authorization)
        owner = identify(authorization)
        pages = info.get('pages')
        if info.get('seriesFormat') != 3 or type(pages) is not int or not 0 <= section < pages:
            raise RequestError(400, 'EPUB 본문에서만 서버 읽기를 사용할 수 있습니다.')
        self.prune()
        with self.lock:
            for old in list(self.sessions.values()):
                if old.owner == owner:
                    old.stop()
            if sum(not s.stopped and not s.done for s in self.sessions.values()) >= 2:
                raise RequestError(429, '다른 책을 읽는 중입니다. 잠시 후 다시 시도하세요.')
            session = Session(owner, chapter, section, anchor, voice, language, authorization,
                title=info.get('bookTitle') or info.get('seriesName') or 'Kavita', pages=pages)
            session.path.touch(mode=0o600)
            self.sessions[session.id] = session
        threading.Thread(target=self.generate, args=(session,), daemon=True).start()
        return session

    def encoded(self, session, text):
        key = hashlib.sha256(json.dumps([NAME, os.environ.get('TTS_STEPS', '2'), session.owner, session.voice, session.language, text], ensure_ascii=False).encode()).hexdigest()
        path = DATA / 'cache' / (key + '.mp3')
        # All inference/cache mutations are serialized, avoiding model races.
        with self.engine_lock:
            if path.is_file():
                data = path.read_bytes()
                os.utime(path, None)
                return data
            if session.stopped:
                return b''
            audio = self.engine.generate(text, session.voice, session.language)
            if hasattr(audio, 'samples'):
                if not len(audio.samples) or not 16000 <= audio.sample_rate <= 48000:
                    raise ValueError('Invalid model output')
                import numpy as np
                pcm = (np.clip(audio.samples, -1, 1) * 32767).astype('<i2').tobytes()
                result = subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-f', 's16le', '-ar', str(audio.sample_rate), '-ac', '1', '-i', 'pipe:0', '-codec:a', 'libmp3lame', '-b:a', '64k', '-ar', '24000', '-write_xing', '0', '-id3v2_version', '0', '-f', 'mp3', 'pipe:1'], input=pcm, capture_output=True, timeout=90, check=True)
            elif isinstance(audio, (bytes, bytearray)):
                result = subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-codec:a', 'libmp3lame', '-b:a', '64k', '-ar', '24000', '-write_xing', '0', '-id3v2_version', '0', '-f', 'mp3', 'pipe:1'], input=audio, capture_output=True, timeout=90, check=True)
            else:
                raise ValueError('Invalid audio output')
            data = result.stdout
            temp = path.with_suffix('.tmp')
            temp.write_bytes(data)
            temp.chmod(0o600)
            temp.replace(path)
            return data

    def generate(self, session):
        try:
            for section in range(session.section, session.pages):
                if session.stopped:
                    break
                html = read_api(f'/api/book/{session.chapter}/book-page?page={section}', session.authorization, False)
                if html.startswith('"'):
                    html = json.loads(html)
                text = plain(html)
                parts = list(sentences(text))
                if section == session.section and session.anchor:
                    index = text.find(session.anchor)
                    if index < 0:
                        raise RequestError(409, '본문 시작 위치를 찾지 못했습니다. 책을 다시 연 뒤 재생하세요.')
                    offset, start = 0, 0
                    for number, sentence in enumerate(parts):
                        at = text.find(sentence, offset)
                        if at <= index:
                            start = number
                        offset = at + len(sentence)
                    parts = parts[start:]
                offset = text.find(parts[0]) if parts else 0
                for sentence in parts:
                    offset = text.find(sentence, offset)
                    with session.condition:
                        while not session.stopped and session.duration > session.clock() + 90:
                            session.condition.wait(timeout=1)
                    if session.stopped:
                        break
                    data = self.encoded(session, sentence)
                    if session.stopped:
                        break
                    with session.condition:
                        start = session.duration
                        with session.path.open('ab') as output:
                            output.write(data)
                        session.size += len(data)
                        session.duration += len(data) / 8000
                        session.chunks.append({'section': section, 'text': sentence, 'offset': offset, 'start': start, 'end': session.duration})
                        offset += len(sentence)
                        session.condition.notify_all()
            with session.condition:
                session.done = not session.stopped
                session.condition.notify_all()
        except Exception as error:
            with session.condition:
                session.error = error.message if isinstance(error, RequestError) else '음성 생성에 실패했습니다. 다시 재생하세요.'
                session.done = True
                session.condition.notify_all()
            LOG.warning('Narration failed: %s', type(error).__name__)
        finally:
            # Credentials never enter persistent audio/model storage.
            session.authorization = ''


SERVICE = None


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, *_args):
        pass  # Never log capability URLs, JWTs or private book text.

    def send_json(self, value, code=200):
        data = json.dumps(value, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def body(self):
        length = int(self.headers.get('Content-Length', '0'))
        if not 0 < length <= 8192:
            raise RequestError(413, '요청이 너무 큽니다.')
        return json.loads(self.rfile.read(length))

    def run_request(self):
        path = urlsplit(self.path).path
        if path == '/health' and self.command == 'GET':
            return self.send_json({'ready': SERVICE is not None}, 200 if SERVICE else 503)
        if not SERVICE:
            raise RequestError(503, '서버 음성을 준비하고 있습니다. 잠시 후 다시 시도하세요.')
        if path == '/v1/status' and self.command == 'GET':
            return self.send_json({'available': True, 'engine': 'Neural Edge-TTS (자연스러운 음성)', 'voices': 11, 'languages': sorted(LANGUAGES)})
        authorization = self.headers.get('Authorization', '')
        if path == '/v1/sessions' and self.command == 'POST':
            session = SERVICE.create(self.body(), authorization)
            return self.send_json({'id': session.id, 'title': session.title, 'audio': '/kavita-tts/v1/sessions/' + session.id + '/audio.mp3'}, 201)
        match = re.fullmatch(r'/v1/sessions/([\w-]{40,60})(/audio.mp3)?', path)
        session = SERVICE.sessions.get(match[1]) if match else None
        if not session or session.stopped or time.time() - session.created > 12 * 3600:
            raise RequestError(404, '재생 세션이 만료되었습니다. 다시 재생하세요.')
        # Only audio uses the opaque, short-lived capability. Management and
        # private sentence metadata always require the authenticated owner.
        if match[2] and self.command in ('GET', 'HEAD'):
            return self.audio(session)
        read_api(f'/api/book/{session.chapter}/book-info', authorization)
        if identify(authorization) != session.owner:
            raise RequestError(403, '다른 계정의 재생 세션입니다.')
        if self.command == 'DELETE':
            session.stop()
            return self.send_json({'stopped': True})
        if self.command == 'POST':
            body = self.body()
            position, rate = body.get('position', 0), body.get('rate', 1)
            if not isinstance(position, (float, int)) or not math.isfinite(position) or not 0 <= position <= session.duration + 1 or not isinstance(rate, (float, int)) or not .5 <= rate <= 2:
                raise RequestError(400, '재생 위치가 올바르지 않습니다.')
            with session.condition:
                session.position, session.rate, session.playing = float(position), float(rate), bool(body.get('playing'))
                session.updated = time.monotonic()
                if not session.done:
                    session.authorization = authorization
                session.condition.notify_all()
            return self.send_json({'ok': True})
        if self.command == 'GET':
            after = int(parse_qs(urlsplit(self.path).query).get('after', ['0'])[0])
            if after < 0:
                raise RequestError(400, '문장 위치가 올바르지 않습니다.')
            return self.send_json({'chunks': session.chunks[after:], 'done': session.done, 'error': session.error, 'duration': session.duration})
        raise RequestError(405, '지원하지 않는 요청입니다.')

    def audio(self, session):
        # Live MP3 has no final Content-Length; a single chunked response keeps
        # playing across sentences/chapters even when page JS is suspended.
        self.connection.settimeout(120)
        with session.condition:
            deadline = time.monotonic() + 120
            while session.duration < 8 and not session.done and not session.stopped and time.monotonic() < deadline:
                session.condition.wait(timeout=1)
            if not session.size:
                raise RequestError(503, session.error or '음성을 생성하지 못했습니다. 다시 시도하세요.')
            session.readers += 1
            session.started = True
            session.updated = time.monotonic()
        try:
            start, finish = 0, None
            requested = self.headers.get('Range', '')
            if requested:
                match = re.fullmatch(r'bytes=(\d+)-(\d*)', requested)
                if match:
                    start = int(match[1])
                    if match[2]:
                        finish = int(match[2])
                if not match or start >= session.size or finish is not None and finish < start:
                    self.send_response(416)
                    self.send_header('Content-Range', 'bytes */' + str(session.size) if session.done else 'bytes */*')
                    self.send_header('Content-Length', '0')
                    self.end_headers()
                    return
            live = not session.done
            self.send_response(206 if requested else 200)
            self.send_header('Content-Type', 'audio/mpeg')
            self.send_header('Cache-Control', 'private, no-store')
            self.send_header('Referrer-Policy', 'no-referrer')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Accept-Ranges', 'bytes' if not live else 'none')
            if not live:
                finish = min(finish if finish is not None else session.size - 1, session.size - 1)
                self.send_header('Content-Length', str(finish - start + 1))
                if requested:
                    self.send_header('Content-Range', f'bytes {start}-{finish}/{session.size}')
            else:
                # For a live range request only the current prefix can have a
                # byte range. Unranged playback remains open for future audio.
                if requested:
                    finish = min(finish if finish is not None else session.size - 1, session.size - 1)
                    self.send_header('Content-Range', f'bytes {start}-{finish}/*')
                    self.send_header('Content-Length', str(finish - start + 1))
                else:
                    self.send_header('Transfer-Encoding', 'chunked')
            self.end_headers()
            if self.command == 'HEAD':
                return
            chunked = live and not requested
            # Browsers usually request bytes=0-. Treating that as a finite
            # prefix would stop after the first sentences; handled below by
            # ignoring the initial open-ended range before audio() is called.
            position = start
            with session.path.open('rb') as source:
                source.seek(start)
                while not session.stopped:
                    limit = 65536 if finish is None else min(65536, finish + 1 - position)
                    if limit <= 0:
                        break
                    data = source.read(limit)
                    if data:
                        if chunked:
                            self.wfile.write(f'{len(data):x}\r\n'.encode())
                        self.wfile.write(data)
                        if chunked:
                            self.wfile.write(b'\r\n')
                        self.wfile.flush()
                        position += len(data)
                    elif session.done:
                        break
                    else:
                        with session.condition:
                            session.condition.wait(timeout=1)
                if chunked:
                    self.wfile.write(b'0\r\n\r\n')
        finally:
            with session.condition:
                session.readers -= 1

    def do_GET(self):
        # An initial open-ended range is a normal media-element request. A
        # live stream is allowed to ignore Range and return the full response.
        if self.headers.get('Range') == 'bytes=0-':
            del self.headers['Range']
        try:
            self.run_request()
        except RequestError as error:
            self.send_json({'error': error.message}, error.code)
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            pass
        except (ValueError, TypeError):
            self.send_json({'error': '요청 형식이 올바르지 않습니다.'}, 400)
        except Exception as error:
            LOG.warning('Request failed: %s', type(error).__name__)
            self.send_json({'error': '서버 읽기 요청을 처리하지 못했습니다.'}, 500)

    do_POST = do_GET
    do_DELETE = do_GET
    do_HEAD = do_GET


def main():
    logging.basicConfig(level=logging.INFO)
    def prepare():
        global SERVICE
        while SERVICE is None:
            try:
                SERVICE = Service(Engine())
                LOG.info('CPU narration service ready')
            except Exception as error:
                LOG.error('TTS preparation failed: %s; retrying in 30s', type(error).__name__)
                time.sleep(30)
    threading.Thread(target=prepare, daemon=True).start()
    def cleanup():
        while True:
            time.sleep(300)
            if SERVICE:
                with SERVICE.engine_lock:
                    SERVICE.prune()
    threading.Thread(target=cleanup, daemon=True).start()
    ThreadingHTTPServer(('0.0.0.0', int(os.environ.get('PORT', '8000'))), Handler).serve_forever()


if __name__ == '__main__':
    main()
