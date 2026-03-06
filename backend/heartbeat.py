"""主动消息心跳系统 — 60s tick + LLM 自主决策 + 注意力管理"""

import asyncio
import base64
import json
import os
import random
import re
from datetime import datetime

from conversation import ConversationHistory
from emotional_state import EmotionalState
from persona import is_initialized, load_persona
from providers import get_llm, get_tts


class HeartbeatSystem:
    ACTIVE_START = 8       # 活跃时间起始（8:00）
    ACTIVE_END = 23        # 活跃时间结束（23:00）
    TICK_INTERVAL = 60     # tick 间隔（60 秒）
    MIN_GAP = 300          # 两条主动消息最小间隔（5 分钟）
    PENDING_TTL = 300      # pending 消息超时时间（5 分钟）

    # 注意力系统常量
    DECAY_FACTOR = 0.997           # 每 tick 乘法衰减
    ACCUMULATION_RATE = 0.003      # 沉默超阈值后每 tick 累加
    SILENCE_THRESHOLD = 1800       # 30 分钟沉默后开始累加
    INTERACTION_BOOST = 0.4        # 用户互动时 response_rate 设为此值
    LLM_CALL_THRESHOLD = 0.15     # rate 低于此值不调 LLM

    def __init__(self, emotional_state: EmotionalState,
                 conversation_history: ConversationHistory):
        self.emotional_state = emotional_state
        self.conversation_history = conversation_history
        self.last_proactive: datetime | None = None
        self._pending_message: dict | None = None

        # 注意力系统
        self.response_rate: float = 0.0
        self.last_interaction_time: datetime | None = None

        # 注册互动回调
        self.emotional_state.on_interaction(self.notify_interaction)

        # 加载 prompt 模板
        prompt_path = os.path.join(os.path.dirname(__file__), "prompts", "heartbeat.md")
        with open(prompt_path, "r", encoding="utf-8") as f:
            self.prompt_template = f.read()

        # 保留原始模板（persona 在每次 LLM 调用时动态注入）
        self.raw_prompt_template = self.prompt_template
        del self.prompt_template

        # 从持久化状态恢复心跳参数
        hb_state = self.emotional_state.get_heartbeat_state()
        self.response_rate = hb_state.get("response_rate", 0.0)
        last_p = hb_state.get("last_proactive", "")
        if last_p:
            try:
                self.last_proactive = datetime.fromisoformat(last_p)
            except (ValueError, TypeError):
                pass

    async def start(self) -> None:
        """作为 asyncio 后台任务启动"""
        print("[Heartbeat] 心跳系统启动")
        while True:
            try:
                await asyncio.sleep(self.TICK_INTERVAL)
                await self._tick()
            except asyncio.CancelledError:
                print("[Heartbeat] 心跳系统停止")
                break
            except Exception as e:
                print(f"[Heartbeat] tick 出错: {e}")

    def pop_pending_message(self) -> dict | None:
        """取出待发送消息（前端轮询调用），取后清空"""
        msg = self._pending_message
        self._pending_message = None
        if msg:
            msg.pop("created_at", None)
        return msg

    def notify_interaction(self) -> None:
        """用户互动回调：提升 response_rate"""
        self.last_interaction_time = datetime.now()
        self.response_rate = self.INTERACTION_BOOST
        print(f"[Heartbeat] 互动回调, response_rate → {self.response_rate:.3f}")

    def _update_response_rate(self) -> None:
        """每 tick 更新 response_rate：衰减 + 沉默累加"""
        # 乘法衰减
        self.response_rate *= self.DECAY_FACTOR

        # 沉默超阈值后累加
        if self.last_interaction_time:
            silence = (datetime.now() - self.last_interaction_time).total_seconds()
            if silence > self.SILENCE_THRESHOLD:
                self.response_rate = min(1.0, self.response_rate + self.ACCUMULATION_RATE)

    async def _tick(self) -> None:
        """60 秒 tick 循环：5 道门控 → LLM 决策"""
        # 门控 0: 必须已完成初始化
        if not is_initialized():
            return

        now = datetime.now()

        # 更新注意力
        self._update_response_rate()

        # 门控 1: 活跃时间 8:00-23:00
        if now.hour < self.ACTIVE_START or now.hour >= self.ACTIVE_END:
            return

        # 门控 2: 无待消费的 pending_message（超时则丢弃）
        if self._pending_message is not None:
            try:
                created = datetime.fromisoformat(self._pending_message["created_at"])
                if (now - created).total_seconds() < self.PENDING_TTL:
                    return
                print("[Heartbeat] pending 消息超时，丢弃")
                self._pending_message = None
            except (KeyError, ValueError):
                self._pending_message = None

        # 门控 3: MIN_GAP 间隔
        if self.last_proactive:
            elapsed = (now - self.last_proactive).total_seconds()
            if elapsed < self.MIN_GAP:
                return

        # 门控 4: 至少有过一次互动
        if self.last_interaction_time is None:
            # 尝试从持久化状态恢复
            last_interaction = self.emotional_state.state["relationship"].get("last_interaction")
            if not last_interaction:
                return
            try:
                self.last_interaction_time = datetime.fromisoformat(last_interaction)
            except Exception:
                return

        # 门控 5: response_rate 概率门控
        if self.response_rate < self.LLM_CALL_THRESHOLD:
            return
        if random.random() >= self.response_rate:
            return

        print(f"[Heartbeat] 通过门控, response_rate={self.response_rate:.3f}, 调用 LLM 决策...")

        # 调 LLM 决策+生成
        result = await self._llm_decide_and_generate()
        if result:
            await self.conversation_history.add_message("assistant", result["message"])
            self._pending_message = {**result, "created_at": now.isoformat()}
            self.last_proactive = now
            self.response_rate *= 0.3  # 发送后大幅衰减
            print(f"[Heartbeat] LLM 决定发消息: {result['message'][:20]}..., rate → {self.response_rate:.3f}")
        else:
            self.response_rate *= 0.7  # wait 后适度衰减
            print(f"[Heartbeat] LLM 决定等待, rate → {self.response_rate:.3f}")

        # 持久化心跳状态
        self.emotional_state.save_heartbeat_state(
            self.response_rate,
            self.last_proactive.isoformat() if self.last_proactive else "",
        )

    async def _llm_decide_and_generate(self) -> dict | None:
        """单次 LLM 调用：同时决策是否发消息 + 生成消息内容"""
        try:
            mood_state = self.emotional_state.get_mood_description()
            time_context = self.emotional_state.get_time_context()
            relationship_context = self.emotional_state.get_relationship_description()
            user_info = self.conversation_history.format_profile()
            recent_context = self.conversation_history.get_recent_context(n=10)

            # 计算距上次互动时间
            hours_since = 0.0
            if self.last_interaction_time:
                hours_since = (datetime.now() - self.last_interaction_time).total_seconds() / 3600

            # 动态注入 persona
            persona = load_persona()
            char_name = persona["char_name"] if persona else "娜娜"
            user_name = persona["user_name"] if persona else "主人"
            template = self.raw_prompt_template.replace("{char_name}", char_name).replace("{user_name}", user_name)

            prompt = template
            prompt = prompt.replace("{mood_state}", mood_state)
            prompt = prompt.replace("{time_context}", time_context)
            prompt = prompt.replace("{relationship_context}", relationship_context)
            prompt = prompt.replace("{user_info}", user_info or "暂无")
            prompt = prompt.replace("{recent_context}", recent_context or "暂无最近对话")
            prompt = prompt.replace("{hours_since_interaction}", f"{hours_since:.1f}")
            prompt = prompt.replace("{response_rate}", f"{self.response_rate:.3f}")

            llm = get_llm()
            raw = await llm.chat(
                [{"role": "user", "content": prompt}],
                temperature=0.8,
            )
            result = self._parse_decision_response(raw)

            # TTS 合成语音
            if result:
                try:
                    tts = get_tts()
                    if tts.is_configured():
                        audio_bytes = await tts.synthesize(result["message"])
                        if audio_bytes:
                            result["audio"] = base64.b64encode(audio_bytes).decode("ascii")
                except Exception as e:
                    print(f"[Heartbeat] TTS 生成失败: {e}")

            return result
        except Exception as e:
            print(f"[Heartbeat] LLM 调用失败: {e}")
            return None

    @staticmethod
    def _parse_decision_response(raw: str) -> dict | None:
        """解析含 action 字段的 JSON，返回消息 dict 或 None（wait）"""
        text = raw.strip()
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            match = re.search(r'```(?:json\n|\n)?([^`]*?)```', text, re.DOTALL)
            if match:
                try:
                    data = json.loads(match.group(1).strip())
                except json.JSONDecodeError:
                    print(f"[Heartbeat] JSON 解析失败: {text[:200]}")
                    return None
            else:
                # Attempt 3: balanced brace matching
                brace_start = text.find('{')
                if brace_start != -1:
                    depth, end = 0, -1
                    for i, ch in enumerate(text[brace_start:], brace_start):
                        if ch == '{': depth += 1
                        elif ch == '}':
                            depth -= 1
                            if depth == 0:
                                end = i + 1
                                break
                    if end != -1:
                        try:
                            data = json.loads(text[brace_start:end])
                        except json.JSONDecodeError:
                            print(f"[Heartbeat] JSON 解析失败: {text[:200]}")
                            return None
                    else:
                        print(f"[Heartbeat] 无法解析 LLM 返回: {text[:200]}")
                        return None
                else:
                    print(f"[Heartbeat] 无法解析 LLM 返回: {text[:200]}")
                    return None

        action = data.get("action", "wait")

        if action == "send_message":
            message = data.get("message", "").strip()
            expression = data.get("expression", "嘟嘴").strip()
            if not message:
                return None
            return {"message": message, "expression": expression}

        # action == "wait" 或其他
        return None
