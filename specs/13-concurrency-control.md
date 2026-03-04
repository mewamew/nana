# 13-concurrency-control — 消息队列与并发控制

**Status: ✅ Implemented**

## 背景与目标

当前系统在并发场景下存在以下问题：

1. **请求重叠**：用户快速连续发送多条消息时，多个 LLM 请求并行执行，回复交错混乱
2. **无法取消**：用户发出消息后无法中止，即使发现输错也必须等 LLM 生成完毕
3. **状态竞争**：多个并行请求同时调用 `add_dialog()`，可能导致 ConversationHistory 状态不一致

本 spec 引入 **generation ID 机制 + 请求锁**：
- 后端：session 级别 asyncio.Lock 保证同一时刻只有一个请求在处理
- 前端：generation ID 跟踪 + AbortController 取消旧请求
- SSE 协议新增 `generation_id` 事件类型

---

## 文件边界

### 修改文件
- `backend/chat_service.py`：session-level asyncio.Lock + generation ID
- `backend/main.py`：传递 generation_id
- `frontend/src/App.jsx`：generation ID 跟踪 + AbortController
- `frontend/src/api/client.js`：支持 abort signal + generation_id 事件

### 不得修改
- `backend/main_agent.py`
- `backend/conversation.py`
- `backend/providers/`
- `backend/prompts/`
- `frontend/src/components/Live2DModel.jsx`

---

## 依赖

- `12-conversation-persistence`（ChatService 架构，需要 db 实例已集成）

---

## 接口契约

### SSE 协议变更

新增 `generation_id` 事件类型，作为每次回复流的第一个事件：

```
data: {"type": "generation_id", "content": "abc123"}

data: {"type": "text", "content": "..."}
data: {"type": "text", "content": "..."}
data: {"type": "expression", "content": "脸红"}
data: {"type": "audio", "content": "base64..."}
data: {"type": "done"}
```

### 后端 ChatRequest 变更

```python
class ChatRequest(BaseModel):
    message: str
    session_id: Optional[str] = "default"
    # generation_id 不由前端传入，由后端生成
```

### 前端 chatStream 接口变更

```javascript
chatStream(message, callbacks = {}, options = {}) {
  // options.signal: AbortController.signal，用于取消请求
  // callbacks 新增:
  //   onGenerationId: (id) => void  — 收到 generation_id 时回调
}
```

---

## 实现要求

### `backend/chat_service.py` 修改

```python
import asyncio
import uuid

class ChatService:
    def __init__(self) -> None:
        self.db = Database()
        self.llm_adapter = LLMProviderAdapter()
        self.conversation_history = ConversationHistory(
            max_turns=20,
            llm_provider=get_llm(),
            db=self.db
        )
        self.main_agent = MainAgent(self.llm_adapter, self.conversation_history)

        # 并发控制
        self._locks: dict[str, asyncio.Lock] = {}       # session_id → Lock
        self._active_generation: dict[str, str] = {}     # session_id → 当前 generation_id

    def _get_lock(self, session_id: str) -> asyncio.Lock:
        if session_id not in self._locks:
            self._locks[session_id] = asyncio.Lock()
        return self._locks[session_id]

    async def generate_reply_stream(
        self, message: str, session_id: str = "default"
    ) -> AsyncGenerator[dict[str, str], None]:
        """流式生成回复，带并发控制"""
        generation_id = str(uuid.uuid4())[:8]
        lock = self._get_lock(session_id)

        # 标记新请求为活跃，旧请求将检测到 generation_id 变化后停止
        self._active_generation[session_id] = generation_id

        async with lock:
            # 获取锁后，检查自己是否仍然是最新请求
            if self._active_generation.get(session_id) != generation_id:
                return  # 已被更新的请求取代，静默退出

            # 发送 generation_id
            yield {"type": "generation_id", "content": generation_id}

            chunks: list[str] = []
            expression_sent = False

            async for chunk in self.main_agent.reply_stream(message):
                # 检查是否被新请求取代
                if self._active_generation.get(session_id) != generation_id:
                    return

                if not chunk:
                    continue
                chunks.append(chunk)
                yield {"type": "text", "content": chunk}

            # 后续处理（expression、audio）...
            # （复用现有逻辑）
```

### `backend/main.py` 修改

```python
@app.post("/api/chat")
async def chat(request: ChatRequest) -> StreamingResponse:
    async def event_stream() -> AsyncGenerator[str, None]:
        try:
            async for event in chat_service.generate_reply_stream(
                request.message, request.session_id or "default"
            ):
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        except Exception as e:
            error_event = {"type": "error", "content": str(e)}
            yield f"data: {json.dumps(error_event, ensure_ascii=False)}\n\n"
        finally:
            yield f"data: {json.dumps({'type': 'done'}, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
```

### `frontend/src/api/client.js` 修改

