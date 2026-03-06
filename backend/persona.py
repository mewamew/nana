import os
import json
from datetime import datetime

PERSONA_PATH = os.path.join(os.path.dirname(__file__), "..", "save", "persona.json")

def load_persona() -> dict | None:
    """读取 persona.json，不存在或无效时返回 None"""
    try:
        with open(PERSONA_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        if data.get("char_name") and data.get("user_name"):
            return data
    except (FileNotFoundError, json.JSONDecodeError):
        pass
    return None

def save_persona(char_name: str, user_name: str) -> dict:
    """写入 persona.json，返回写入的数据"""
    os.makedirs(os.path.dirname(PERSONA_PATH), exist_ok=True)
    data = {
        "char_name": char_name,
        "user_name": user_name,
        "initialized_at": datetime.now().isoformat()
    }
    with open(PERSONA_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"[Persona] 初始化完成: char_name={char_name}, user_name={user_name}")
    return data

def is_initialized() -> bool:
    """判断是否已完成初始化"""
    return load_persona() is not None
