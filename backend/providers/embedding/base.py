from abc import ABC, abstractmethod


class BaseEmbeddingProvider(ABC):
    @abstractmethod
    async def embed(self, texts: list[str]) -> list[list[float]]:
        """将文本列表转为向量列表"""
        ...

    def is_configured(self) -> bool:
        return True
