"""情绪状态持久化 + 关系阶段管理"""

import json
import os
from datetime import datetime


class EmotionalState:
    STATE_PATH = os.path.join(os.path.dirname(__file__), "..", "save", "nana_state.json")

    # 情绪 → valence/arousal 映射
    EMOTION_MAP = {
        "开心":  {"valence":  0.7, "arousal": 0.6},
        "害羞":  {"valence":  0.3, "arousal": 0.5},
        "傲娇":  {"valence":  0.1, "arousal": 0.4},
        "生气":  {"valence": -0.6, "arousal": 0.8},
        "担心":  {"valence": -0.3, "arousal": 0.5},
        "无聊":  {"valence": -0.1, "arousal": 0.1},
        "寂寞":  {"valence": -0.4, "arousal": 0.2},
        "感动":  {"valence":  0.6, "arousal": 0.5},
        "吃醋":  {"valence": -0.3, "arousal": 0.6},
        "得意":  {"valence":  0.5, "arousal": 0.5},
    }

    RELATIONSHIP_STAGES = {
        "stranger":     {"affection": 0,   "trust": 0,    "interactions": 0,
                         "hint": "保持距离，极度傲娇，几乎不说真心话，短回复为主"},
        "acquaintance": {"affection": 0.2, "trust": 0.15, "interactions": 50,
                         "hint": "开始习惯主人的存在，偶尔主动找话题，偶尔流露关心但马上否认"},
        "friend":       {"affection": 0.4, "trust": 0.3,  "interactions": 200,
                         "hint": "傲娇但明显在意，会记住主人说过的事，话变多了"},
        "close_friend": {"affection": 0.6, "trust": 0.5,  "interactions": 500,
                         "hint": "偶尔说真心话不再否认，语气更温柔，偶尔撒娇"},
        "special":      {"affection": 0.8, "trust": 0.7,  "interactions": 1000,
                         "hint": "温柔为主偶尔傲娇，会撒娇，会担心失去主人"},
    }

    # 阶段升级顺序
    STAGE_ORDER = ["stranger", "acquaintance", "friend", "close_friend", "special"]

    # 时间分段
    TIME_PERIODS = [
        (0,  5,  "凌晨", "这么晚了主人还不睡觉..."),
        (5,  8,  "清晨", "早起的笨蛋主人..."),
        (8,  11, "上午", ""),
        (11, 13, "中午", "该吃饭了吧..."),
        (13, 17, "下午", ""),
        (17, 19, "傍晚", ""),
        (19, 22, "晚上", ""),
        (22, 24, "深夜", "这么晚了..."),
    ]

    DEFAULT_STATE = {
        "mood": {
            "valence": 0.0,
            "arousal": 0.3,
            "dominant_emotion": "傲娇",
            "intensity": 0.5,
            "last_updated": "",
        },
        "relationship": {
            "affection": 0.0,
            "trust": 0.0,
            "familiarity": 0.0,
            "stage": "stranger",
            "interaction_count": 0,
            "first_met": "",
            "last_interaction": "",
        },
        "daily": {
            "date": "",
            "interactions_today": 0,
        },
    }

    def __init__(self):
        self.state = self._load()
        self._check_daily_reset()
        self.decay_mood()
        print(f"[Emotion] 加载状态: {self.state['mood']['dominant_emotion']} "
              f"(intensity={self.state['mood']['intensity']:.2f}), "
              f"关系={self.state['relationship']['stage']}")

    def _load(self) -> dict:
        """从文件加载状态，失败时返回默认值"""
        try:
            if os.path.exists(self.STATE_PATH):
                with open(self.STATE_PATH, "r", encoding="utf-8") as f:
                    data = json.load(f)
                # 确保结构完整
                for key in self.DEFAULT_STATE:
                    if key not in data:
                        data[key] = json.loads(json.dumps(self.DEFAULT_STATE[key]))
                    else:
                        for sub_key in self.DEFAULT_STATE[key]:
                            if sub_key not in data[key]:
                                data[key][sub_key] = self.DEFAULT_STATE[key][sub_key]
                return data
        except Exception as e:
            print(f"[Emotion] 加载状态失败，使用默认值: {e}")
        default = json.loads(json.dumps(self.DEFAULT_STATE))
        now = datetime.now()
        default["mood"]["last_updated"] = now.isoformat()
        default["relationship"]["first_met"] = now.strftime("%Y-%m-%d")
        default["relationship"]["last_interaction"] = now.isoformat()
        default["daily"]["date"] = now.strftime("%Y-%m-%d")
        return default

    def _save(self) -> None:
        """保存状态到文件，失败时静默"""
        try:
            os.makedirs(os.path.dirname(self.STATE_PATH), exist_ok=True)
            with open(self.STATE_PATH, "w", encoding="utf-8") as f:
                json.dump(self.state, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"[Emotion] 保存状态失败: {e}")

    def _check_daily_reset(self) -> None:
        """跨天时情绪向中性衰减 50%"""
        today = datetime.now().strftime("%Y-%m-%d")
        if self.state["daily"]["date"] != today:
            mood = self.state["mood"]
            mood["valence"] *= 0.5
            mood["arousal"] = 0.3 + (mood["arousal"] - 0.3) * 0.5
            mood["intensity"] = 0.5 + (mood["intensity"] - 0.5) * 0.5
            self.state["daily"]["date"] = today
            self.state["daily"]["interactions_today"] = 0
            self._save()
            print("[Emotion] 跨天重置，情绪向中性衰减")

    def update_from_llm(self, emotion_update: dict) -> None:
        """根据 LLM 输出的 emotion_update 更新情绪"""
        try:
            emotion = emotion_update.get("emotion", "")
            direction = emotion_update.get("direction", "up")
            delta = float(emotion_update.get("delta", 0.1))
            delta = max(0.05, min(0.2, delta))  # 限制范围

            if emotion not in self.EMOTION_MAP:
                return

            mood = self.state["mood"]
            target = self.EMOTION_MAP[emotion]

            if direction == "up":
                mood["valence"] += (target["valence"] - mood["valence"]) * delta
                mood["arousal"] += (target["arousal"] - mood["arousal"]) * delta
                mood["intensity"] = min(1.0, mood["intensity"] + delta * 0.5)
                mood["dominant_emotion"] = emotion
            else:
                # down: 情绪远离该情绪，向中性靠拢
                mood["valence"] *= (1 - delta * 0.5)
                mood["arousal"] = 0.3 + (mood["arousal"] - 0.3) * (1 - delta * 0.5)
                mood["intensity"] = max(0.1, mood["intensity"] - delta * 0.5)
                # 如果当前主导情绪被 down 了，切换为傲娇（默认态）
                if mood["dominant_emotion"] == emotion:
                    mood["dominant_emotion"] = "傲娇"

            # 限制范围
            mood["valence"] = max(-1.0, min(1.0, mood["valence"]))
            mood["arousal"] = max(0.0, min(1.0, mood["arousal"]))
            mood["last_updated"] = datetime.now().isoformat()
            self._save()
        except Exception as e:
            print(f"[Emotion] 更新情绪失败: {e}")

    def decay_mood(self) -> None:
        """启动时调用，基于离线时长做情绪衰减"""
        try:
            last = self.state["mood"].get("last_updated")
            if not last:
                return
            last_time = datetime.fromisoformat(last)
            hours_elapsed = (datetime.now() - last_time).total_seconds() / 3600
            if hours_elapsed < 1:
                return
            # 每小时衰减 10%，向中性靠拢
            factor = 0.9 ** min(hours_elapsed, 24)
            mood = self.state["mood"]
            mood["valence"] *= factor
            mood["arousal"] = 0.3 + (mood["arousal"] - 0.3) * factor
            mood["intensity"] = 0.5 + (mood["intensity"] - 0.5) * factor
            mood["last_updated"] = datetime.now().isoformat()
            self._save()
        except Exception as e:
            print(f"[Emotion] 情绪衰减失败: {e}")

    def get_mood_description(self) -> str:
        """返回可读情绪描述"""
        mood = self.state["mood"]
        emotion = mood["dominant_emotion"]
        intensity = mood["intensity"]
        valence = mood["valence"]

        # 强度描述
        if intensity > 0.7:
            level = "非常"
        elif intensity > 0.4:
            level = "有点"
        else:
            level = "微微"

        # 心情方向
        if valence > 0.3:
            feeling = "心情不错"
        elif valence < -0.3:
            feeling = "心情不太好"
        else:
            feeling = "心情平平"

        return f"现在{level}{emotion}，{feeling}（情绪强度: {intensity:.1f}）"

    def get_time_context(self) -> str:
        """返回时间环境描述"""
        now = datetime.now()
        hour = now.hour

        period_name = ""
        period_hint = ""
        for start, end, name, hint in self.TIME_PERIODS:
            if start <= hour < end:
                period_name = name
                period_hint = hint
                break

        time_str = now.strftime("%H:%M")
        result = f"现在是{period_name}{time_str}"

        if period_hint:
            result += f"（{period_hint}）"

        # 计算距上次互动时间
        last = self.state["relationship"].get("last_interaction")
        if last:
            try:
                last_time = datetime.fromisoformat(last)
                elapsed = datetime.now() - last_time
                hours = elapsed.total_seconds() / 3600
                if hours >= 24:
                    days = int(hours // 24)
                    result += f"，距离上次和主人说话已经过了{days}天"
                elif hours >= 1:
                    result += f"，距离上次和主人说话已经过了{int(hours)}小时"
                elif elapsed.total_seconds() >= 300:
                    result += f"，距离上次和主人说话已经过了{int(elapsed.total_seconds() // 60)}分钟"
            except Exception:
                pass

        return result

    def get_relationship_description(self) -> str:
        """返回关系阶段描述"""
        rel = self.state["relationship"]
        stage = rel["stage"]
        info = self.RELATIONSHIP_STAGES.get(stage, {})
        hint = info.get("hint", "")

        result = f"关系阶段：{stage}（{hint}）"
        result += f"\n好感度: {rel['affection']:.2f}, 信任度: {rel['trust']:.2f}"
        result += f"\n总互动次数: {rel['interaction_count']}"

        first_met = rel.get("first_met", "")
        if first_met:
            try:
                met_date = datetime.strptime(first_met, "%Y-%m-%d")
                days = (datetime.now() - met_date).days
                result += f"，认识了{days}天"
            except Exception:
                pass

        return result

    def record_interaction(self) -> None:
        """每次互动调用：+1 daily count, +微量 affection/trust"""
        rel = self.state["relationship"]
        rel["interaction_count"] = rel.get("interaction_count", 0) + 1
        rel["last_interaction"] = datetime.now().isoformat()

        # 微量增加好感和信任（递减增长）
        current_affection = rel.get("affection", 0)
        current_trust = rel.get("trust", 0)
        # 越高增长越慢
        rel["affection"] = min(1.0, current_affection + 0.002 * (1 - current_affection))
        rel["trust"] = min(1.0, current_trust + 0.001 * (1 - current_trust))
        rel["familiarity"] = min(1.0, rel.get("familiarity", 0) + 0.003)

        # 初次见面记录
        if not rel.get("first_met"):
            rel["first_met"] = datetime.now().strftime("%Y-%m-%d")

        self.state["daily"]["interactions_today"] = \
            self.state["daily"].get("interactions_today", 0) + 1

        self._check_stage_upgrade()
        self._save()

    def _check_stage_upgrade(self) -> None:
        """检查是否满足升级条件（三项阈值全部达标才升级）"""
        rel = self.state["relationship"]
        current_stage = rel["stage"]
        current_idx = self.STAGE_ORDER.index(current_stage) if current_stage in self.STAGE_ORDER else 0

        # 尝试升级到下一阶段
        if current_idx + 1 < len(self.STAGE_ORDER):
            next_stage = self.STAGE_ORDER[current_idx + 1]
            req = self.RELATIONSHIP_STAGES[next_stage]
            if (rel.get("affection", 0) >= req["affection"]
                    and rel.get("trust", 0) >= req["trust"]
                    and rel.get("interaction_count", 0) >= req["interactions"]):
                rel["stage"] = next_stage
                print(f"[Emotion] 关系升级！{current_stage} → {next_stage}")