```javascript
chatStream(message, callbacks = {}, options = {}) {
  const { onText, onExpression, onAudio, onDone, onError, onGenerationId } = callbacks
  const { signal } = options  // AbortController.signal

  const run = async () => {
    const response = await fetch(`${BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, session_id: "default" }),
      signal,  // 传入 abort signal
    })

    // ... 现有 SSE 解析逻辑 ...
    // switch 中新增:
    //   case "generation_id":
    //     onGenerationId?.(parsed.content)
    //     break
  }

  run().catch((err) => {
    if (err.name === "AbortError") return  // 主动取消，不报错
    onError?.(err.message)
  })
}
```

### `frontend/src/App.jsx` 修改

```javascript
function App() {
  // ... 现有 state ...
  const abortRef = useRef(null)           // 当前请求的 AbortController
  const generationRef = useRef(null)      // 当前 generation_id

  const handleSendMessage = (directMessage) => {
    const text = directMessage ?? input
    if (!text.trim()) return
    if (!directMessage) setInput('')

    // 取消上一个请求
    if (abortRef.current) {
      abortRef.current.abort()
    }
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    setMessages(prev => [...prev, { type: 'user', content: text }])

    let rawAccumulator = ''

    api.chatStream(text, {
      onGenerationId: (id) => {
        generationRef.current = id
      },
      onText: (chunk) => {
        rawAccumulator += chunk
        const replyText = extractReply(rawAccumulator)
        if (replyText !== null) {
          setMessages(prev => {
            const last = prev[prev.length - 1]
            if (last?.type === 'assistant') {
              return [...prev.slice(0, -1), { type: 'assistant', content: replyText }]
            }
            return [...prev, { type: 'assistant', content: replyText }]
          })
        }
      },
      onExpression: (expression) => {
        if (live2dRef.current) live2dRef.current.showExpression(expression)
      },
      onAudio: (audioBase64) => {
        playAudio(audioBase64)
      },
      onDone: () => {
        // ... 现有 onDone 逻辑 ...
        setLoading(false)
        abortRef.current = null
      },
      onError: (msg) => {
        console.error('Chat error:', msg)
        setLoading(false)
        abortRef.current = null
      },
    }, { signal: controller.signal })
  }
  // ...
}
```

---

## 并发场景分析

### 场景 1：用户快速连续发送 A、B

```
1. 用户发送 A → 后端开始处理 A（获取 lock）
2. 用户快速发送 B → 前端 abort A 的请求
3. 后端：
   - A 的 lock 仍被持有
   - B 等待 lock
   - A 的 HTTP 连接被前端 abort → A 的 generator 结束
   - lock 释放 → B 获取 lock → 开始处理
4. 结果：只有 B 的回复被完整展示
```

### 场景 2：A 正在流式输出，用户发送 B

```
1. A 正在输出 → generation_id = "aaa"
2. 用户发送 B → 前端 abort A → 后端 active_generation 更新为 "bbb"
3. A 在下一次 yield 前检查 generation_id，发现不匹配 → 静默退出 → lock 释放
4. B 获取 lock → 开始处理
5. 结果：A 中止，B 正常输出
```

---

## 关键设计决策

| 问题 | 决策 |
|------|------|
| 锁的粒度 | session 级别（同一 session 串行，不同 session 互不影响） |
| generation_id 由谁生成 | 后端生成（避免前端伪造） |
| 旧请求如何中止 | 双重机制：前端 AbortController + 后端 generation_id 检查 |
| AbortError 是否报错 | 否，前端捕获后静默处理 |
| 锁的创建时机 | 懒创建，按需为每个 session 分配 |
| `_locks` 内存管理 | 当前不清理（session 数量有限），未来可加 LRU |
| `add_dialog` 是否受影响 | 不受影响，锁保证同一时刻只有一个请求调用 `add_dialog` |

---

## 约束

- 不引入新 pip/npm 依赖
- `asyncio.Lock` 是标准库，不引入分布式锁
- 不修改 `MainAgent` 的接口（并发控制在 `ChatService` 层处理）
- 前端 `AbortController` 兼容所有现代浏览器
- generation_id 格式为 UUID 前 8 位，足够在 session 内唯一

---

## 验收标准

- [ ] 用户快速连续发送多条消息时，只有最后一条被完整处理和展示
- [ ] 正在生成的回复被新消息打断时，旧回复流正确中止
- [ ] SSE 流的第一个事件为 `generation_id` 类型
- [ ] 前端 `AbortController` 正确取消旧请求，无报错
- [ ] 后端 `asyncio.Lock` 保证同一 session 同时只处理一个请求
- [ ] 被取消的请求不会调用 `add_dialog()`，不会污染对话历史
- [ ] 不引入任何新依赖
- [ ] 单用户正常对话（非并发）行为无变化
