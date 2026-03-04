from abc import ABC, abstractmethod


class BaseTTSProvider(ABC):
    @abstractmethod
    async def synthesize(self, text: str) -> bytes: ...

    def is_configured(self) -> bool:
        return True
