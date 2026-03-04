from abc import ABC, abstractmethod
from typing import AsyncGenerator


class BaseLLMProvider(ABC):
    @abstractmethod
    async def chat_stream(self, messages: list[dict], temperature: float = 0.7) -> AsyncGenerator[str, None]: ...

    async def chat(self, messages: list[dict], temperature: float = 0.7) -> str:
        result = []
        async for chunk in self.chat_stream(messages, temperature):
            result.append(chunk)
        return "".join(result)

    def is_configured(self) -> bool:
        return True
