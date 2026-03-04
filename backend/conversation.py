import asyncio
from typing import List
from datetime import datetime
import uuid
import os
import json
import re



class ConversationTurn:
    def __init__(self, ask: str, answer: str):
        self.ask = ask
        self.answer = answer

    def __str__(self):
        return f"user: {self.ask}\nassistant: {self.answer}"


class ConversationHistory:
    PROFILE_PATH = os.path.join(os.path.dirname(__file__), "..", "save", "memory", "user_profile.json")
    DEFAULT_PROFILE = {
        "basic_info": {"name": "", "gender": "", "location": "", "occupation": "", "birthday": ""},
        "preferences": [], "interests": [], "life_events": [],
        "relationships": [], "other_facts": [], "raw_notes": "", "last_updated": ""
    }

    def __init__(self, max_turns: int = 20, llm_provider=None, embedding_provider=None, db=None):
        self.turns = []
        self.max_turns = max_turns
        self.llm_provider = llm_provider
        self.embedding_provider = embedding_provider
        self.db = db
        # 摘要存储：JSON 文件替代 ChromaDB
        self.summaries_path = os.path.join(
            os.path.dirname(__file__), "..", "save", "memory", "summaries.json"
        )
        self.summaries = self._load_summaries()
        # Embedding 缓存
        self._embedding_cache = None
        if self.embedding_provider:
            from embedding_utils import EmbeddingCache
            self._embedding_cache = EmbeddingCache()
        # 启动时从 SQLite 恢复对话
        self._restore_from_db()
        
    def _load_summaries(self) -> list:
        try:
            if os.path.exists(self.summaries_path):
                with open(self.summaries_path, "r", encoding="utf-8") as f:
                    return json.load(f)
        except Exception as e:
            print(f"[Memory] 加载摘要失败: {e}")
        return []

    def _save_summaries(self):
        os.makedirs(os.path.dirname(self.summaries_path), exist_ok=True)
        with open(self.summaries_path, "w", encoding="utf-8") as f:
            json.dump(self.summaries, f, ensure_ascii=False, indent=2)

    def _restore_from_db(self):
        """启动时从 SQLite 恢复最近 N 轮到内存 turns"""
        if not self.db:
            return
        try:
            dialogs = self.db.get_recent_dialogs(n=self.max_turns)
            for user_msg, assistant_msg in dialogs:
                self.turns.append(ConversationTurn(user_msg, assistant_msg))
            if self.turns:
                print(f"[Memory] 从数据库恢复了 {len(self.turns)} 轮对话")
        except Exception as e:
            print(f"[Memory] 从数据库恢复对话失败: {e}")

    async def add_dialog(self, user_message: str, assistant_message: str):
        """添加新对话，写入 SQLite，并在需要时触发自动归档"""
        turn = ConversationTurn(user_message, assistant_message)
        self.turns.append(turn)

        # 写入 SQLite（失败不阻塞）
        if self.db:
            try:
                self.db.save_dialog(user_message, assistant_message)
            except Exception as e:
                print(f"[Memory] 写入数据库失败: {e}")

        # 当对话数量达到最大值时，自动归档一半的对话
        if len(self.turns) >= self.max_turns:
            await self._auto_archive()

    async def _auto_archive(self):
        """自动归档一半的对话（LLM 双重提取：摘要 + 用户画像）"""
        if not self.turns:
            return

        archive_count = len(self.turns) // 2
        archive_turns = self.turns[:archive_count]

        try:
            # LLM 双重提取：摘要 + 用户画像
            result = await self._extract_memory(archive_turns)

            print(f"[Memory] 归档 {archive_count} 轮对话")
            print(f"[Memory] 摘要: {result['summary'][:100]}...")

            # Tier 2: 摘要存入 JSON
            self.summaries.append({
                "id": str(uuid.uuid4()),
                "summary": result["summary"],
                "topics": result.get("topics", ""),
                "timestamp": datetime.now().isoformat(),
                "turn_count": archive_count,
                "emotional_valence": result.get("emotional_valence", 0.0),
                "emotional_tags": result.get("emotional_tags", []),
                "importance": result.get("importance", 0.5),
            })
            self._save_summaries()

            # 为新摘要生成 embedding 并缓存
            await self._embed_summary(result["summary"])

            # Tier 3: 用户画像增量合并
            if result.get("user_facts"):
                self._merge_profile(result["user_facts"])
        except Exception as e:
            print(f"[Memory] 归档处理失败: {e}")

        # 无论归档是否成功，都移除已归档的对话
        self.turns = self.turns[archive_count:]
        
    async def _extract_memory(self, turns: list) -> dict:
        """用 LLM 从对话中提取摘要和用户画像。失败时降级为原始文本。"""
        if not self.llm_provider:
            return {
                "summary": "\n".join(str(t) for t in turns),
                "topics": "",
                "user_facts": None
            }

        conversation_text = "\n".join(str(t) for t in turns)

        prompt = f"""请分析以下对话记录，提取信息：

## 对话记录
{conversation_text}

## 要求
请严格按以下 JSON 格式返回（不要包含其他文字）：
{{
  "summary": "对话摘要，100字以内，保留关键信息和重要细节",
  "topics": "话题关键词，逗号分隔，如：美食,旅行,工作",
  "emotional_valence": -1到1的浮点数，表示对话的情感色彩（-1很负面，0中性，1很正面），
  "emotional_tags": ["情绪标签数组，如：开心, 害羞"],
  "importance": 0到1的浮点数（日常闲聊0.2，重要事件0.8+），
  "user_facts": {{
    "basic_info": {{}},
    "preferences": [],
    "interests": [],
    "life_events": [],
    "relationships": [],
    "other_facts": []
  }}
}}

注意：
- summary 必须简洁，概括对话的核心内容
- emotional_valence 反映整段对话的情感倾向
- emotional_tags 记录对话中出现的主要情绪
- importance 反映对话内容的重要程度
- user_facts 中只填写本次对话中**新发现**的用户信息，没有则留空数组/空对象
- basic_info 只填写明确提到的字段（name/gender/location/occupation/birthday）
- 不要编造信息，只提取用户明确说过的内容"""

        try:
            raw = await self.llm_provider.chat(
                [{"role": "user", "content": prompt}],
                temperature=0.3
            )
            return self._parse_extraction(raw)
        except Exception as e:
            print(f"[Memory] LLM 提取失败，降级为原始文本: {e}")
            return {
                "summary": "\n".join(str(t) for t in turns),
                "topics": "",
                "user_facts": None
            }

    def _parse_extraction(self, raw: str) -> dict:
        """解析 LLM 返回的 JSON，支持 markdown 代码块包裹"""
        text = raw.strip()

        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            pattern = r'```(?:json\n|\n)?([^`]*?)```'
            match = re.search(pattern, text, re.DOTALL)
            if match:
                data = json.loads(match.group(1).strip())
            else:
                raise ValueError(f"无法解析 LLM 返回: {text[:200]}")

        return {
            "summary": data.get("summary", ""),
            "topics": data.get("topics", ""),
            "emotional_valence": data.get("emotional_valence", 0.0),
            "emotional_tags": data.get("emotional_tags", []),
            "importance": data.get("importance", 0.5),
            "user_facts": data.get("user_facts", None),
        }

    def load_profile(self) -> dict:
        """加载用户画像，文件不存在时返回默认结构"""
        try:
            if os.path.exists(self.PROFILE_PATH):
                with open(self.PROFILE_PATH, "r", encoding="utf-8") as f:
                    profile = json.load(f)
                    for key, default_value in self.DEFAULT_PROFILE.items():
                        if key not in profile:
                            profile[key] = default_value
                    return profile
        except Exception as e:
            print(f"[Memory] 加载用户画像失败: {e}")
        return json.loads(json.dumps(self.DEFAULT_PROFILE))

    def _save_profile(self, profile: dict) -> None:
        """保存用户画像到文件"""
        os.makedirs(os.path.dirname(self.PROFILE_PATH), exist_ok=True)
        profile["last_updated"] = datetime.now().isoformat()
        with open(self.PROFILE_PATH, "w", encoding="utf-8") as f:
            json.dump(profile, f, ensure_ascii=False, indent=2)

    def _merge_profile(self, new_facts: dict) -> None:
        """将新提取的用户信息增量合并到画像中"""
        profile = self.load_profile()

        for key, value in new_facts.get("basic_info", {}).items():
            if value and key in profile["basic_info"]:
                profile["basic_info"][key] = value

        array_fields = ["preferences", "interests", "life_events", "relationships", "other_facts"]
        for field in array_fields:
            existing = profile.get(field, [])
            new_items = new_facts.get(field, [])
            for item in new_items:
                if item and item not in existing:
                    existing.append(item)
            profile[field] = existing

        self._save_profile(profile)
        print(f"[Memory] 用户画像已更新")

    def update_raw_notes(self, notes: str) -> None:
        """更新 raw_notes 字段（由 main_agent 每次回复时调用，替代 me.txt）"""
        if not notes:
            return
        profile = self.load_profile()
        profile["raw_notes"] = notes
        self._save_profile(profile)

    def format_profile(self) -> str:
        """将用户画像格式化为可读文本，用于填入 prompt 的 {user_info} 占位符"""
        profile = self.load_profile()
        parts = []

        info_items = {k: v for k, v in profile.get("basic_info", {}).items() if v}
        if info_items:
            labels = {"name": "名字", "gender": "性别", "location": "所在地",
                      "occupation": "职业", "birthday": "生日"}
            info_str = "、".join(f"{labels.get(k, k)}: {v}" for k, v in info_items.items())
            parts.append(f"基本信息：{info_str}")

        field_labels = {
            "preferences": "偏好", "interests": "兴趣",
            "life_events": "近况", "relationships": "关系",
            "other_facts": "其他"
        }
        for field, label in field_labels.items():
            items = profile.get(field, [])
            if items:
                parts.append(f"{label}：{'、'.join(items)}")

        raw = profile.get("raw_notes", "").strip()
        if raw and not parts:
            return raw

        return "\n".join(parts) if parts else ""

    async def _embed_summary(self, summary: str):
        """为摘要生成 embedding 并缓存，失败时静默跳过"""
        if not self.embedding_provider or not self._embedding_cache:
            return
        try:
            vectors = await self.embedding_provider.embed([summary])
            if vectors:
                self._embedding_cache.put(summary, vectors[0])
                print(f"[Memory] 已缓存摘要 embedding（维度={len(vectors[0])}）")
        except Exception as e:
            print(f"[Memory] 生成 embedding 失败，跳过: {e}")

    def get_context(self) -> str:
        """获取格式化后的对话上下文"""
        return "\n".join(str(turn) for turn in self.turns)

    async def retrieve_async(self, user_message: str, n_results: int = 3) -> List[str]:
        """异步检索：有 embedding 时用向量匹配，否则降级为关键词匹配"""
        if not self.embedding_provider or not self._embedding_cache:
            return self.retrieve(user_message, n_results)

        if not self.summaries:
            return []

        try:
            from embedding_utils import cosine_similarity

            # 获取 query 的 embedding
            query_vectors = await self.embedding_provider.embed([user_message])
            if not query_vectors:
                return self.retrieve(user_message, n_results)
            query_vec = query_vectors[0]

            # 对每条摘要计算相似度
            scored = []
            for item in self.summaries:
                summary = item.get("summary", "")
                cached_vec = self._embedding_cache.get(summary)
                if cached_vec:
                    score = cosine_similarity(query_vec, cached_vec)
                    scored.append((score, summary))

            if not scored:
                return self.retrieve(user_message, n_results)

            scored.sort(key=lambda x: x[0], reverse=True)
            return [s[1] for s in scored[:n_results]]
        except Exception as e:
            print(f"[Memory] 向量检索失败，降级为关键词匹配: {e}")
            return self.retrieve(user_message, n_results)

    def retrieve(self, user_message: str, n_results: int = 3,
                 current_emotion: str = None) -> List[str]:
        """获取与用户消息最相关的历史记忆（关键词匹配 + 时间衰减 + 情感共鸣）"""
        if not self.summaries:
            return []

        now = datetime.now()
        scored = []
        for item in self.summaries:
            score = 0
            topics = [t.strip() for t in item.get("topics", "").split(",") if t.strip()]
            for topic in topics:
                if topic in user_message:
                    score += 2
            # summary 中的字符重叠（简单子串匹配）
            summary = item.get("summary", "")
            for char in set(user_message):
                if char in summary and char.strip():
                    score += 0.1

            if score > 0:
                # 时间衰减（30天半衰期）
                try:
                    created = datetime.fromisoformat(item["timestamp"])
                    days_old = (now - created).days
                    decay = 0.5 ** (days_old / 30)
                    score *= decay
                except Exception:
                    pass

                # 重要性加权（0.5x ~ 1.5x）
                importance = item.get("importance", 0.5)
                score *= (0.5 + importance)

                # 情感共鸣（当前情绪匹配的记忆 +50%）
                if current_emotion and current_emotion in item.get("emotional_tags", []):
                    score *= 1.5

                scored.append((score, item["summary"]))

        # 按分数排序，取 top N
        scored.sort(key=lambda x: x[0], reverse=True)
        results = [s[1] for s in scored[:n_results]]
        # 无匹配时返回最近 N 条兜底
        if not results:
            results = [item["summary"] for item in self.summaries[-n_results:]]
        return results


if __name__ == "__main__":
    h = ConversationHistory(max_turns=20)
    print("summaries:", len(h.summaries))
    print(h.retrieve("测试"))

