# 11-vector-memory — 向量化记忆检索

**Status: ✅ Implemented (2026-03-04)**

## 背景与目标

当前记忆检索（`conversation.py` 的 `retrieve()` 方法）使用关键词匹配 + 字符重叠评分，语义理解能力弱。例如用户问"我之前提到过的那个好吃的餐厅"，关键词匹配无法关联到"上周去吃了日料，特别好吃"的摘要。

本 spec 引入 **Embedding 向量化检索**：将归档摘要通过 Embedding API 转为向量，检索时计算余弦相似度，实现真正的语义匹配。

设计原则：
- 复用项目现有的 Provider 框架（`01-provider-framework`）
- 纯 Python + JSON 实现，不引入 ChromaDB / FAISS 等外部依赖
- 降级策略：embedding 未配置时，行为与当前关键词匹配完全一致

---

## 文件边界

### 新建文件
- `backend/providers/embedding/__init__.py`：工厂函数
- `backend/providers/embedding/base.py`：Embedding Provider 基类
- `backend/providers/embedding/openai_compatible.py`：OpenAI 兼容的 Embedding 实现
- `backend/embedding_utils.py`：余弦相似度计算、EmbeddingCache

### 修改文件
- `backend/conversation.py`：新增 `retrieve_async()`、归档时生成 embedding
- `backend/chat_service.py`：调用 `retrieve_async()` 替代同步 `retrieve()`
- `backend/providers/__init__.py`：新增 `get_embedding()` 工厂函数
- `config.example.json`：新增 `embedding` 配置段

### 不得修改
- `backend/main_agent.py`
- `backend/main.py`
- `backend/prompts/`
- `frontend/` 下任何文件

---

## 依赖

- `01-provider-framework`（Provider 框架 + ConfigManager，已实现）
- `05-memory-upgrade`（三层记忆架构 + 摘要归档，已实现）

---

## 接口契约

### Embedding Provider 基类

```python
# backend/providers/embedding/base.py
from abc import ABC, abstractmethod

class BaseEmbeddingProvider(ABC):
    @abstractmethod
    async def embed(self, texts: list[str]) -> list[list[float]]:
        """
        将文本列表转为向量列表。
        texts: ["文本1", "文本2", ...]
        返回: [[0.1, 0.2, ...], [0.3, 0.4, ...], ...]
        """
        ...

    def is_configured(self) -> bool:
        return True
```

### OpenAI Compatible Embedding

```python
# backend/providers/embedding/openai_compatible.py
import httpx
from providers.embedding.base import BaseEmbeddingProvider

class OpenAICompatibleEmbedding(BaseEmbeddingProvider):
    def __init__(self, config: dict):
        self.api_key = config.get("api_key", "")
        self.model = config.get("model", "text-embedding-3-small")
        self.base_url = config.get("base_url", "https://api.openai.com/v1")

    async def embed(self, texts: list[str]) -> list[list[float]]:
        """调用 OpenAI 兼容的 /embeddings 接口"""
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                f"{self.base_url}/embeddings",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json={"input": texts, "model": self.model}
            )
            response.raise_for_status()
            data = response.json()
            return [item["embedding"] for item in data["data"]]

    def is_configured(self) -> bool:
        return bool(self.api_key)
```

### 工厂函数

```python
# backend/providers/__init__.py 新增
def get_embedding() -> BaseEmbeddingProvider | None:
    """
    返回 Embedding Provider 实例，未配置时返回 None。
    调用方应检查返回值，None 表示降级为关键词匹配。
    """
```

### `config.example.json` 新增配置段

```json
{
  "llm": { ... },
  "tts": { ... },
  "stt": { ... },
  "embedding": {
    "active": "openai",
    "providers": {
      "openai": {
        "api_key": "",
        "model": "text-embedding-3-small",
        "base_url": "https://api.openai.com/v1"
      },
      "deepseek": {
        "api_key": "",
        "model": "deepseek-embedding",
        "base_url": "https://api.deepseek.com/v1"
      },
      "ollama": {
        "api_key": "",
        "model": "nomic-embed-text",
        "base_url": "http://localhost:11434/v1"
      }
    }
  }
}
```

