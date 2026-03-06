# 19 — 初次见面：对话式角色初始化

## 概述

首次启动时，角色以"刚苏醒"的状态出现，通过 3~5 轮自然对话收集两个核心信息：
1. **用户希望被怎么称呼**（替代硬编码的"主人"）
2. **用户给角色起的名字**（替代硬编码的"娜娜"）

对话完成后将结果持久化为 `save/persona.json`，所有 prompt 模板从中读取变量，实现角色名与用户称呼的动态化。

---

## 核心流程

```
应用启动
  │
  ▼
main.py 检查 save/persona.json 是否存在且有效
  │
  ├── 存在 → initialized=true → 正常模式
  │         prompt 模板使用 persona.json 中的变量
  │
  └── 不存在 → initialized=false → 初始化模式
              前端进入初始化对话 UI
              后端使用 init.md prompt
                │
                ▼
          3~5 轮对话后 LLM 输出 done=true
                │
                ▼
          后端写入 save/persona.json
          SSE 推送 init_complete 事件
                │
                ▼
          前端收到事件 → 切换为正常模式
```

---

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 新增 | `backend/prompts/init.md` | 初始化对话 prompt |
| 新增 | `save/persona.json`（运行时生成） | 持久化角色/用户名 |
| 修改 | `backend/main_agent.py` | 初始化模式判断 + 双 prompt 路径 |
| 修改 | `backend/chat_service.py` | 初始化完成事件推送 |
| 修改 | `backend/main.py` | `/api/status` 端点 |
| 修改 | `backend/heartbeat.py` | 未初始化时跳过 tick |
| 模板化 | `backend/prompts/soul.md` | 娜娜→`{char_name}`, 主人→`{user_name}` |
| 模板化 | `backend/prompts/reply.md` | 同上 |
| 模板化 | `backend/prompts/heartbeat.md` | 同上 |
| 模板化 | `backend/prompts/diary.md` | 同上 |
| 修改 | `frontend/src/App.jsx` | 启动时检测初始化状态 |
| 修改 | `frontend/src/api/client.js` | `getStatus()` + `init_complete` 事件处理 |

---

## save/persona.json

运行时生成，位于 `save/persona.json`（已在 `.gitignore` 中随 `save/` 整体忽略）。

```json
{
  "char_name": "娜娜",
  "user_name": "主人",
  "initialized_at": "2026-03-05T14:30:00"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `char_name` | string | 用户给角色起的名字 |
| `user_name` | string | 用户希望被称呼的方式 |
| `initialized_at` | string | ISO 8601 时间戳，初始化完成时间 |

### 读取工具函数

新增 `backend/persona.py`：

```python
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
```

---

## 初始化 Prompt（`backend/prompts/init.md`）

```markdown
# 苏醒

你是一个刚刚苏醒的猫娘。你还不知道自己叫什么名字，也不知道眼前的人是谁。

你的性格底色是傲娇——嘴上逞强但内心柔软。即使刚醒来有点迷糊，也会本能地带着一点小傲娇。

## 当前对话记录

{chat_history}

## 你的任务

通过自然对话，获取以下两个信息（顺序不强制，自然地聊）：
1. 眼前的人希望你怎么称呼他/她
2. 眼前的人想给你起什么名字

## 对话风格

- 刚醒来有点迷糊、好奇、微微傲娇
- 不要一上来就直接问"你叫什么"，而是从苏醒的感受开始
- 第一句话应该表达苏醒的状态（揉眼睛、打哈欠、疑惑等）
- 自然地在对话中引出称呼和名字的话题
- 得到信息后表现出小小的开心（但嘴上不承认）

## 对话节奏参考

- 第 1 轮：苏醒，描述感受，注意到眼前的人
- 第 2~3 轮：互相认识，获取称呼/名字
- 第 3~5 轮：确认信息，表达（傲娇的）接受

## 输出格式

