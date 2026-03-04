# ARCHITECTURE.md — Nana 项目架构总纲

> 所有参与开发的 Agent 在实现前必须完整阅读本文档。本文档中的接口契约、目录结构、配置格式均为强制约定，不得擅自修改。

---

## 1. 项目概述

Nana 是一个二次元 AI 伴侣应用，包含：
- **后端**：FastAPI (Python)，提供 AI 对话、TTS 合成、STT 识别接口
- **前端**：React + Vite，展示 Live2D 角色、对话字幕、配置界面

核心功能：
1. 支持多家 LLM（国产为主，兼容国外和本地）
2. 支持多家 TTS（Fish Audio + 本地 Qwen3 TTS）
3. 支持多家 STT（本地 Whisper + Qwen3-ASR-Flash）
4. 升级记忆系统（LLM 摘要归档，JSON 存储）
5. 配置 UI 化（前端可视化配置所有 Provider）
6. 后端流式输出（SSE）
7. Agentic Loop（工具调用：时间查询、记忆搜索）

---

## 2. 核心设计模式：Provider 抽象层

所有外部服务（LLM、TTS、STT）统一遵循 **Provider 模式**：

```
抽象基类 (Base)
    └── 具体实现 A
    └── 具体实现 B
    └── ...

ProviderFactory.get(name) → 返回当前激活的 Provider 实例
```

**规则**：
- 业务代码只依赖基类接口，不直接引用具体实现
- 通过 `config.json` 中的 `active` 字段决定使用哪个 Provider
- 切换 Provider 只需改 `config.json`，不改业务代码

---

## 3. 目录结构

```
nana/
├── backend/
│   ├── providers/
│   │   ├── __init__.py           # 导出 get_llm / get_tts / get_stt 工厂函数
│   │   ├── llm/
│   │   │   ├── base.py           # BaseLLMProvider
│   │   │   ├── openai_compatible.py  # 覆盖 8 家 OpenAI 兼容服务
│   │   │   └── anthropic.py      # Claude 专用实现
│   │   ├── tts/
│   │   │   ├── base.py           # BaseTTSProvider
│   │   │   ├── fish_audio.py
│   │   │   └── qwen3_tts.py
│   │   └── stt/
│   │       ├── base.py           # BaseSTTProvider
│   │       ├── whisper_local.py
│   │       └── qwen3_asr.py
│   ├── config_manager.py         # config.json 读写，热重载
│   ├── main.py                   # FastAPI 入口，路由定义
│   ├── chat_service.py           # 对话流程编排（调用 LLM/TTS）
│   ├── main_agent.py             # AI Agent 核心逻辑（含 Agentic Loop）
│   ├── conversation.py           # 记忆管理（JSON 文件存储）
│   ├── tools.py                  # 工具定义与执行器
│   └── prompts/
│       ├── reply.txt             # 角色系统提示词
│       └── tool_decision.txt     # 工具决策 Prompt
│
├── frontend/
│   └── src/
│       ├── App.jsx
│       ├── components/
│       │   ├── Live2DModel.jsx
│       │   ├── ConfigPanel.jsx   # 新增：配置 UI
│       │   ├── VoiceInput.jsx    # 新增：语音输入按钮
│       │   └── LoadingDots.jsx
│       └── api/
│           └── client.js         # 新增：统一 API 请求封装
│
├── config.json                   # 运行时配置（已加入 .gitignore）
├── config.example.json           # 配置模板（提交到 git）
└── specs/                        # 本文件所在目录
```

---

## 4. 配置文件格式（`config.json`）

**位置**：项目根目录 `nana/config.json`（`config_manager.py` 从此路径读取）

