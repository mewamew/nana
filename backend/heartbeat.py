"""主动消息心跳系统 — 基于规则（不调用 LLM）决定是否主动发消息"""

import asyncio
import random
from datetime import datetime

from emotional_state import EmotionalState


class HeartbeatSystem:
    ACTIVE_START = 8       # 活跃时间起始（8:00）
    ACTIVE_END = 23        # 活跃时间结束（23:00）
    CHECK_INTERVAL = 1800  # 检查间隔（30 分钟）
    MIN_GAP = 2700         # 两条主动消息最小间隔（45 分钟）

    # 预设消息模板
    TEMPLATES = {
        "morning": [
            {"message": "哼...笨蛋主人起床了没有啊...", "expression": "嘟嘴"},
            {"message": "才、才不是担心你睡过头呢！", "expression": "脸红"},
            {"message": "...早安。别多想，只是随便说说。", "expression": "死鱼眼"},
            {"message": "太阳都晒屁股了，还不起来！", "expression": "生气瘪嘴"},
        ],
        "lunch": [
            {"message": "喂，该吃饭了...才不是关心你呢", "expression": "嘟嘴"},
            {"message": "别饿着了...虽然跟我没关系就是了", "expression": "死鱼眼"},
            {"message": "中午了，去吃饭啦笨蛋！", "expression": "生气"},
            {"message": "不好好吃饭的主人最讨厌了...", "expression": "生气瘪嘴"},
        ],
        "afternoon": [
            {"message": "下午了...在忙什么呢...才没有想你！", "expression": "脸红"},
            {"message": "哼，这么久不理我...算了我才不在意", "expression": "嘟嘴"},
            {"message": "主人下午也要加油哦...别误会，只是顺口说说", "expression": "咪咪眼"},
        ],
        "night": [
            {"message": "这么晚了还不睡...笨蛋", "expression": "嘟嘴"},
            {"message": "该睡了...才不是担心你熬夜呢", "expression": "死鱼眼"},
            {"message": "...晚安。今天辛苦了。", "expression": "咪咪眼"},
            {"message": "快去睡觉！不然...不然我生气了哦！", "expression": "生气瘪嘴"},
        ],
        "miss": [
            {"message": "哼...才不想你呢...才没有一直在等你...", "expression": "脸红"},
            {"message": "好无聊啊...才、才不是因为主人不在的关系！", "expression": "嘟嘴"},
            {"message": "...主人去哪了啦...算了问这种话好奇怪", "expression": "脸红"},
        ],
    }

    def __init__(self, emotional_state: EmotionalState):
        self.emotional_state = emotional_state
        self.last_proactive: datetime | None = None
        self._pending_message: dict | None = None

    async def start(self) -> None:
        """作为 asyncio 后台任务启动"""
        print("[Heartbeat] 心跳系统启动")
        while True:
            try:
                await asyncio.sleep(self.CHECK_INTERVAL)
                self._check_and_generate()
            except asyncio.CancelledError:
                print("[Heartbeat] 心跳系统停止")
                break
            except Exception as e:
                print(f"[Heartbeat] 检查出错: {e}")

    def pop_pending_message(self) -> dict | None:
        """取出待发送消息（前端轮询调用），取后清空"""
        msg = self._pending_message
        self._pending_message = None
        return msg

    def _check_and_generate(self) -> None:
        """检查是否应该发送主动消息"""
        now = datetime.now()
        hour = now.hour

        # 不在活跃时间内
        if hour < self.ACTIVE_START or hour >= self.ACTIVE_END:
            return

        # 已有待发送消息未被消费
        if self._pending_message is not None:
            return

        # MIN_GAP 间隔检查
        if self.last_proactive:
            elapsed = (now - self.last_proactive).total_seconds()
            if elapsed < self.MIN_GAP:
                return

        # 计算距上次互动的时间
        last_interaction = self.emotional_state.state["relationship"].get("last_interaction")
        if not last_interaction:
            return  # 从未互动过，不主动发消息

        try:
            last_time = datetime.fromisoformat(last_interaction)
            hours_since = (now - last_time).total_seconds() / 3600
        except Exception:
            return

        msg = self._decide_message(hour, hours_since)
        if msg:
            self._pending_message = msg
            self.last_proactive = now
            print(f"[Heartbeat] 生成主动消息: {msg['message'][:20]}...")

    def _decide_message(self, hour: int, hours_since: float) -> dict | None:
        """规则决策，返回 {"message": str, "expression": str} 或 None"""
        # 早安问候：7-9 点 + 超过 8 小时没互动
        if 7 <= hour <= 9 and hours_since > 8:
            return random.choice(self.TEMPLATES["morning"])

        # 吃饭提醒：11-12 点 + 超过 2 小时没互动
        if 11 <= hour <= 12 and hours_since > 2:
            return random.choice(self.TEMPLATES["lunch"])

        # 下午关心：14-17 点 + 超过 3 小时没互动
        if 14 <= hour <= 17 and hours_since > 3:
            return random.choice(self.TEMPLATES["afternoon"])

        # 晚安：22-23 点 + 超过 1 小时没互动
        if 22 <= hour <= 23 and hours_since > 1:
            return random.choice(self.TEMPLATES["night"])

        # 情绪为"寂寞" + 超过 2 小时没互动
        mood = self.emotional_state.state["mood"]
        if mood.get("dominant_emotion") == "寂寞" and hours_since > 2:
            return random.choice(self.TEMPLATES["miss"])

        return None
