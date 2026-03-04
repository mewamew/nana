import httpx
from providers.tts.base import BaseTTSProvider


class FishAudioProvider(BaseTTSProvider):
    API_URL = "https://api.fish.audio/v1/tts"

    def __init__(self, config: dict):
        self.api_key = config.get("api_key", "")
        self.reference_id = config.get("reference_id", "")

    def is_configured(self) -> bool:
        return bool(self.api_key and self.api_key.strip())

    async def synthesize(self, text: str) -> bytes:
        if not self.is_configured():
            return b""
        payload = {
            "text": text,
            "reference_id": self.reference_id,
            "format": "mp3",
            "streaming": False,
        }
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        for attempt in range(3):
            try:
                async with httpx.AsyncClient(timeout=60) as client:
                    resp = await client.post(self.API_URL, json=payload, headers=headers)
                    resp.raise_for_status()
                    return resp.content
            except Exception as e:
                print(f"[FishAudio] TTS 错误 (attempt {attempt+1}/3): {e}")
                if attempt == 2:
                    return b""