**完整结构**：
```json
{
  "llm": {
    "active": "deepseek",
    "providers": {
      "deepseek":  { "api_key": "", "model": "deepseek-chat",       "base_url": "https://api.deepseek.com/v1" },
      "qwen":      { "api_key": "", "model": "qwen-plus",           "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1" },
      "doubao":    { "api_key": "", "model": "doubao-pro-32k",      "base_url": "https://ark.cn-beijing.volces.com/api/v3" },
      "glm":       { "api_key": "", "model": "glm-4",               "base_url": "https://open.bigmodel.cn/api/paas/v4" },
      "minimax":   { "api_key": "", "model": "abab6.5s-chat",       "base_url": "https://api.minimax.chat/v1" },
      "openai":    { "api_key": "", "model": "gpt-4o",              "base_url": "https://api.openai.com/v1" },
      "claude":    { "api_key": "", "model": "claude-sonnet-4-6",   "base_url": "" },
      "ollama":    { "api_key": "",  "model": "qwen2.5",             "base_url": "http://localhost:11434/v1" },
      "lmstudio":  { "api_key": "", "model": "local-model",         "base_url": "http://localhost:1234/v1" }
    }
  },
  "tts": {
    "active": "fish_audio",
    "providers": {
      "fish_audio": { "api_key": "", "reference_id": "de00397ed7f6477a8763a0d436ece815" },
      "qwen3_tts":  { "base_url": "http://localhost:8887", "voice": "default" }
    }
  },
  "stt": {
    "active": "whisper_local",
    "providers": {
      "whisper_local": { "model": "medium", "device": "cpu", "language": "zh" },
      "qwen3_asr":     { "base_url": "http://localhost:8888" }
    }
  }
}
```

**约束**：
- `active` 字段值必须是 `providers` 对象中的一个 key
- `api_key` 为空字符串表示未配置（前端 ConfigPanel 负责显示警告）
- 本地服务（ollama/lmstudio/qwen3_tts/qwen3_asr）的 `api_key` 可以为空

---

## 5. Python 接口契约

### 5.1 LLM Provider

```python
# backend/providers/llm/base.py

from abc import ABC, abstractmethod
from typing import AsyncGenerator

class BaseLLMProvider(ABC):
    """所有 LLM Provider 必须实现此接口"""

    @abstractmethod
    async def chat_stream(
        self,
        messages: list[dict],   # [{"role": "user/system/assistant", "content": "..."}]
        temperature: float = 0.7
    ) -> AsyncGenerator[str, None]:
        """流式生成，逐步 yield 文本片段（token 级别）"""
        ...

    async def chat(
        self,
        messages: list[dict],
        temperature: float = 0.7
    ) -> str:
        """非流式调用，默认实现为聚合 chat_stream"""
        result = []
        async for chunk in self.chat_stream(messages, temperature):
            result.append(chunk)
        return "".join(result)
```

### 5.2 TTS Provider

```python
# backend/providers/tts/base.py

from abc import ABC, abstractmethod

class BaseTTSProvider(ABC):
    """所有 TTS Provider 必须实现此接口"""

    @abstractmethod
    async def synthesize(self, text: str) -> bytes:
        """将文字合成为音频，返回 MP3/WAV 字节数据"""
        ...

    def is_configured(self) -> bool:
        """返回该 Provider 是否已完成配置（有 API Key 等）"""
        return True
```

### 5.3 STT Provider

```python
# backend/providers/stt/base.py

from abc import ABC, abstractmethod

class BaseSTTProvider(ABC):
    """所有 STT Provider 必须实现此接口"""

    @abstractmethod
    async def transcribe(
        self,
        audio_data: bytes,
        format: str = "wav"   # "wav" | "mp3" | "webm"
    ) -> str:
        """将音频转为文字，返回识别结果字符串"""
        ...
```

### 5.4 Provider 工厂

