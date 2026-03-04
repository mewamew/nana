"""每日日记生成 — 娜娜视角"""

import os
from datetime import datetime

from emotional_state import EmotionalState


class NanaDiary:
    DIARY_DIR = os.path.join(os.path.dirname(__file__), "..", "save", "diary")

    def __init__(self, llm_provider, emotional_state: EmotionalState):
        self.llm_provider = llm_provider
        self.emotional_state = emotional_state
        prompt_path = os.path.join(os.path.dirname(__file__), "prompts", "diary.md")
        with open(prompt_path, "r", encoding="utf-8") as f:
            self.prompt_template = f.read()

    async def write_daily_entry(self, conversation_log: str) -> str:
        """生成并保存日记到 save/diary/YYYY-MM-DD.txt"""
        now = datetime.now()
        prompt = self.prompt_template.format(
            date=now.strftime("%Y-%m-%d"),
            mood=self.emotional_state.get_mood_description(),
            relationship=self.emotional_state.get_relationship_description(),
            conversations=conversation_log[:3000],  # 限制长度防止 token 溢出
        )

        try:
            raw = await self.llm_provider.chat(
                [{"role": "user", "content": prompt}],
                temperature=0.7,
            )
            entry = raw.strip()
        except Exception as e:
            print(f"[Diary] LLM 生成日记失败: {e}")
            return ""

        # 保存日记
        try:
            os.makedirs(self.DIARY_DIR, exist_ok=True)
            diary_path = os.path.join(self.DIARY_DIR, f"{now.strftime('%Y-%m-%d')}.txt")
            with open(diary_path, "w", encoding="utf-8") as f:
                f.write(entry)
            print(f"[Diary] 日记已保存: {diary_path}")
            return entry
        except Exception as e:
            print(f"[Diary] 保存日记失败: {e}")
            return entry

    def get_recent_entries(self, days: int = 3) -> str:
        """读取最近 N 天日记"""
        entries = []
        try:
            if not os.path.exists(self.DIARY_DIR):
                return ""
            files = sorted(os.listdir(self.DIARY_DIR), reverse=True)
            for fname in files[:days]:
                fpath = os.path.join(self.DIARY_DIR, fname)
                with open(fpath, "r", encoding="utf-8") as f:
                    date = fname.replace(".txt", "")
                    entries.append(f"[{date}]\n{f.read()}")
        except Exception as e:
            print(f"[Diary] 读取日记失败: {e}")
        return "\n\n".join(entries)