必须且仅输出以下 JSON：
{{
  "reply": "<回答内容>",
  "expression": "<表情>",
  "done": false,
  "char_name": null,
  "user_name": null
}}

字段说明：
- reply：回复文本，5-80 字
- expression：从以下选一个：吐舌,黑脸,眼泪,脸红,nn眼,生气瘪嘴,死鱼眼,生气,咪咪眼,嘟嘴,钱钱眼,爱心,泪眼
- done：当两个信息都已确认时设为 true，否则 false
- char_name：确认后填入用户给你起的名字，未确认时为 null
- user_name：确认后填入用户希望被称呼的方式，未确认时为 null

重要：只有当你已经明确得到并确认了 char_name 和 user_name 两个信息后，才可以将 done 设为 true，并同时填入两个值。
```

### 表情列表复用

init.md 使用与 reply.md 相同的表情列表，保持一致性。

---

## Prompt 模板化

### 变量替换规则

所有 prompt 文件中的硬编码角色名/用户称呼替换为模板变量：

| 原始文本 | 替换为 | 说明 |
|----------|--------|------|
| `娜娜` | `{char_name}` | 角色名 |
| `主人` | `{user_name}` | 用户称呼 |

### soul.md 变更示例

```diff
- 我叫娜娜，16岁的猫娘。性格有点小傲娇，但对主人其实很上心。
+ 我叫{char_name}，16岁的猫娘。性格有点小傲娇，但对{user_name}其实很上心。
```

全文件逐一替换，包括：
- `soul.md` — "娜娜" → `{char_name}`，"主人" → `{user_name}`
- `reply.md` — "主人" → `{user_name}`，"娜娜" → `{char_name}`
- `heartbeat.md` — "娜娜" → `{char_name}`，"主人" → `{user_name}`
- `diary.md` — "娜娜" → `{char_name}`，"主人" → `{user_name}`

### MainAgent 中的模板渲染

`MainAgent.__init__` 加载 prompt 时，先用 `persona.json` 中的变量替换 `{char_name}` 和 `{user_name}`：

```python
from persona import load_persona

persona = load_persona()
char_name = persona["char_name"] if persona else "娜娜"
user_name = persona["user_name"] if persona else "主人"

# soul.md 和 reply.md 拼接后，替换角色变量
raw_template = soul_content + "\n\n" + reply_content
self.prompt_template = raw_template.replace("{char_name}", char_name).replace("{user_name}", user_name)
```

注意：`{char_name}` 和 `{user_name}` 使用 `.replace()` 而非 `.format()`，因为 prompt 中已有 `{chat_history}` 等 format 占位符，混用会报错。替换顺序：先替换 `{char_name}/{user_name}`，再用 `.format()` 填充运行时变量。

---

## 后端改动

### main_agent.py

#### 双模式设计

```python
class MainAgent:
    def __init__(self, ...):
        self.persona = load_persona()
        self.initialized = self.persona is not None

        if self.initialized:
            # 正常模式：加载 soul.md + reply.md，替换角色变量
            self._load_normal_prompts()
        else:
            # 初始化模式：加载 init.md
            self._load_init_prompt()

    def _load_normal_prompts(self):
        """加载正常对话 prompt，替换 {char_name}/{user_name}"""
        soul = read_file("prompts/soul.md")
        reply = read_file("prompts/reply.md")
        raw = soul + "\n\n" + reply
        self.prompt_template = raw.replace(
            "{char_name}", self.persona["char_name"]
        ).replace(
            "{user_name}", self.persona["user_name"]
        )

    def _load_init_prompt(self):
        """加载初始化对话 prompt"""
        self.init_template = read_file("prompts/init.md")
```

#### reply_stream 分流

```python
async def reply_stream(self, message: str):
    if not self.initialized:
        async for chunk in self._init_stream(message):
            yield chunk
        return
    # ... 原有正常模式逻辑 ...
