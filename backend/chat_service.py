import asyncio
import base64
import json
import re
import uuid
from typing import Any, AsyncGenerator

from conversation import ConversationHistory
from database import Database
from emotional_state import EmotionalState
from main_agent import MainAgent
from providers import get_llm, get_tts, get_embedding
from utils import parse_llm_json


class LLMProviderAdapter:
    """将 BaseLLMProvider 适配为 MainAgent 期望的 generate_response 接口"""

    async def generate_response(
        self,
        prompt: str,
        temperature: float = 0.7,
        max_retries: int = 3,
        is_json: bool = False,
    ) -> str | dict[str, Any] | None:
        provider = get_llm()
        messages = [{"role": "user", "content": prompt}]
        raw = await provider.chat(messages, temperature)
        if not raw:
            return None
        if is_json:
            return self._parse_json(raw)
        return raw

    @staticmethod
    def _parse_json(raw: str) -> dict[str, Any]:
        return parse_llm_json(raw)


class ChatService:
    _EXPRESSION_PATTERN = re.compile(r'"expression"\s*:\s*"([^"]+)"')

    def __init__(self) -> None:
        self.llm_adapter = LLMProviderAdapter()
        self.db = Database()
        self.conversation_history = ConversationHistory(
            max_turns=20,
            llm_provider=get_llm(),
            embedding_provider=get_embedding(),
            db=self.db,
        )
        self.emotional_state = EmotionalState()
        self.main_agent = MainAgent(
            self.llm_adapter, self.conversation_history, self.emotional_state
        )
        self._locks: dict[str, asyncio.Lock] = {}
        self._active_generation: dict[str, str] = {}

    def _get_lock(self, session_id: str) -> asyncio.Lock:
        if session_id not in self._locks:
            self._locks[session_id] = asyncio.Lock()
        return self._locks[session_id]

    @staticmethod
    def _try_extract_quick_replies(text: str) -> list[str] | None:
        try:
            data = parse_llm_json(text)
            replies = data.get("quick_replies")
            if isinstance(replies, list) and all(isinstance(r, str) for r in replies):
                return replies
        except Exception:
            pass
        return None

    def _try_extract_expression(self, accumulated: str) -> str | None:
        match = self._EXPRESSION_PATTERN.search(accumulated)
        if match:
            return match.group(1).strip()
        return None

    async def generate_reply_stream(
        self, message: str, session_id: str = "default", *, tts_enabled: bool = True
    ) -> AsyncGenerator[dict[str, str], None]:
        """流式生成回复，按事件类型 yield 字典"""
        generation_id = str(uuid.uuid4())[:8]
        self._active_generation[session_id] = generation_id
        lock = self._get_lock(session_id)

        async with lock:
            # 被更新的请求抢占，放弃本次生成
            if self._active_generation[session_id] != generation_id:
                return

            yield {"type": "generation_id", "content": generation_id}

            was_init = self.main_agent.initialized

            print(f"[Chat] 用户: {message}")

            chunks: list[str] = []
            expression_sent = False

            async for chunk in self.main_agent.reply_stream(message):
                if self._active_generation[session_id] != generation_id:
                    return
                if not chunk:
                    continue
                chunks.append(chunk)
                yield {"type": "text", "content": chunk}

                if not expression_sent:
                    expression = self._try_extract_expression("".join(chunks))
                    if expression:
                        expression_sent = True
                        yield {"type": "expression", "content": expression}

            full_text = "".join(chunks)
            reply_text = self.main_agent.extract_reply_text(full_text)
            print(f"[Chat] AI: {reply_text}")

            if not expression_sent:
                expression = self.main_agent.extract_expression(full_text)
                if expression:
                    yield {"type": "expression", "content": expression}

            # 初始化完成事件：流开始时未初始化，流结束后已初始化
            if not was_init and self.main_agent.initialized:
                yield {"type": "init_complete", "content": json.dumps({
                    "char_name": self.main_agent.persona["char_name"],
                    "user_name": self.main_agent.persona["user_name"],
                }, ensure_ascii=False)}

            # 提取快捷回复选项
            quick_replies = self._try_extract_quick_replies(full_text)
            if quick_replies:
                yield {"type": "quick_replies", "content": json.dumps(quick_replies, ensure_ascii=False)}

            if tts_enabled:
                try:
                    tts = get_tts()
                    if tts.is_configured():
                        clean_text = reply_text
                        audio_bytes = await tts.synthesize(clean_text)
                        if audio_bytes:
                            audio_b64 = base64.b64encode(audio_bytes).decode("ascii")
                            yield {"type": "audio", "content": audio_b64}
                except NotImplementedError:
                    pass
