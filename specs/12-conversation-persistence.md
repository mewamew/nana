# 12-conversation-persistence — 对话持久化

**Status: ✅ Implemented (2026-03-04)**

## 背景与目标

当前对话历史仅存在内存中，后端重启后所有对话丢失。用户看到的消息列表也是前端 state，刷新页面即清空。

本 spec 引入 **SQLite 持久化**：
1. 后端每轮对话写入 SQLite
2. 后端启动时从 SQLite 恢复最近 N 轮到内存
3. 前端启动时从 API 加载历史消息，恢复聊天界面

使用 Python 内置 `sqlite3`，不引入新依赖。

---

## 文件边界

### 新建文件
- `backend/database.py`：SQLite 数据库管理

### 修改文件
- `backend/conversation.py`：启动时从 SQLite 恢复 turns，`add_dialog` 同步写入
- `backend/main.py`：新增 `/api/history` 端点
- `backend/chat_service.py`：按 session 管理独立 ConversationHistory
- `frontend/src/App.jsx`：启动时从 API 加载历史消息
- `frontend/src/api/client.js`：新增 `getHistory()` 方法

### 不得修改
- `backend/main_agent.py`
- `backend/providers/`
- `backend/prompts/`
- `frontend/src/components/Live2DModel.jsx`

---

## 依赖

- `05-memory-upgrade`（ConversationHistory 架构，已实现）
- `06-backend-api`（API 端点规范，已实现）
- `07-frontend`（前端组件架构，已实现）

---

## 接口契约

### `database.py`

```python
# backend/database.py
import sqlite3
import os
from datetime import datetime


class Database:
    DB_PATH = os.path.join(os.path.dirname(__file__), "..", "save", "nana.db")

    def __init__(self):
        os.makedirs(os.path.dirname(self.DB_PATH), exist_ok=True)
        self.conn = sqlite3.connect(self.DB_PATH, check_same_thread=False)
        self._init_tables()

    def _init_tables(self) -> None:
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL DEFAULT 'default',
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        """)
        self.conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_messages_session
            ON messages(session_id, created_at)
        """)
        self.conn.commit()

    def save_dialog(self, session_id: str, user_msg: str, assistant_msg: str) -> None:
        """保存一轮对话（user + assistant）"""
        now = datetime.now().isoformat()
        self.conn.executemany(
            "INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)",
            [
                (session_id, "user", user_msg, now),
                (session_id, "assistant", assistant_msg, now),
            ]
        )
        self.conn.commit()

    def get_recent_dialogs(self, session_id: str, limit: int = 20) -> list[dict]:
        """
        获取最近 N 轮对话（按时间正序）。
        返回: [{"role": "user", "content": "..."}, {"role": "assistant", "content": "..."}, ...]
        limit 指轮数（每轮 = user + assistant），实际查询 limit * 2 条消息。
        """
        cursor = self.conn.execute(
            """
            SELECT role, content FROM (
                SELECT role, content, created_at FROM messages
                WHERE session_id = ?
                ORDER BY id DESC
                LIMIT ?
            ) sub ORDER BY created_at ASC, id ASC
            """,
            (session_id, limit * 2)
        )
        return [{"role": row[0], "content": row[1]} for row in cursor.fetchall()]

    def get_history_for_frontend(self, session_id: str, limit: int = 50) -> list[dict]:
        """
        获取前端展示用的历史消息。
        返回: [{"type": "user", "content": "..."}, {"type": "assistant", "content": "..."}, ...]
        """
        cursor = self.conn.execute(
            """
            SELECT role, content FROM (
                SELECT role, content, id FROM messages
                WHERE session_id = ?
                ORDER BY id DESC
                LIMIT ?
            ) sub ORDER BY id ASC
            """,
            (session_id, limit * 2)
        )
        return [{"type": row[0], "content": row[1]} for row in cursor.fetchall()]

    def close(self) -> None:
        self.conn.close()
```

### `/api/history` 端点

```python
# backend/main.py 新增
@app.get("/api/history")
async def get_history(session_id: str = "default", limit: int = 50) -> JSONResponse:
    """获取历史消息（前端展示用）"""
    messages = db.get_history_for_frontend(session_id, limit)
    return JSONResponse(content={"messages": messages})
```

### 前端 API

```javascript
// frontend/src/api/client.js 新增
async getHistory(sessionId = "default", limit = 50) {
  const res = await fetch(`${BASE_URL}/api/history?session_id=${sessionId}&limit=${limit}`)
  if (!res.ok) {
    throw new Error(await readError(res))
  }
  return res.json() // { messages: [{ type, content }, ...] }
}
```

---

## 实现要求

### `database.py`

1. 数据库文件路径：`save/nana.db`（`save/` 已 gitignore）
2. `check_same_thread=False`：FastAPI 异步上下文中可能跨线程访问
3. 表结构简洁，仅一张 `messages` 表
4. `session_id` 字段为未来多会话预留，当前默认 `"default"`

### `conversation.py` 修改

#### 新增 `db` 参数

```python
def __init__(self, max_turns: int = 20, llm_provider=None, db=None):
    # ... 现有代码 ...
    self.db = db

    # 从 SQLite 恢复最近对话到内存
    if self.db:
        self._restore_from_db()
```

