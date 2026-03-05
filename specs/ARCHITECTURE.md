# ARCHITECTURE.md — Nana 项目架构总纲

> 所有参与开发的 Agent 在实现前必须完整阅读本文档。本文档中的接口契约、目录结构、配置格式均为强制约定，不得擅自修改。

---

## 1. 项目概述

Nana 是一个二次元 AI 伴侣应用，包含：
- **后端**：FastAPI (Python)，提供 AI 对话、TTS 合成、STT 识别接口
- **前端**：React + Vite，展示 Live2D 角色、对话字幕、配置界面

核心功能：
1. 多 LLM 支持（DeepSeek / Qwen / Doubao / GLM / MiniMax / OpenAI / Claude / Ollama / LMStudio）
2. 多 TTS 支持（Fish Audio / 本地 Qwen3 TTS）
3. 多 STT 支持（本地 Whisper / Qwen3-ASR）
4. 三层记忆系统（热/温/冷，LLM 摘要归档）
5. 配置 UI（前端可视化配置所有 Provider）
6. SSE 流式输出（text / expression / audio / motion 事件）
7. Agentic Loop（工具调用：时间查询、记忆搜索、技能调用）
8. 心跳系统（60s tick + LLM 决策 + 注意力管理，主动发消息）
9. Skill 插件系统（可插拔能力扩展，当前：天气查询）
10. 对话持久化（SQLite，重启恢复历史）
11. 真人动捕动作（MediaPipe → motion3.json 录制 + 回放）

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
│   │   │   ├── openai_compatible.py  # 覆盖 9 家 OpenAI 兼容服务
│   │   │   └── anthropic.py      # Claude 专用实现
│   │   ├── tts/
│   │   │   ├── base.py           # BaseTTSProvider
│   │   │   ├── fish_audio.py
│   │   │   └── qwen3_tts.py
│   │   └── stt/
│   │       ├── base.py           # BaseSTTProvider
│   │       ├── whisper_local.py
│   │       └── qwen3_asr.py
│   ├── skills/                   # Skill 插件目录
│   │   └── weather/              # 天气查询 skill
│   │       ├── SKILL.md
│   │       ├── tool.py
│   │       └── requirements.txt
│   ├── prompts/
│   │   ├── soul.md               # 角色人设（不得修改）
│   │   ├── reply.md              # 回复指令 Prompt
│   │   ├── heartbeat.md          # 心跳 LLM 决策 Prompt
│   │   ├── memory_extract.md     # 记忆提取 Prompt
│   │   └── tool_decision.md      # 工具决策 Prompt
│   ├── config_manager.py         # config.json 读写，热重载
│   ├── main.py                   # FastAPI 入口，路由定义
│   ├── chat_service.py           # 对话流程编排（调用 LLM/TTS）
│   ├── main_agent.py             # AI Agent 核心逻辑（含 Agentic Loop）
│   ├── conversation.py           # 记忆管理（三层 + LLM 摘要归档）
│   ├── database.py               # SQLite 对话持久化
│   ├── emotional_state.py        # 情绪状态 + 关系阶段 + 交互回调
│   ├── heartbeat.py              # 心跳系统（60s tick + LLM 决策 + 注意力管理）
│   ├── skill_manager.py          # Skill 插件加载器
│   ├── tools.py                  # 工具定义与执行器
│   ├── embedding_utils.py        # 向量嵌入 + 余弦相似度
│   ├── tts.py                    # TTS 辅助（文本分块等）
│   ├── diary.py                  # 日记系统
│   └── utils.py                  # 通用工具函数
│
├── frontend/
│   └── src/
│       ├── App.jsx
│       ├── main.jsx
│       ├── components/
│       │   ├── Live2DModel.jsx   # PinkFox 模型渲染 + 表情/口型
│       │   ├── ConfigPanel.jsx   # 配置 UI
│       │   ├── VoiceInput.jsx    # 语音输入按钮
│       │   └── LoadingDots.jsx
│       ├── hooks/
│       │   └── useLipSync.js     # lip sync hook（音频驱动口型）
│       ├── recorder/             # 动捕录制工具（开发工具，#recorder 进入）
│       │   ├── RecorderPage.jsx
│       │   ├── useFaceTracking.js
│       │   ├── motion3Export.js
│       │   └── blendshapeMapping.js
│       ├── debug/                # 调试页面（#debug 进入）
│       │   └── DebugPage.jsx
│       └── api/
│           └── client.js         # 统一 API 请求封装
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

