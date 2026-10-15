"""Isolated HTTP/MP3 regression: no production data or real speech model."""
import base64
import json
import os
from pathlib import Path
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
import server


def token(owner):
    return 'Bearer header.' + base64.urlsafe_b64encode(json.dumps({'nameid': owner}).encode()).decode().rstrip('=') + '.signature'


class Upstream(BaseHTTPRequestHandler):
    calls = []
    def log_message(self, *_):
        pass
    def do_GET(self):
        self.calls.append(self.path)
        if self.headers.get('Authorization') not in (token('a'), token('b')):
            self.send_response(401); self.end_headers(); return
        body = json.dumps({'pages': 3, 'seriesFormat': 3, 'bookTitle': 'Fixture'}) if self.path.endswith('book-info') else '<style>skip</style><p>첫 문장입니다. 다음 문장입니다.</p><button>skip</button>'
        self.send_response(200); self.end_headers(); self.wfile.write(body.encode())


class FakeEngine:
    count = 0
    def generate(self, text, voice, language):
        self.count += 1
        time.sleep(.08)
        return type('Audio', (), {'samples': np.sin(np.arange(48000) * .1).astype(np.float32) * .1, 'sample_rate': 24000})()


class Test(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        server.DATA = Path(cls.tmp.name)
        cls.upstream = ThreadingHTTPServer(('127.0.0.1', 0), Upstream)
        cls.http = ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        server.UPSTREAM = 'http://127.0.0.1:' + str(cls.upstream.server_port)
        cls.base = 'http://127.0.0.1:' + str(cls.http.server_port)
        server.SERVICE = server.Service(FakeEngine())
        for http in [cls.upstream, cls.http]:
            threading.Thread(target=http.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        for http in [cls.upstream, cls.http]:
            http.shutdown(); http.server_close()
        cls.tmp.cleanup()

    def request(self, path, method='GET', data=None, owner='a', headers=None):
        h = {'Authorization': token(owner), 'Content-Type': 'application/json', **(headers or {})}
        request = urllib.request.Request(self.base + path, method=method, headers=h, data=json.dumps(data).encode() if data is not None else None)
        return urllib.request.urlopen(request, timeout=15)

    def test_narration(self):
        self.assertEqual(server.plain('<div>a <b>b</b><script>bad</script><i hidden>x</i></div>'), 'a b')
        self.assertEqual(list(server.sentences('안녕하세요. 다음입니다!')), ['안녕하세요.', '다음입니다!'])
        body = {'chapterId': 1, 'section': 0, 'anchor': '첫 문장', 'voice': 0, 'language': 'ko'}
        with self.assertRaises(urllib.error.HTTPError) as denied:
            self.request('/v1/sessions', 'POST', body, 'unauthorized')
        self.assertEqual(denied.exception.code, 401)
        with self.request('/v1/sessions', 'POST', body) as response:
            created = json.load(response)
        session = server.SERVICE.sessions[created['id']]
        self.assertNotIn('Bearer', json.dumps(created))
        with self.assertRaises(urllib.error.HTTPError) as denied:
            self.request('/v1/sessions/' + session.id, owner='b')
        self.assertEqual(denied.exception.code, 403)
        # Browser's initial Range must remain one continuous live response.
        with self.request('/v1/sessions/' + session.id + '/audio.mp3', headers={'Range': 'bytes=0-'}) as response:
            stream = response.read()
            self.assertEqual(response.headers['Content-Type'], 'audio/mpeg')
            self.assertEqual(response.headers['Transfer-Encoding'], 'chunked')
        self.assertTrue(session.done)
        self.assertEqual(stream, session.path.read_bytes())
        self.assertEqual(len(session.chunks), 6)
        self.assertEqual([c['section'] for c in session.chunks], [0, 0, 1, 1, 2, 2])
        self.assertEqual(session.duration, len(stream) / 8000)
        self.assertTrue(all('skip' not in c['text'] for c in session.chunks))
        self.assertLessEqual(server.SERVICE.engine.count, 2, 'sentence cache reused across sections')
        with self.request('/v1/sessions/' + session.id + '/audio.mp3', headers={'Range': 'bytes=10-99'}) as response:
            self.assertEqual(response.status, 206); self.assertEqual(response.read(), stream[10:100])
        with self.request('/v1/sessions/' + session.id, 'POST', {'position': 0, 'playing': False, 'rate': 1.4}):
            pass
        self.assertFalse(session.playing)
        with self.request('/v1/sessions/' + session.id, 'DELETE'):
            pass
        self.assertTrue(session.stopped)
        self.assertFalse(session.authorization)
        server.SERVICE.prune()
        self.assertFalse(session.path.exists())
        old = server.DATA / 'cache' / ('0' * 64 + '.mp3'); old.write_bytes(b'old')
        ago = time.time() - 15 * 86400; os.utime(old, (ago, ago)); server.SERVICE.prune()
        self.assertFalse(old.exists())
        self.assertFalse(any('progress' in path for path in Upstream.calls))
        # Native audio itself is valid and the MP3 byte timeline matches decode.
        import subprocess
        decoded = subprocess.run(['ffmpeg', '-v', 'error', '-f', 'mp3', '-i', 'pipe:0', '-f', 's16le', '-ar', '24000', '-ac', '1', 'pipe:1'], input=stream, capture_output=True, check=True)
        self.assertAlmostEqual(len(decoded.stdout) / 48000, len(stream) / 8000, places=4)


if __name__ == '__main__':
    unittest.main()