---

## 实现要求

### `embedding_utils.py`

```python
# backend/embedding_utils.py
import json
import os
import math


def cosine_similarity(a: list[float], b: list[float]) -> float:
    """计算两个向量的余弦相似度"""
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


class EmbeddingCache:
    """
    基于 JSON 文件的 Embedding 缓存。
    key: 文本内容的 hash → value: 向量
    避免对相同文本重复调用 Embedding API。
    """

    def __init__(self, cache_path: str):
        self.cache_path = cache_path
        self.cache: dict[str, list[float]] = self._load()

    def _load(self) -> dict:
        try:
            if os.path.exists(self.cache_path):
                with open(self.cache_path, "r", encoding="utf-8") as f:
                    return json.load(f)
        except Exception as e:
            print(f"[EmbeddingCache] 加载缓存失败: {e}")
        return {}

    def _save(self) -> None:
        os.makedirs(os.path.dirname(self.cache_path), exist_ok=True)
        with open(self.cache_path, "w", encoding="utf-8") as f:
            json.dump(self.cache, f, ensure_ascii=False)

    def _hash(self, text: str) -> str:
        import hashlib
        return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]

    def get(self, text: str) -> list[float] | None:
        return self.cache.get(self._hash(text))

    def put(self, text: str, vector: list[float]) -> None:
        self.cache[self._hash(text)] = vector
        self._save()

    def put_batch(self, texts: list[str], vectors: list[list[float]]) -> None:
        for text, vec in zip(texts, vectors):
            self.cache[self._hash(text)] = vec
        self._save()
```

### `conversation.py` 修改

#### 新增属性

```python
def __init__(self, max_turns: int = 20, llm_provider=None, embedding_provider=None):
    # ... 现有代码 ...
    self.embedding_provider = embedding_provider
    # Embedding 缓存
    self.embedding_cache_path = os.path.join(
        os.path.dirname(__file__), "..", "save", "memory", "embedding_cache.json"
    )
```

#### `_auto_archive()` 增加 embedding 生成

```python
async def _auto_archive(self):
    # ... 现有归档逻辑 ...

    # 归档成功后，为新摘要生成 embedding
    if self.embedding_provider and result.get("summary"):
        try:
            from embedding_utils import EmbeddingCache
            cache = EmbeddingCache(self.embedding_cache_path)
            vectors = await self.embedding_provider.embed([result["summary"]])
            if vectors:
                cache.put(result["summary"], vectors[0])
                print(f"[Memory] 已为摘要生成 embedding")
        except Exception as e:
            print(f"[Memory] Embedding 生成失败（不影响归档）: {e}")
```

#### 新增 `retrieve_async()` 方法

```python
async def retrieve_async(self, user_message: str, n_results: int = 3) -> list[str]:
    """
    异步语义检索。有 embedding 时用向量匹配，否则降级为关键词。
    签名与 retrieve() 一致，但为 async。
    """
    if not self.summaries:
        return []

    if not self.embedding_provider:
        # 降级为现有关键词匹配
        return self.retrieve(user_message, n_results)

    try:
        from embedding_utils import EmbeddingCache, cosine_similarity
        cache = EmbeddingCache(self.embedding_cache_path)

        # 对用户消息生成 embedding
        query_vectors = await self.embedding_provider.embed([user_message])
        if not query_vectors:
            return self.retrieve(user_message, n_results)
        query_vec = query_vectors[0]

        # 对每条摘要计算相似度
        scored = []
        uncached_texts = []
        uncached_indices = []

        for i, item in enumerate(self.summaries):
            summary = item.get("summary", "")
            vec = cache.get(summary)
            if vec:
                score = cosine_similarity(query_vec, vec)
                scored.append((score, summary))
            else:
                uncached_texts.append(summary)
                uncached_indices.append(i)

        # 批量生成未缓存的 embedding
        if uncached_texts:
            new_vectors = await self.embedding_provider.embed(uncached_texts)
            cache.put_batch(uncached_texts, new_vectors)
            for text, vec in zip(uncached_texts, new_vectors):
                score = cosine_similarity(query_vec, vec)
                scored.append((score, text))

        scored.sort(key=lambda x: x[0], reverse=True)
        return [s[1] for s in scored[:n_results]]

    except Exception as e:
        print(f"[Memory] 向量检索失败，降级为关键词: {e}")
        return self.retrieve(user_message, n_results)
```

