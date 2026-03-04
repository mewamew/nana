import httpx
from providers.tts.base import BaseTTSProvider


class Qwen3TTSProvider(BaseTTSProvider):
    def __init__(self, config: dict):
        self.base_url = config.get("base_url", "http://localhost:8887").rstrip("/")
        self.voice = config.get("voice", "vivian")

    def is_configured(self) -> bool:
        return True  # 本地服务不需要 api_key

    async def synthesize(self, text: str) -> bytes:
        url = f"{self.base_url}/v1/audio/speech"
        payload = {
            "input": text,
            "voice": self.voice,
            "response_format": "mp3",
            "task_type": "CustomVoice",
        }
        try:
            async with httpx.AsyncClient(timeout=60) as client:
                resp = await client.post(url, json=payload)
                resp.raise_for_status()
                return resp.content
        except Exception as e:
            print(f"[Qwen3TTS] 本地服务连接失败，请确认服务已启动: {e}")
            return b""
