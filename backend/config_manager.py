import copy
import json
import os
import shutil
from typing import Any, MutableMapping


def _deep_merge(base: MutableMapping[str, Any], override: MutableMapping[str, Any]) -> None:
    for k, v in override.items():
        if k in base and isinstance(base[k], dict) and isinstance(v, dict):
            _deep_merge(base[k], v)
        else:
            base[k] = v


class ConfigManager:
    CONFIG_PATH = os.path.join(os.path.dirname(__file__), "..", "config.json")
    EXAMPLE_PATH = os.path.join(os.path.dirname(__file__), "..", "config.example.json")

    @classmethod
    def load(cls) -> dict[str, Any]:
        if not os.path.exists(cls.CONFIG_PATH):
            shutil.copy(cls.EXAMPLE_PATH, cls.CONFIG_PATH)
        with open(cls.CONFIG_PATH, encoding="utf-8") as f:
            config = json.load(f)
        # 自动补全 example 中存在但 config 中缺失的顶层段
        if os.path.exists(cls.EXAMPLE_PATH):
            with open(cls.EXAMPLE_PATH, encoding="utf-8") as f:
                example = json.load(f)
            for key in example:
                if key not in config:
                    config[key] = example[key]
        return config

    @classmethod
    def save(cls, config: dict[str, Any]) -> None:
        with open(cls.CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(config, f, indent=2, ensure_ascii=False)

    @classmethod
    def get_llm_config(cls) -> dict[str, Any]:
        return cls.load()["llm"]

    @classmethod
    def get_tts_config(cls) -> dict[str, Any]:
        return cls.load()["tts"]

    @classmethod
    def get_stt_config(cls) -> dict[str, Any]:
        return cls.load()["stt"]

    @classmethod
    def update(cls, partial: dict[str, Any]) -> dict[str, Any]:
        config = cls.load()
        _deep_merge(config, partial)
        cls.save(config)
        return config

    @classmethod
    def get_masked(cls) -> dict[str, Any]:
        config = copy.deepcopy(cls.load())
        cls._mask_keys(config)
        return config

    @classmethod
    def _mask_keys(cls, obj: dict[str, Any] | list[Any]) -> None:
        if isinstance(obj, list):
            for item in obj:
                if isinstance(item, (dict, list)):
                    cls._mask_keys(item)
            return
        for k, v in obj.items():
            if isinstance(v, (dict, list)):
                cls._mask_keys(v)
            elif k == "api_key" and v:
                obj[k] = "***"