### `chat_service.py` 修改

```python
from providers import get_llm, get_tts, get_embedding

class ChatService:
    def __init__(self) -> None:
        self.llm_adapter = LLMProviderAdapter()
        self.conversation_history = ConversationHistory(
            max_turns=20,
            llm_provider=get_llm(),
            embedding_provider=get_embedding()  # 可能为 None
        )
        self.main_agent = MainAgent(self.llm_adapter, self.conversation_history)
```

### `providers/__init__.py` 新增

```python
from config_manager import ConfigManager

def get_embedding():
    """返回 Embedding Provider 实例，未配置时返回 None"""
    config = ConfigManager.load()
    embedding_config = config.get("embedding")
    if not embedding_config:
        return None

    active = embedding_config.get("active", "")
    provider_config = embedding_config.get("providers", {}).get(active)
    if not provider_config or not provider_config.get("api_key"):
        return None

    from providers.embedding.openai_compatible import OpenAICompatibleEmbedding
    provider = OpenAICompatibleEmbedding(provider_config)
    return provider if provider.is_configured() else None
```

---

## 数据流

```
归档时:
    摘要文本 → Embedding API → 向量 → embedding_cache.json

检索时:
    用户消息 → Embedding API → query 向量
    遍历 summaries:
        summary → cache.get() 或 Embedding API → summary 向量
        cosine_similarity(query, summary) → 分数
    按分数排序 → top N 结果
```

---

## 关键设计决策

| 问题 | 决策 |
|------|------|
| 向量存储方案 | JSON 文件（`embedding_cache.json`），不引入 ChromaDB/FAISS |
| 为什么不用 FAISS | 项目规模小（百~千条摘要），暴力搜索足够快，避免 C 扩展依赖 |
| 余弦相似度实现 | 纯 Python 实现，不依赖 numpy（摘要数量少，性能不是瓶颈） |
| Embedding 缓存 key | 文本内容 SHA-256 前 16 位（碰撞概率极低） |
| 缓存何时写入 | 每次 `put` / `put_batch` 后立即写入磁盘 |
| `retrieve()` 签名是否改变 | 不改，新增 `retrieve_async()` 异步版本，旧 `retrieve()` 保持原样 |
| embedding 未配置时 | `get_embedding()` 返回 None → `retrieve_async()` 降级为关键词 |
| API 失败时 | 捕获异常，降级为关键词匹配，打印日志 |

---

## 约束

- 不引入任何新 pip 依赖（httpx 已有，math/hashlib 为标准库）
- `retrieve()` 同步方法签名和行为不变（被 `tools.py` 的 `search_memory` 工具调用）
- embedding 未配置时，系统行为与本 spec 实施前完全一致
- `embedding_cache.json` 存储在 `save/memory/` 目录（已 gitignore）
- Embedding 向量维度不做假设，由 Provider 返回决定

---

## 验收标准

- [ ] `config.example.json` 包含 `embedding` 配置段
- [ ] embedding 已配置时，`retrieve_async()` 使用余弦相似度检索，语义相关的摘要排名靠前
- [ ] embedding 未配置时，`retrieve_async()` 降级为关键词匹配，行为与当前 `retrieve()` 一致
- [ ] Embedding API 调用失败时，降级为关键词匹配，不报错不中断
- [ ] 归档摘要时自动生成 embedding 并缓存
- [ ] 相同文本不重复调用 Embedding API（缓存命中）
- [ ] `retrieve()` 同步方法不被修改，`tools.py` 不受影响
- [ ] 不引入 ChromaDB、FAISS、numpy 等外部依赖
