import json
import re
from typing import Any


def parse_llm_json(raw: str) -> dict[str, Any]:
    """解析 LLM 返回的 JSON，支持 markdown 代码块包裹"""
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pattern = r'```(?:json\n|\n)?([^`]*?)```'
        match = re.search(pattern, raw, re.DOTALL)
        if match:
            return json.loads(match.group(1).strip())
        raise ValueError(f"Failed to parse JSON: {raw[:100]}")