class BaseLLMProvider(ABC):
    @abstractmethod
    async def chat_stream(
        self,
        messages: list[dict],   # [{"role": "user/system/assistant", "content": "..."}]
        temperature: float = 0.7
    ) -> AsyncGenerator[str, None]:
        """流式生成，逐步 yield 文本片段（token 级别）"""

    async def chat(self, messages: list[dict], temperature: float = 0.7) -> str:
        """非流式调用，默认实现：聚合 chat_stream() 结果"""
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

def get_llm() -> BaseLLMProvider: ...   # 读取 ConfigManager，返回当前激活的 LLM Provider
def get_tts() -> BaseTTSProvider: ...   # 读取 ConfigManager，返回当前激活的 TTS Provider
def get_stt() -> BaseSTTProvider: ...   # 读取 ConfigManager，返回当前激活的 STT Provider
```

**规则**：每次调用都重新读取 `ConfigManager`（不缓存），保证配置变更后立即生效（热重载）。`active` 不在注册表中时抛出 `ValueError`。

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

**事件类型**：`generation_id` / `text` / `expression` / `audio` / `done` / `error`

**顺序约定**：
1. `generation_id` 事件标识本次生成（1个）
2. `text` 事件在 LLM 生成时实时发送（多个）
3. `expression` 事件在 LLM 完整回复解析后发送（1个）
4. `audio` 事件在 TTS 合成完成后发送（0或1个，取决于 TTS 是否配置且 `tts_enabled=true`）
5. `done` 事件最后发送

---

## 7. 后端 API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/chat` | SSE 流式对话 |
| GET  | `/api/proactive` | 轮询主动消息（心跳系统生成） |
| POST | `/api/stt` | 语音转文字（返回 JSON） |
| GET  | `/api/history` | 获取对话历史 |
| GET  | `/api/config` | 获取当前配置（脱敏，api_key 返回 `***`） |
| POST | `/api/config` | 更新配置（传入完整或部分 config.json） |

### `/api/chat` 请求体
```json
{ "message": "你好", "tts_enabled": true }
```

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `message` | string | (必填) | 用户消息 |
| `session_id` | string | `"default"` | 会话 ID |
| `tts_enabled` | bool | `true` | 是否启用 TTS 合成，`false` 时跳过 TTS 不返回 `audio` 事件 |

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

### `/api/proactive` 响应

有消息时：
```json
{"message": "哼，你怎么还不来找我说话", "expression": "嘟嘴"}
```

无消息时：
```json
{"message": null}
```

---

## 8. 心跳系统

详见 `specs/16-heartbeat-system.md`。

**核心机制**：60 秒 tick 频率 → 5 道门控过滤 → LLM 自主决策是否发消息。通过 `response_rate` 注意力值做概率门控，避免过度调用 LLM。

**关键组件**：
- `HeartbeatSystem`（`heartbeat.py`）— tick 循环、门控、注意力系统
- `EmotionalState.on_interaction()` — 交互回调，通知心跳系统用户活跃
- `prompts/heartbeat.md` — LLM 决策 prompt，输出 `send_message` 或 `wait`
- `/api/proactive` — 前端轮询取走待发消息

---

## 9. 记忆系统设计

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

## 10. 关键约束

1. **不使用 `.env` 文件**，配置统一由 `config.json` 管理
2. **`config.json` 加入 `.gitignore`**，使用 `config.example.json` 作为模板
3. **业务代码不直接 import 具体 Provider 类**，只通过工厂函数获取
4. **不修改 `prompts/soul.md`**（角色人设独立维护）
5. **Live2D 模型使用 PinkFox**（表情系统基于 PinkFox 参数 key2-key17）
6. **Python 最低版本**：3.10（使用 `match` 语句和 `list[dict]` 泛型语法）
