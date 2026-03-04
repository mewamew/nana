from abc import ABC, abstractmethod


class BaseSTTProvider(ABC):
    @abstractmethod
    async def transcribe(self, audio_data: bytes, format: str = "wav") -> str: ...