#### `_restore_from_db()` 方法

```python
def _restore_from_db(self, session_id: str = "default") -> None:
    """从 SQLite 恢复最近对话到内存 turns"""
    try:
        dialogs = self.db.get_recent_dialogs(session_id, self.max_turns)
        # 按 user/assistant 配对组装为 ConversationTurn
        i = 0
        while i < len(dialogs) - 1:
            if dialogs[i]["role"] == "user" and dialogs[i + 1]["role"] == "assistant":
                self.turns.append(ConversationTurn(
                    dialogs[i]["content"],
                    dialogs[i + 1]["content"]
                ))
                i += 2
            else:
                i += 1
        print(f"[Memory] 从数据库恢复了 {len(self.turns)} 轮对话")
    except Exception as e:
        print(f"[Memory] 从数据库恢复失败: {e}")
```

#### `add_dialog()` 增加持久化

```python
async def add_dialog(self, user_message: str, assistant_message: str):
    """添加新对话，持久化到 SQLite，并在需要时触发自动归档"""
    turn = ConversationTurn(user_message, assistant_message)
    self.turns.append(turn)

    # 持久化到 SQLite
    if self.db:
        try:
            self.db.save_dialog("default", user_message, assistant_message)
        except Exception as e:
            print(f"[Memory] 持久化失败: {e}")

    # 当对话数量达到最大值时，自动归档一半的对话
    if len(self.turns) >= self.max_turns:
        await self._auto_archive()
```

### `chat_service.py` 修改

```python
from database import Database

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
```

### `main.py` 修改

```python
# 在 chat_service 初始化之后，使用其 db 实例
@app.get("/api/history")
async def get_history(session_id: str = "default", limit: int = 50) -> JSONResponse:
    messages = chat_service.db.get_history_for_frontend(session_id, limit)
    return JSONResponse(content={"messages": messages})
```

### `frontend/src/api/client.js` 新增

```javascript
async getHistory(sessionId = "default", limit = 50) {
  const res = await fetch(
    `${BASE_URL}/api/history?session_id=${sessionId}&limit=${limit}`
  )
  if (!res.ok) {
    throw new Error(await readError(res))
  }
  return res.json()
},
```

### `frontend/src/App.jsx` 修改

在 `App` 组件中增加启动时加载历史消息：

```javascript
// 启动时加载历史消息
useEffect(() => {
  api.getHistory().then(data => {
    if (data.messages && data.messages.length > 0) {
      // 前端 messages 的 assistant 消息只存 reply 文本
      // 数据库中存的也是 extract_reply_text 后的纯文本
      setMessages(data.messages)
    }
  }).catch(err => {
    console.error('加载历史消息失败:', err)
  })
}, [])
```

---

## 关于 assistant 消息内容

当前 `add_dialog()` 由 `main_agent.py` 调用，传入的 `assistant_message` 是 LLM 原始输出（含 JSON 格式的 reply/expression/user_info 等字段）。持久化到 SQLite 的也是这个原始文本。

前端 `getHistory()` 返回的 assistant 消息内容需要与前端实时流式解析的 `extractReply()` 逻辑一致。有两种方案：

**方案 A（推荐）**：后端 `save_dialog` 时存储 `extract_reply_text()` 后的纯文本
- 优点：前端无需重新解析
- 修改：`main_agent.py` 的 `_handle_full_response()` 中传给 `add_dialog` 的是纯文本

**方案 B**：存原始文本，前端加载时用 `extractReply()` 解析
- 优点：保留原始数据
- 缺点：前端需要对历史消息做二次解析

实施时选择方案 A，在 `main_agent.py` 调用 `add_dialog` 时传入纯 reply 文本。

---

## 关键设计决策

| 问题 | 决策 |
|------|------|
| 存储方案 | SQLite（Python 内置，无新依赖） |
| 数据库文件位置 | `save/nana.db`（已 gitignore） |
| `check_same_thread` | False（FastAPI 异步上下文需要） |
| 单表还是多表 | 单表 `messages`，session_id 字段区分会话 |
| 恢复策略 | 启动时恢复最近 N 轮到内存 turns |
| `add_dialog` 失败策略 | 捕获异常打印日志，不阻塞内存操作 |
| 前端加载条数 | 默认 50 轮（100 条消息），可通过参数调整 |
| 前端消息格式 | `{ type: "user"/"assistant", content: "..." }`，复用现有格式 |

---

## 约束

- 不引入任何新 pip 依赖（`sqlite3` 为 Python 内置）
- 不引入新 npm 依赖
- `save/nana.db` 不提交到 git（`save/` 已在 `.gitignore`）
- Database 写入失败不得影响内存中的 ConversationHistory 正常运作
- `/api/history` 返回格式与前端 `messages` state 兼容

---

## 验收标准

- [ ] 后端启动时自动创建 `save/nana.db` 和 `messages` 表
- [ ] 每轮对话自动写入 SQLite
- [ ] 后端重启后，ConversationHistory 从 SQLite 恢复最近对话
- [ ] 前端刷新页面后，自动从 `/api/history` 加载历史消息并显示
- [ ] SQLite 写入失败时，内存中的 ConversationHistory 不受影响
- [ ] 不引入任何新依赖
- [ ] `/api/history` 端点返回正确格式，前端能直接使用
