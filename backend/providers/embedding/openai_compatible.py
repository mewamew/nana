import httpx
from providers.embedding.base import BaseEmbeddingProvider


class OpenAICompatibleEmbedding(BaseEmbeddingProvider):
    """OpenAI 兼容的 Embedding 接口（支持 OpenAI / DeepSeek / Ollama 等）"""

    def __init__(self, config: dict):
        self.api_key = config.get("api_key", "")
        self.model = config.get("model", "text-embedding-ada-002")
        self.base_url = config.get("base_url", "https://api.openai.com/v1").rstrip("/")

    def is_configured(self) -> bool:
        return bool(self.base_url and self.model)

    async def embed(self, texts: list[str]) -> list[list[float]]:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        payload = {"input": texts, "model": self.model}

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{self.base_url}/embeddings",
                headers=headers,
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()

        # 按 index 排序，确保顺序与输入一致
        items = sorted(data["data"], key=lambda x: x["index"])
        return [item["embedding"] for item in items]
