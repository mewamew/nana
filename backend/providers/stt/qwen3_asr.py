import httpx
from providers.stt.base import BaseSTTProvider


class Qwen3ASRProvider(BaseSTTProvider):
    def __init__(self, config: dict):
        self.base_url = config.get("base_url", "http://localhost:8888").rstrip("/")

    async def transcribe(self, audio_data: bytes, format: str = "wav") -> str:
        url = f"{self.base_url}/v1/audio/transcriptions"
        try:
            async with httpx.AsyncClient(timeout=60) as client:
                resp = await client.post(
                    url,
                    files={"file": (f"audio.{format}", audio_data, f"audio/{format}")},
                    data={"model": "Qwen/Qwen3-ASR-1.7B"},
                )
                resp.raise_for_status()
                return resp.json()["text"].strip()
        except Exception as e:
            print(f"[Qwen3ASR] 本地服务连接失败: {e}")
            return ""