```python
# backend/providers/__init__.py

from config_manager import ConfigManager
from providers.llm.openai_compatible import OpenAICompatibleProvider
from providers.llm.anthropic import AnthropicProvider
from providers.tts.fish_audio import FishAudioProvider
from providers.tts.qwen3_tts import Qwen3TTSProvider
from providers.stt.whisper_local import WhisperLocalProvider
from providers.stt.qwen3_asr import Qwen3ASRProvider

def get_llm() -> BaseLLMProvider:
    cfg = ConfigManager.get_llm_config()
    if cfg["active"] == "claude":
        return AnthropicProvider(cfg["providers"]["claude"])
    return OpenAICompatibleProvider(cfg["active"], cfg["providers"][cfg["active"]])

def get_tts() -> BaseTTSProvider:
    cfg = ConfigManager.get_tts_config()
    providers = {
        "fish_audio": FishAudioProvider,
        "qwen3_tts": Qwen3TTSProvider,
    }
    return providers[cfg["active"]](cfg["providers"][cfg["active"]])

def get_stt() -> BaseSTTProvider:
    cfg = ConfigManager.get_stt_config()
    providers = {
        "whisper_local": WhisperLocalProvider,
        "qwen3_asr": Qwen3ASRProvider,
    }
    return providers[cfg["active"]](cfg["providers"][cfg["active"]])
```

---

## 6. SSE 事件协议

后端 `/api/chat` 端点返回 SSE 流，前端按事件类型处理：

```
Content-Type: text/event-stream

data: {"type": "text",       "content": "哼"}
data: {"type": "text",       "content": "，才不是呢"}
data: {"type": "expression", "content": "脸红"}
data: {"type": "audio",      "content": "<base64_mp3>"}
data: {"type": "done"}

# 出错时：
data: {"type": "error",      "content": "LLM 服务暂时不可用"}
```

**顺序约定**：
1. `text` 事件在 LLM 生成时实时发送（多个）
2. `expression` 事件在 LLM 完整回复解析后发送（1个）
3. `audio` 事件在 TTS 合成完成后发送（0或1个，取决于 TTS 是否启用）
4. `done` 事件最后发送

---

## 7. 后端 API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/chat` | SSE 流式对话 |
| POST | `/api/stt` | 语音转文字（返回 JSON） |
| GET  | `/api/config` | 获取当前配置（脱敏，api_key 返回 `***`） |
| POST | `/api/config` | 更新配置（传入完整或部分 config.json） |

### `/api/chat` 请求体
```json
{ "message": "你好" }
```

### `/api/stt` 请求体
```
Content-Type: multipart/form-data
file: <audio blob>
format: "webm"
```

### `/api/stt` 响应
```json
{ "text": "识别出的文字" }
```

### `/api/config` GET 响应（脱敏）
```json
{
  "llm": { "active": "deepseek", "providers": { "deepseek": { "api_key": "***", "model": "..." } } },
  ...
}
```

---

## 8. 记忆系统设计

详见 `specs/05-memory-upgrade.md`。

**实际实现**（已放弃 ChromaDB，改用纯 JSON 文件）：

| 层级 | 内容 | 存储位置 |
|------|------|----------|
| Tier 1（热） | 最近 N 轮对话（内存） | `ConversationHistory.turns` |
| Tier 2（温） | LLM 生成的对话摘要 | `save/memory/summaries.json` |
| Tier 3（冷） | 用户画像（结构化 + raw notes） | `save/memory/user_profile.json` |

**归档触发**：`turns` 达到 `max_turns`（默认20）时，自动将前一半归档为摘要。

**检索方式**：关键词匹配（topics 命中 +2分，summary 字符重叠 +0.1分），无匹配时返回最近 N 条兜底。

---

## 9. 关键约束

1. **不使用 `.env` 文件**，配置统一由 `config.json` 管理
2. **`config.json` 加入 `.gitignore`**，使用 `config.example.json` 作为模板
3. **业务代码不直接 import 具体 Provider 类**，只通过工厂函数获取
4. **不修改 `prompts/reply.txt`**（角色人设独立维护）
5. **不修改 Live2D 相关逻辑**（`Live2DModel.jsx` 仅允许 `07-frontend` spec 修改）
6. **Python 最低版本**：3.10（使用 `match` 语句和 `list[dict]` 泛型语法）
