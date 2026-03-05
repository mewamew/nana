import json
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Any, AsyncGenerator, Tuple

from conversation import ConversationHistory
from emotional_state import EmotionalState
from providers import get_llm
from skill_manager import SkillManager
from tools import ToolExecutor, render_tool_definitions
from utils import parse_llm_json

MAX_TOOL_CALLS = 3

_WEEKDAYS = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"]


class MainAgent:
    def __init__(self, llm_service: Any, conversation_history: ConversationHistory,
                 emotional_state: EmotionalState) -> None:
        self.conversation_history = conversation_history
        self.llm_service = llm_service
        self.emotional_state = emotional_state
        soul_path = os.path.join(os.path.dirname(__file__), "prompts", "soul.md")
        reply_path = os.path.join(os.path.dirname(__file__), "prompts", "reply.md")
        with open(soul_path, "r", encoding="utf-8") as f:
            soul = f.read()
        with open(reply_path, "r", encoding="utf-8") as f:
            reply = f.read()
        self.prompt_template = soul + "\n\n" + reply

        decision_path = os.path.join(os.path.dirname(__file__), "prompts", "tool_decision.md")
        with open(decision_path, "r", encoding="utf-8") as f:
            self.decision_template = f.read()

        # 初始化 SkillManager
        skills_dir = Path(__file__).parent / "skills"
        self.skill_manager = SkillManager(str(skills_dir)) if skills_dir.exists() else None

        # 确保日志目录存在
        self.log_dir = os.path.join(os.path.dirname(__file__), '..', 'save', 'log')
        os.makedirs(self.log_dir, exist_ok=True)

    def _log_conversation(self, role: str, content: str) -> None:
        """记录对话到日志文件"""
        current_date = datetime.now().strftime('%Y%m%d')
        current_time = datetime.now().strftime('%H:%M:%S')
        log_file = os.path.join(self.log_dir, f'{current_date}.txt')

        with open(log_file, 'a', encoding='utf-8') as f:
            f.write(f'[{current_time}] {role.capitalize()}: {content}\n')

    # ── 工具循环（阶段1：非流式）─────────────────────────────────

    async def _run_tool_loop(self, message: str) -> str:
        """非流式工具决策循环，最多 MAX_TOOL_CALLS 次，返回工具结果汇总文本。"""
        executor = ToolExecutor(self.conversation_history)
        context = self.conversation_history.get_context()
        collected: list[str] = []
        called_tools: set[str] = set()  # 防止同一工具重复调用

        for _ in range(MAX_TOOL_CALLS):
            previous = "\n".join(collected) if collected else "无"
            messages = self._build_decision_messages(message, context, previous)
            llm = get_llm()
            try:
                raw = await llm.chat(messages, temperature=0.3)
                decision = self._parse_decision(raw)
            except Exception as e:
                print(f"[Agent] 工具决策失败，降级: {e}")
                break

            if decision.get("action") != "call_tool":
                break

            tool_name = decision.get("tool", "")
            if tool_name in called_tools:
                break  # 同一工具不重复调用
            called_tools.add(tool_name)

            args = decision.get("args", {})
            print(f"[Agent] 调用工具: {tool_name} args={args}")
            result = await executor.execute(tool_name, args)
            collected.append(f"{tool_name}: {result}")

        return "\n".join(collected) if collected else "无"

    def _build_decision_messages(self, user_message: str, context: str, previous_tool_results: str) -> list[dict]:
        prompt = self.decision_template.format(
            tool_definitions=render_tool_definitions(),
            chat_history=context or "无",
            user_message=user_message,
            previous_tool_results=previous_tool_results,
        )
        return [{"role": "user", "content": prompt}]

    def _parse_decision(self, raw: str) -> dict:
        """从 LLM 输出中解析 JSON 决策，失败时返回 reply_directly。"""
        text = raw.strip()
        # 优先提取 markdown 代码块中的 JSON
        match = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', text, re.DOTALL)
        if match:
            text = match.group(1).strip()
        else:
            # 用平衡括号法提取第一个完整 JSON 对象（兼容 JSON 后有说明文字）
            brace_start = text.find('{')
            if brace_start == -1:
                return {"action": "reply_directly"}
            depth, end = 0, -1
            for i, ch in enumerate(text[brace_start:], brace_start):
                if ch == '{':
                    depth += 1
                elif ch == '}':
                    depth -= 1
                    if depth == 0:
                        end = i + 1
                        break
            if end == -1:
                return {"action": "reply_directly"}
            text = text[brace_start:end]
        try:
            return json.loads(text)
        except Exception:
            return {"action": "reply_directly"}

    # ── 流式接口（spec 06）────────────────────────────────────────

    async def reply_stream(self, message: str) -> AsyncGenerator[str, None]:
        """流式生成原始 LLM 输出（JSON 格式的字符串片段）"""
        self._log_conversation("user", message)

        tool_results_text = await self._run_tool_loop(message)

        memory_text = self._get_relevant_memories(message)
        context = self.conversation_history.get_context()

        prompt = self.prompt_template.format(
            chat_history=context,
            user_message=message,
            memory=memory_text,
            tool_results=tool_results_text,
            current_datetime=self._get_current_datetime(),
            user_info=self.conversation_history.format_profile(),
            mood_state=self.emotional_state.get_mood_description(),
            time_context=self.emotional_state.get_time_context(),
            relationship_context=self.emotional_state.get_relationship_description(),
        )

        # 注入 skills_prompt（在 format() 之后，避免花括号冲突）
        if self.skill_manager:
            skills_content = self.skill_manager.build_skills_prompt()
            if skills_content:
                prompt += "\n\n## 可用技能\n" + skills_content

        messages = [{"role": "user", "content": prompt}]
        llm = get_llm()

        full_response = ""
        async for chunk in llm.chat_stream(messages):
            full_response += chunk
            yield chunk

        if full_response:
            await self._handle_full_response(message, full_response)

    def extract_expression(self, raw_response: str) -> str:
        """从 LLM 原始输出中提取表情字段"""
        try:
            data = self._parse_json(raw_response)
            return data.get("expression", "")
        except Exception:
            return ""

    def extract_reply_text(self, raw_response: str) -> str:
        """从 LLM 原始输出中提取纯文字回复（用于 TTS）"""
        try:
            data = self._parse_json(raw_response)
            return data.get("reply", raw_response)
        except Exception:
            return raw_response

    def _parse_json(self, raw: str) -> dict[str, Any]:
        return parse_llm_json(raw)

    async def _handle_full_response(self, message: str, raw_response: str) -> None:
        """流结束后：更新 user_info、情绪状态、记录对话历史"""
        try:
            data = self._parse_json(raw_response)
            reply_text = data.get("reply", "")

            if "user_info" in data and data["user_info"]:
                self.conversation_history.update_raw_notes(data["user_info"])

            # 处理情绪更新
            emotion_update = data.get("emotion_update")
            if emotion_update and isinstance(emotion_update, dict):
                self.emotional_state.update_from_llm(emotion_update)
            self.emotional_state.record_interaction()

            if reply_text:
                self._log_conversation("assistant", reply_text)
                await self.conversation_history.add_dialog(message, reply_text)
        except Exception as e:
            print(f"[Agent] 处理回复失败: {e}")

    # ── 非流式接口（保留兼容）────────────────────────────────────

    async def reply(self, message: str) -> Tuple[str, str]:
        """生成回复（非流式，向后兼容）"""
        self._log_conversation("user", message)
        tool_results_text = await self._run_tool_loop(message)
        memory_text = self._get_relevant_memories(message)
        reply_content, expression = await self._generate_reply(message, memory_text, tool_results_text)
        if reply_content:
            await self._handle_successful_reply(message, reply_content)
        return reply_content, expression

    async def _generate_reply(self, message: str, memory_text: str = "无补充信息", tool_results: str = "无") -> Tuple[str, str]:
        context = self.conversation_history.get_context()
        prompt = self.prompt_template.format(
            chat_history=context,
            user_message=message,
            memory=memory_text,
            tool_results=tool_results,
            current_datetime=self._get_current_datetime(),
            user_info=self.conversation_history.format_profile(),
            mood_state=self.emotional_state.get_mood_description(),
            time_context=self.emotional_state.get_time_context(),
            relationship_context=self.emotional_state.get_relationship_description(),
        )
        reply = await self.llm_service.generate_response(prompt, is_json=True)
        if not reply:
            return "对不起，我现在有点累了，能稍后再聊吗？", "生气"

        if "user_info" in reply:
            self.conversation_history.update_raw_notes(reply["user_info"])

        # 处理情绪更新
        emotion_update = reply.get("emotion_update")
        if emotion_update and isinstance(emotion_update, dict):
            self.emotional_state.update_from_llm(emotion_update)
        self.emotional_state.record_interaction()

        return reply.get("reply", ""), reply.get("expression", "")

    def _get_current_datetime(self) -> str:
        now = datetime.now()
        weekday = _WEEKDAYS[now.weekday()]
        return now.strftime(f"%Y年%m月%d日 {weekday} %H:%M")

    def _get_relevant_memories(self, message: str) -> str:
        current_emotion = self.emotional_state.state["mood"].get("dominant_emotion")
        memories = self.conversation_history.retrieve(
            message, n_results=2, current_emotion=current_emotion
        )
        return "\n".join(memories) if memories else "无补充信息"

    async def _handle_successful_reply(self, message: str, reply_content: str) -> None:
        self._log_conversation("assistant", reply_content)
        await self.conversation_history.add_dialog(message, reply_content)

