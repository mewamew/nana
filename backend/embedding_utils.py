import hashlib
import json
import math
import os


def cosine_similarity(a: list[float], b: list[float]) -> float:
    """纯 Python 余弦相似度"""
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


class EmbeddingCache:
    """JSON 文件缓存，key 为文本 SHA-256 前 16 位，value 为向量"""

    def __init__(self, cache_path: str = None):
        if cache_path is None:
            cache_path = os.path.join(
                os.path.dirname(__file__), "..", "save", "memory", "embedding_cache.json"
            )
        self.cache_path = cache_path
        self._cache = self._load()

    def _load(self) -> dict:
        try:
            if os.path.exists(self.cache_path):
                with open(self.cache_path, "r", encoding="utf-8") as f:
                    return json.load(f)
        except Exception as e:
            print(f"[EmbeddingCache] 加载缓存失败: {e}")
        return {}

    def _save(self):
        os.makedirs(os.path.dirname(self.cache_path), exist_ok=True)
        with open(self.cache_path, "w", encoding="utf-8") as f:
            json.dump(self._cache, f, ensure_ascii=False)

    @staticmethod
    def _key(text: str) -> str:
        return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]

    def get(self, text: str) -> list[float] | None:
        return self._cache.get(self._key(text))

    def put(self, text: str, vector: list[float]):
        self._cache[self._key(text)] = vector
        self._save()

    def get_all_vectors(self) -> list[tuple[str, list[float]]]:
        """返回所有 (cache_key, vector) 对"""
        return list(self._cache.items())