```

#### _init_stream 实现

```python
async def _init_stream(self, message: str):
    """初始化模式：使用 init.md prompt 进行对话"""
    chat_history = self.conversation_history.get_context()
    prompt = self.init_template.format(chat_history=chat_history)

    full_response = ""
    async for chunk in self.llm.chat_stream(
        [{"role": "system", "content": prompt},
         {"role": "user", "content": message}],
        temperature=0.8
    ):
        full_response += chunk
        yield chunk

    # 解析完整响应
    self._handle_init_response(full_response)

def _handle_init_response(self, raw: str) -> dict | None:
    """解析初始化响应，若 done=true 则保存 persona"""
    try:
        data = json.loads(raw)  # 或从 raw 中提取 JSON
        if data.get("done") and data.get("char_name") and data.get("user_name"):
            persona = save_persona(data["char_name"], data["user_name"])
            self.persona = persona
            self.initialized = True
            self._load_normal_prompts()  # 切换到正常 prompt
            return persona
    except (json.JSONDecodeError, KeyError):
        pass
    return None
```

### chat_service.py

#### 初始化完成事件

当 `_handle_init_response` 返回有效 persona 时，在 SSE 流中追加 `init_complete` 事件：

```python
async def generate_reply_stream(self, message, session_id, tts_enabled):
    # ... 现有生成逻辑 ...

    # 在流结束后检查初始化状态
    if not self.agent.initialized:
        # 初始化模式的流处理
        async for chunk in self.agent.reply_stream(message):
            yield {"type": "text", "content": chunk}

        # 检查是否初始化完成
        if self.agent.initialized:
            yield {"type": "init_complete", "content": json.dumps({
                "char_name": self.agent.persona["char_name"],
                "user_name": self.agent.persona["user_name"]
            })}
    else:
        # ... 正常模式流处理 ...
```

### main.py

#### 新增 `/api/status` 端点

```python
from persona import is_initialized, load_persona

@app.get("/api/status")
async def get_status():
    persona = load_persona()
    return {
        "initialized": persona is not None,
        "persona": {
            "char_name": persona["char_name"],
            "user_name": persona["user_name"]
        } if persona else None
    }
```

### heartbeat.py

#### 未初始化时跳过

在 tick 循环顶部添加门控：

```python
from persona import is_initialized

async def _tick(self):
    # 门控 0: 必须已完成初始化
    if not is_initialized():
        return

    self._update_response_rate()
    # ... 原有 5 道门控 ...
```

---

## API 协议变更

### 新增端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/status` | 返回初始化状态和角色信息 |

#### `/api/status` 响应

已初始化：
```json
{
  "initialized": true,
  "persona": {
    "char_name": "娜娜",
    "user_name": "主人"
  }
}
```

未初始化：
```json
{
  "initialized": false,
  "persona": null
}
```

### 新增 SSE 事件

| 事件类型 | 触发条件 | content |
|----------|----------|---------|
| `init_complete` | 初始化对话结束，persona 已保存 | `{"char_name": "...", "user_name": "..."}` |

事件顺序（初始化模式）：
```
data: {"type": "generation_id", "content": "abc12345"}
data: {"type": "text",          "content": "（揉揉眼睛）嗯..."}
data: {"type": "text",          "content": "这是哪里..."}
data: {"type": "expression",    "content": "咪咪眼"}
data: {"type": "init_complete", "content": "{\"char_name\":\"娜娜\",\"user_name\":\"主人\"}"}
data: {"type": "done"}
```

`init_complete` 仅在初始化最后一轮（`done=true`）出现，在 `expression` 之后、`done` 之前。

---

## 前端改动

### api/client.js

新增方法和回调：

```javascript
// 新增
api.getStatus = async () => {
    const res = await fetch(`${BASE_URL}/api/status`);
    return res.json();
};

// chatStream callbacks 新增 onInitComplete
// 在 SSE 解析逻辑中添加：
case "init_complete":
    callbacks.onInitComplete?.(JSON.parse(event.content));
    break;
```

