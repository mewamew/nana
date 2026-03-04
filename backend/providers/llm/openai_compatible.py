import asyncio
import httpx
import json
from typing import AsyncGenerator
from providers.llm.base import BaseLLMProvider

LOCAL_PROVIDERS = {"ollama", "lmstudio"}


class OpenAICompatibleProvider(BaseLLMProvider):
    def __init__(self, provider_name: str, config: dict):
        self.provider_name = provider_name
        self.api_key = config.get("api_key", "")
        self.model = config["model"]
        self.base_url = config["base_url"]

    def is_configured(self) -> bool:
        if self.provider_name in LOCAL_PROVIDERS:
            return True
        return bool(self.api_key)

    async def chat_stream(self, messages: list[dict], temperature: float = 0.7) -> AsyncGenerator[str, None]:
        url = self.base_url.rstrip("/") + "/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "stream": True,
        }
        for attempt in range(3):
            try:
                async with httpx.AsyncClient(
                    verify=False,
                    timeout=httpx.Timeout(connect=10, read=120, write=10, pool=10)
                ) as client:
                    async with client.stream("POST", url, json=payload, headers=headers) as resp:
                        resp.raise_for_status()
                        async for line in resp.aiter_lines():
                            if not line.startswith("data:"):
                                continue
                            data = line[len("data:"):].strip()
                            if data == "[DONE]":
                                return
                            try:
                                chunk = json.loads(data)
                                content = chunk["choices"][0]["delta"].get("content")
                                if content:
                                    yield content
                            except (json.JSONDecodeError, KeyError, IndexError):
                                continue
                return
            except Exception as e:
                print(f"[{self.provider_name}] stream error (attempt {attempt+1}/3): {e}")
                if attempt < 2:
                    await asyncio.sleep(1)
                else:
                    yield ""
