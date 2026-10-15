"""Pinned Korean-capable CPU model; downloads are verified before extraction."""
import hashlib
import os
from pathlib import Path
import shutil
import tarfile
import tempfile
import urllib.request

NAME = 'sherpa-onnx-supertonic-3-tts-int8-2026-05-11'
URL = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/' + NAME + '.tar.bz2'
SHA256 = '82fa96f91c4ef8abaae3a14a3f4153facf88bed821d1f7331cec2700f432c427'
FAST_NAME = 'vits-mimic3-ko_KO-kss_low'
FAST_URL = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/' + FAST_NAME + '.tar.bz2'
FAST_SHA256 = 'f015d1d15a52ed00d6fe22757c5ef4a74283c53daf829c838fa5c22616ed789c'


def install(destination, name=NAME, url=URL, checksum=SHA256):
    destination = Path(destination)
    target = destination / name
    if (target / '.verified').is_file() and (target / '.verified').read_text() == checksum:
        return target
    destination.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=destination) as tmp:
        archive = Path(tmp) / 'model.tar.bz2'
        with urllib.request.urlopen(url, timeout=120) as source, archive.open('wb') as output:
            shutil.copyfileobj(source, output)
        with archive.open('rb') as source:
            if hashlib.file_digest(source, 'sha256').hexdigest() != checksum:
                raise ValueError('TTS model checksum mismatch')
        with tarfile.open(archive) as source:
            for entry in source.getmembers():
                if not (entry.name == name or entry.name.startswith(name + '/')) or not (entry.isfile() or entry.isdir()):
                    raise ValueError('Unexpected TTS model archive member: ' + entry.name)
            source.extractall(tmp, filter='data')
        if target.exists():
            raise ValueError('Incomplete model directory; move it aside and retry: ' + str(target))
        (Path(tmp) / name).rename(target)
        (target / '.verified').write_text(checksum)
    return target


class Engine:
    def __init__(self):
        import sherpa_onnx
        self.api = sherpa_onnx
        root = install(os.environ.get('TTS_MODEL_DIR', '/data/models'))
        config = sherpa_onnx.OfflineTtsSupertonicModelConfig(**{
            name: str(root / filename) for name, filename in {
                'duration_predictor': 'duration_predictor.int8.onnx',
                'text_encoder': 'text_encoder.int8.onnx',
                'vector_estimator': 'vector_estimator.int8.onnx',
                'vocoder': 'vocoder.int8.onnx', 'tts_json': 'tts.json',
                'unicode_indexer': 'unicode_indexer.bin', 'voice_style': 'voice.bin',
            }.items()
        })
        self.tts = sherpa_onnx.OfflineTts(sherpa_onnx.OfflineTtsConfig(
            model=sherpa_onnx.OfflineTtsModelConfig(supertonic=config,
                num_threads=int(os.environ.get('TTS_THREADS', '2')), provider='cpu')))
        fast = install(os.environ.get('TTS_MODEL_DIR', '/data/models'), FAST_NAME, FAST_URL, FAST_SHA256)
        self.fast = sherpa_onnx.OfflineTts(sherpa_onnx.OfflineTtsConfig(
            model=sherpa_onnx.OfflineTtsModelConfig(
                vits=sherpa_onnx.OfflineTtsVitsModelConfig(model=str(fast / 'ko_KO-kss_low.onnx'),
                    tokens=str(fast / 'tokens.txt'), data_dir=str(fast / 'espeak-ng-data')),
                num_threads=int(os.environ.get('TTS_THREADS', '2')), provider='cpu')))

    def generate(self, text, voice, language):
        if voice == 10:
            if language != 'ko':
                raise ValueError('Fast Korean voice only supports Korean')
            return self.fast.generate(text)
        config = self.api.GenerationConfig()
        config.sid, config.num_steps, config.speed = voice, int(os.environ.get('TTS_STEPS', '2')), 1.0
        config.extra['lang'] = language
        return self.tts.generate(text, config)