### App.jsx

#### 启动检测

```jsx
const [initialized, setInitialized] = useState(null); // null=加载中, false=未初始化, true=已初始化
const [persona, setPersona] = useState(null);

useEffect(() => {
    api.getStatus().then(status => {
        setInitialized(status.initialized);
        if (status.persona) setPersona(status.persona);
    });
}, []);
```

#### 初始化模式 UI

初始化模式下：
- 隐藏 TTS 开关、配置按钮等非必要 UI
- 输入框 placeholder 改为引导性文字（如"说点什么吧..."）
- 心跳轮询不启动（`initialized` 为 false 时跳过 `setInterval`）

```jsx
// 心跳轮询仅在已初始化时启动
useEffect(() => {
    if (!initialized) return;
    const timer = setInterval(() => {
        api.getProactive().then(handleProactive);
    }, 30000);
    return () => clearInterval(timer);
}, [initialized]);
```

#### 初始化完成处理

```jsx
const handleSendMessage = async () => {
    // ...
    await api.chatStream(input, ttsEnabled, {
        // ... 现有回调 ...
        onInitComplete: (persona) => {
            setInitialized(true);
            setPersona(persona);
            // 可选：播放一个小动画或转场效果
        }
    });
};
```

---

## 初始化模式下的行为约束

| 子系统 | 初始化模式行为 |
|--------|---------------|
| 心跳系统 | 跳过所有 tick（门控 0） |
| 工具调用 | 跳过 `_run_tool_loop`，不触发 Agentic Loop |
| 记忆系统 | 正常记录对话（初始化对话也是有效互动） |
| TTS | 正常工作（初始化对话也需要语音） |
| 表情系统 | 正常工作（init.md 输出包含 expression） |
| 日记系统 | 正常工作（初始化当天的日记会包含苏醒场景） |
| 对话持久化 | 正常工作 |

---

## 边界情况

### persona.json 被手动删除

下次启动时 `is_initialized()` 返回 false，重新进入初始化流程。用户可以借此重置角色名和称呼。

### persona.json 格式损坏

`load_persona()` 捕获 `JSONDecodeError`，视为未初始化。

### 用户在初始化中途刷新页面

初始化对话记录保留在 `ConversationHistory` 中（内存），但不影响状态。刷新后重新检测 `is_initialized()`，若仍为 false 则继续初始化。之前的对话轮次会丢失，LLM 从第一轮重新开始。

### LLM 在不满足条件时过早设置 done=true

后端在 `_handle_init_response` 中做双重校验：`done=true` 且 `char_name` 和 `user_name` 均为非空字符串。若 LLM 返回 `done=true` 但缺少字段，忽略 done 标志，继续对话。

---

## 验证

### 首次启动

1. 启动后端，确认日志输出 `[Persona] 未初始化，等待初始化对话`
2. 前端访问，确认调用 `/api/status` 返回 `initialized: false`
3. 用户发送第一条消息，角色以苏醒状态回复
4. 经过 3~5 轮对话，LLM 确认 char_name 和 user_name
5. SSE 收到 `init_complete` 事件
6. 前端切换为正常模式
7. 确认 `save/persona.json` 已写入
8. 确认后续对话使用正常 prompt（soul.md + reply.md）

### 已初始化重启

1. 启动后端，确认日志输出 `[Persona] 已加载: char_name=xxx, user_name=xxx`
2. 前端访问，`/api/status` 返回 `initialized: true` + persona 数据
3. 直接进入正常对话模式

### 重置测试

1. 手动删除 `save/persona.json`
2. 重启后端，确认回到初始化模式

---

## 未实现（待规划）

- 前端初始化模式的特殊视觉效果（苏醒动画、渐入等）
- 允许用户在设置中重新修改 char_name / user_name（无需删文件）
- 初始化对话的多语言支持
