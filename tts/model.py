"""High-quality neural Edge-TTS narration engine with exact CBR MP3 output."""
import asyncio
import logging

LOG = logging.getLogger('tts.model')
NAME = 'edge-tts-neural-v1'

VOICES = {
    'ko': [
        'ko-KR-SunHiNeural',    # 0 / 10: 선희 (여성 · 기본)
        'ko-KR-InJoonNeural',   # 1: 인준 (남성)
        'ko-KR-HyunsuNeural',   # 2: 현수 (남성)
    ],
    'en': [
        'en-US-JennyNeural',    # 0: Jenny (Female)
        'en-US-GuyNeural',      # 1: Guy (Male)
        'en-US-AriaNeural',     # 2: Aria (Female)
    ],
    'ja': [
        'ja-JP-NanamiNeural',   # 0: Nanami (Female)
        'ja-JP-KeitaNeural',    # 1: Keita (Male)
    ]
}


def resolve_voice(voice, language):
    voice_list = VOICES.get(language, VOICES.get('ko'))
    if language == 'ko' and voice == 10:
        return voice_list[0]
    if isinstance(voice, int) and 0 <= voice < len(voice_list):
        return voice_list[voice]
    return voice_list[0]


class Engine:
    def __init__(self):
        LOG.info('Initialized Edge-TTS neural speech engine')

    async def _synth(self, text, voice_name):
        import edge_tts
        communicate = edge_tts.Communicate(text, voice_name)
        raw = b''
        async for chunk in communicate.stream():
            if chunk['type'] == 'audio':
                raw += chunk['data']
        if not raw:
            raise ValueError('Edge-TTS generated empty audio stream')
        return raw

    def generate(self, text, voice, language):
        voice_name = resolve_voice(voice, language)
        try:
            return asyncio.run(self._synth(text, voice_name))
        except Exception as error:
            LOG.warning('Edge-TTS generation error: %s; retrying once', error)
            return asyncio.run(self._synth(text, voice_name))
