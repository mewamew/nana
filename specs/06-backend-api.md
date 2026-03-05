# 06-backend-api — 后端 API 改造（SSE 流式）

**Status: ✅ Implemented** (2026-03-04)

## 背景与目标

当前 `/api/chat` 是阻塞式 POST，等待完整回复后一次性返回，用户需要等待 2-5 秒才能看到内容。

本 spec 将其改造为 **SSE（Server-Sent Events）流式响应**，同时新增：
- `/api/config` 配置读写接口
- `/api/stt` 端点（与 04 spec 协作，04 创建 Provider，本 spec 创建路由）

---

## 文件边界

### 修改文件
- `backend/main.py`：改造 `/api/chat` 为 SSE，新增 `/api/config`
- `backend/chat_service.py`：改造为流式生成
- `backend/main_agent.py`：改造为流式生成

### 不得修改
- `backend/providers/` 目录下的任何文件
- `backend/conversation.py`（由 05 spec 修改）
- `backend/prompts/reply.txt`

---

## 依赖

- `01-provider-framework`
- `02-llm-providers`
- `03-tts-providers`
- `04-stt-providers`
- `05-memory-upgrade`

---

## SSE 响应格式（严格遵守 ARCHITECTURE.md 定义）

```
data: {"type": "text",       "content": "文字片段"}
data: {"type": "expression", "content": "脸红"}
data: {"type": "audio",      "content": "<base64_mp3>"}
data: {"type": "done"}
data: {"type": "error",      "content": "错误信息"}
```

---

## 实现要求

### `main.py` 改造

**`/api/chat` 端点：**

```python
from fastapi.responses import StreamingResponse
import json

class ChatRequest(BaseModel):
    message: str
    session_id: Optional[str] = "default"
    tts_enabled: Optional[bool] = True  # 前端 TTS 开关，False 时跳过 TTS 合成

@app.post("/api/chat")
async def chat(request: ChatRequest):
    async def event_stream():
        try:
            async for event in chat_service.generate_reply_stream(
                request.message,
                request.session_id or "default",
                tts_enabled=request.tts_enabled,
            ):
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        except Exception as e:
            error_event = {"type": "error", "content": str(e)}
            yield f"data: {json.dumps(error_event, ensure_ascii=False)}\n\n"
        finally:
            done_event = {"type": "done"}
            yield f"data: {json.dumps(done_event, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no"
        }
    )
```

**`/api/config` 端点：**

```python
@app.get("/api/config")
async def get_config():
    return JSONResponse(content=ConfigManager.get_masked())

@app.post("/api/config")
async def update_config(body: dict):
    updated = ConfigManager.update(body)
    return JSONResponse(content=ConfigManager.get_masked())
```

### `chat_service.py` 改造

将 `generate_reply()` 改为 `generate_reply_stream()`，返回 `AsyncGenerator`：

```python
async def generate_reply_stream(
    self, message: str, session_id: str = "default", *, tts_enabled: bool = True
) -> AsyncGenerator[dict, None]:
    """
    流式生成回复，按事件类型 yield 字典
    """
    # 1. 获取 LLM 流式回复（文字）
    # 边收集文字边 yield text 事件
    full_text = ""
    async for chunk in main_agent.reply_stream(message):
        if chunk:
            full_text += chunk
            yield {"type": "text", "content": chunk}

    # 2. 解析表情（从完整回复中提取）
    expression = main_agent.extract_expression(full_text)
    if expression:
        yield {"type": "expression", "content": expression}

    # 3. 合成语音（如果 TTS 已配置且前端启用）
    if tts_enabled:
        tts = get_tts()
        if tts.is_configured():
            clean_text = main_agent.extract_reply_text(full_text)
            audio_bytes = await tts.synthesize(clean_text)
            if audio_bytes:
                import base64
                audio_b64 = base64.b64encode(audio_bytes).decode("ascii")
                yield {"type": "audio", "content": audio_b64}
```

### `main_agent.py` 改造

**新增 `reply_stream()` 方法：**

```python
async def reply_stream(self, message: str) -> AsyncGenerator[str, None]:
    """
    流式生成原始 LLM 输出（JSON 格式的字符串片段）
    """
    self._log_conversation("user", message)
    memory_text = self._get_relevant_memories(message)
    context = self.conversation_history.get_context()

    prompt = self.prompt_template.format(
        chat_history=context,
        user_message=message,
        memory=memory_text,
        user_info=self.user_info
    )

    messages = [{"role": "user", "content": prompt}]
    llm = get_llm()

    full_response = ""
    async for chunk in llm.chat_stream(messages):
        full_response += chunk
        yield chunk

    # 流结束后处理副作用
    if full_response:
        await self._handle_full_response(message, full_response)
```

**新增 `extract_expression()` 和 `extract_reply_text()` 方法：**

```python
def extract_expression(self, raw_response: str) -> str:
    """从 LLM 原始输出中提取表情字段"""
    try:
        data = self._parse_json(raw_response)
        return data.get("expression", "")
    except Exception:
        return ""

def extract_reply_text(self, raw_response: str) -> str:
    """从 LLM 原始输出中提取纯文字回复（用于 TTS）"""
    try:
        data = self._parse_json(raw_response)
        return data.get("reply", raw_response)
    except Exception:
        return raw_response

def _parse_json(self, raw: str) -> dict:
    """复用原有的 JSON 解析逻辑"""
    # 从原 llm.py 的 _parse_json_response 迁移
    ...

async def _handle_full_response(self, message: str, raw_response: str):
    """流结束后：更新 user_info、记录对话历史"""
    try:
        data = self._parse_json(raw_response)
        reply_text = data.get("reply", "")

        if "user_info" in data and data["user_info"]:
            self._save_user_info(data["user_info"])
            self.user_info = data["user_info"]

        if reply_text:
            self._log_conversation("assistant", reply_text)
            await self.conversation_history.add_dialog(message, reply_text)
    except Exception as e:
        print(f"[Agent] 处理回复失败: {e}")
```

---

## 前端影响（本 spec 不修改前端，仅说明接口变化）

前端需要将原有的 `fetch + response.json()` 改为 SSE 读取（由 `07-frontend` spec 处理）。

---

## 约束

- 旧的 `reply()` 方法可以保留（不删除），但 `chat_service` 不再使用它
- SSE 响应中的 JSON 必须用 `ensure_ascii=False`（保证中文不被转义）
- `done` 事件必须在 finally 中发送，保证无论是否出错都会发送

---

## 验收标准

- [ ] `curl -N -X POST http://localhost:8000/api/chat -H "Content-Type: application/json" -d '{"message":"你好"}'` 能看到 SSE 流式输出
- [ ] `GET /api/config` 返回脱敏配置（api_key 显示 `***`）
- [ ] `POST /api/config` 能更新 `llm.active` 字段
- [ ] 流式响应中 text 事件先于 expression 和 audio 到达
- [ ] LLM 出错时能收到 error 事件，不挂起连接
- [ ] done 事件始终是最后一个事件
