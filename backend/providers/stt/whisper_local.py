import asyncio
import tempfile
import os
from providers.stt.base import BaseSTTProvider


class WhisperLocalProvider(BaseSTTProvider):
    def __init__(self, config: dict):
        self.model_name = config.get("model", "medium")
        self.device = config.get("device", "cpu")
        self.language = config.get("language", "zh")
        self._model = None  # 懒加载

    def _get_model(self):
        if self._model is None:
            import whisper
            print(f"[Whisper] 正在加载模型 {self.model_name}，首次加载需要一些时间...")
            self._model = whisper.load_model(self.model_name, device=self.device)
            print("[Whisper] 模型加载完成")
        return self._model

    async def transcribe(self, audio_data: bytes, format: str = "wav") -> str:
        def _run():
            tmp_path = None
            try:
                with tempfile.NamedTemporaryFile(
                    suffix=f".{format}", delete=False
                ) as tmp:
                    tmp.write(audio_data)
                    tmp_path = tmp.name
                model = self._get_model()
                result = model.transcribe(tmp_path, language=self.language)
                return result["text"].strip()
            finally:
                if tmp_path and os.path.exists(tmp_path):
                    os.unlink(tmp_path)

        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, _run)
