# 02-llm-providers — LLM 多家接入

**Status: ✅ Implemented** (2026-03-04)

## 背景与目标

实现所有 LLM Provider 的具体类。当前代码在 `llm.py` 中硬编码了模型名和 URL，无法切换。

本 spec 实现：
- `OpenAICompatibleProvider`：覆盖 8 家兼容 OpenAI 格式的服务（deepseek、qwen、doubao、glm、minimax、openai、ollama、lmstudio）

---

## 文件边界

### 新建文件
- `backend/providers/llm/openai_compatible.py`

### 修改文件
- `backend/providers/__init__.py`：补全 `get_llm()` 工厂函数（01 spec 创建了框架，本 spec 填入具体实现）
- `backend/chat_service.py`：将 `LLMService` 替换为 `get_llm()`

### 不得修改
- `backend/llm.py`（保留兼容，但 chat_service 不再使用它）
- `backend/providers/llm/base.py`

---

## 依赖

- `01-provider-framework`（需要 `BaseLLMProvider`、`ConfigManager`）

---

## 各 Provider 的 base_url 预置值

| provider key | base_url |
|---|---|
| deepseek | `https://api.deepseek.com/v1` |
| qwen | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| doubao | `https://ark.cn-beijing.volces.com/api/v3` |
| glm | `https://open.bigmodel.cn/api/paas/v4` |
| minimax | `https://api.minimax.chat/v1` |
| openai | `https://api.openai.com/v1` |
| ollama | `http://localhost:11434/v1` |
| lmstudio | `http://localhost:1234/v1` |

---

## 实现要求

### `openai_compatible.py`

```python
class OpenAICompatibleProvider(BaseLLMProvider):
    def __init__(self, provider_name: str, config: dict):
        self.provider_name = provider_name
        self.api_key = config.get("api_key", "")
        self.model = config["model"]
        self.base_url = config["base_url"]
```

**流式实现要求：**

1. 使用 `httpx.AsyncClient` 发起请求，**不使用** `openai` Python SDK（避免版本冲突）
2. 请求体包含 `"stream": true`
3. 解析 `text/event-stream` 响应，逐行处理 `data:` 前缀的 JSON
4. 跳过 `data: [DONE]` 行
5. 提取 `choices[0].delta.content`，非空时 yield
6. 超时设置：`connect=10, read=120`
7. SSL 验证：`verify=False`（兼容本地服务）
8. 重试：失败时最多重试 2 次，每次间隔 1 秒
9. 错误时 yield 空字符串并打印错误，不抛出异常（保证流不中断）

**`is_configured()` 逻辑：**
- ollama 和 lmstudio：始终返回 `True`（本地服务不需要 api_key）
- 其他：`return bool(self.api_key)`

### `chat_service.py` 修改

1. 移除对 `LLMService` 的导入和实例化
2. 在需要调用 LLM 时，使用 `get_llm()` 获取实例
3. 将原来的非流式调用改为流式聚合（调用 `await provider.chat(messages)`）
4. messages 格式：`[{"role": "user", "content": prompt}]`（保持现有单轮 prompt 方式不变）

---

## 约束

- 不在 Provider 类中处理 JSON 解析（JSON 解析留在 `main_agent.py` 中）
- 不改变 `main_agent.py` 的调用接口，只改 `chat_service.py` 内部实现
- `openai_compatible.py` 中不 import `openai` SDK

---

## 验收标准

- [x] 使用 deepseek provider 能正常获取流式响应
- [x] 切换 config.json 中 `llm.active` 为 `ollama`，重启后自动使用 Ollama
- [x] `is_configured()` 对 ollama/lmstudio 返回 True，对未填 api_key 的云服务返回 False
- [x] 流式中途出错不会导致整个请求失败，只是提前结束
