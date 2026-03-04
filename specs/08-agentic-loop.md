# 08-agentic-loop — Agentic Loop（工具调用）

**Status: ✅ Implemented** (2026-03-04)

## 背景与目标

原 `MainAgent` 是单次 LLM 调用模式，无法主动获取外部信息（如当前时间）。

本 spec 为对话流程加入 **Agentic Loop**：LLM 在生成最终回复前，可主动决策并调用工具，基于工具结果给出更准确的回复。

对外接口（`reply_stream`、`chat_service.py`、前端）**完全不变**。

---

## 文件边界

### 新增文件
- `backend/tools.py`：工具定义与执行器
- `backend/prompts/tool_decision.txt`：工具决策阶段的 Prompt 模板

### 修改文件
- `backend/main_agent.py`：加入 `_run_tool_loop`、`_parse_decision`；`reply_stream` 和 `reply` 均接入工具循环
- `backend/prompts/reply.txt`：新增 `{tool_results}` 占位符

### 不得修改
- `backend/chat_service.py`
- `backend/main.py`
- `backend/conversation.py`
- `backend/providers/`

---

## 架构：两阶段分离

```
用户消息
    ↓
[阶段1: 工具决策循环] ── 非流式，最多 3 次
    LLM 决定是否调用工具
    → 有工具：执行 → 收集结果 → 继续循环
    → 无工具 / 同工具已调过：退出循环
    ↓
[阶段2: 流式最终回复] ── 与之前完全相同
    工具结果注入 {tool_results} 占位符
    → 流式输出给前端
```

---

## 工具定义（`backend/tools.py`）

### 当前可用工具

| 工具名 | 描述 | 参数 |
|--------|------|------|
| `get_datetime` | 获取当前日期和时间 | 无 |
| `search_memory` | 在长期记忆中搜索相关历史 | `query: str` |

### 关键实现

```python
TOOL_DEFINITIONS = [
    {"name": "get_datetime", "description": "...", "parameters": {}},
    {"name": "search_memory", "description": "...", "parameters": {"query": "搜索关键词"}},
]

def render_tool_definitions() -> str:
    """渲染为 Prompt 文本，填入 tool_decision.txt 的 {tool_definitions}"""

class ToolExecutor:
    def __init__(self, conversation_history): ...
    async def execute(self, tool_name, args) -> str: ...
    def _get_datetime(self) -> str:
        # 返回 "2026年03月04日 星期三 14:30:00"
    def _search_memory(self, query) -> str:
        # 复用 conversation_history.retrieve()，无结果返回 "未找到相关记忆。"
```

### 新增工具

在 `TOOL_DEFINITIONS` 中添加新条目，并在 `ToolExecutor.execute()` 的 if/elif 分支中实现即可。

---

## 工具决策 Prompt（`backend/prompts/tool_decision.txt`）

变量：`{tool_definitions}`、`{chat_history}`、`{user_message}`、`{previous_tool_results}`

**输出格式**（LLM 必须输出以下三种之一）：
```json
{"action": "call_tool", "tool": "get_datetime", "args": {}}
{"action": "call_tool", "tool": "search_memory", "args": {"query": "关键词"}}
{"action": "reply_directly"}
```

---

## 工具循环（`main_agent._run_tool_loop`）

```python
MAX_TOOL_CALLS = 3

async def _run_tool_loop(self, message: str) -> str:
    executor = ToolExecutor(self.conversation_history)
    context = self.conversation_history.get_context()
    collected: list[str] = []
    called_tools: set[str] = set()  # 同一工具不重复调用

    for _ in range(MAX_TOOL_CALLS):
        previous = "\n".join(collected) if collected else "无"
        messages = self._build_decision_messages(message, context, previous)
        llm = get_llm()
        try:
            raw = await llm.chat(messages, temperature=0.3)
            decision = self._parse_decision(raw)
        except Exception as e:
            break  # 静默降级

        if decision.get("action") != "call_tool":
            break

        tool_name = decision.get("tool", "")
        if tool_name in called_tools:
            break
        called_tools.add(tool_name)

        result = await executor.execute(tool_name, decision.get("args", {}))
        collected.append(f"{tool_name}: {result}")

    return "\n".join(collected) if collected else "无"
```

---

## JSON 解析（`_parse_decision`）

LLM 有时会在 JSON 后附加说明文字，导致 `json.loads` 失败。使用**平衡括号法**提取第一个完整 JSON 对象：

```python
def _parse_decision(self, raw: str) -> dict:
    # 1. 优先提取 markdown 代码块中的 JSON
    # 2. 否则用平衡括号法找第一个完整 { ... }
    # 3. 解析失败时返回 {"action": "reply_directly"}
```

---

## reply.txt 变更

工具结果放在**对话历史之前**，确保 LLM 先读到实时数据再看历史：

```
【实时工具数据（绝对准确，回答时必须以此为准，忽略对话历史中的旧数据）】
{tool_results}

对话记录：
{chat_history}
```

回复规则中补充：
> 若存在实时工具数据，涉及时间/日期的回答必须直接使用该数据，不得猜测或沿用对话历史中的旧时间

---

## 关键设计决策

| 问题 | 决策 |
|------|------|
| 阶段1是否流式 | 否，工具执行快（<200ms），不需要流式 |
| 最多循环几次 | 3次（`MAX_TOOL_CALLS = 3`） |
| LLM 决策温度 | 0.3（提高 JSON 输出稳定性） |
| 解析失败怎么办 | 静默降级：`tool_results="无"`，直接进入流式回复 |
| 工具执行失败 | 返回 `"[错误] ..."` 字符串，LLM 自行处理 |
| 同一工具重复调用 | `called_tools` set 去重，已调用的工具不再调用 |
| 对话历史污染 | 工具决策 messages 是局部变量，用后丢弃，不写入 `ConversationHistory` |

---

## 验收标准

- [x] `"现在几点了？"` → 触发 `get_datetime`，回复包含正确时间
- [x] `"你还记得我之前说过喜欢什么吗？"` → 触发 `search_memory`
- [x] `"你好"` → 直接回复，不触发任何工具
- [x] 工具调用不影响 SSE 流式输出（阶段2行为与之前完全相同）
- [x] `reply()` 非流式接口同样接入工具循环
