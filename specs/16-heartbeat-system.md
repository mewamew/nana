# 16 — 心跳系统：60s tick + LLM 决策 + 注意力管理 `[已实现]`

## 概述

心跳系统让娜娜在用户不主动发消息时，也能自主决定是否打招呼、关心主人。采用 **60 秒 tick** 频率感知环境，由 **LLM 自主决策** 是否发消息（取代硬编码规则），通过 **注意力系统（response_rate）** 概率门控避免过度调用 LLM。

---

## 核心架构

```
EmotionalState.record_interaction()
        │
        ▼ (回调)
HeartbeatSystem.notify_interaction()    ← response_rate = 0.4
        │
        ▼ (每 60s tick)
   ┌──────────────────────────┐
   │      6 道门控检查          │
   │  0. 已完成初始化           │
   │  1. 活跃时间               │
   │  2. 无 pending（TTL 超时丢弃）│
   │  3. MIN_GAP               │
   │  4. 有过互动               │
   │  5. rate 概率门控          │
   └────────┬─────────────────┘
            │ 通过
            ▼
   LLM 决策 + 生成（动态注入 persona）
   {"action": "send_message" | "wait"}
            │ send_message
            ▼
   写入对话历史 + SQLite
            │
            ▼
   前端轮询 /api/proactive 取走消息
            │
            ▼
   持久化 response_rate + last_proactive
```

---

## 文件清单

| 文件 | 职责 |
|------|------|
| `backend/heartbeat.py` | HeartbeatSystem 类，tick 循环、门控、注意力系统、LLM 调用 |
| `backend/prompts/heartbeat.md` | LLM 决策 prompt（action 选择 + 消息生成），使用 `{char_name}` / `{user_name}` 占位符，每次调用时动态注入 |
| `backend/emotional_state.py` | 交互回调机制 + 心跳状态持久化（`heartbeat` 字段） |
| `backend/conversation.py` | `add_message()` 支持单条消息写入，`get_recent_context()` 按条数截取 |
| `backend/database.py` | `save_message()` 单条消息持久化 |
| `backend/main.py` | lifespan 中启动心跳任务，`/api/proactive` 端点 |

---

## 常量定义

| 常量 | 值 | 说明 |
|------|------|------|
| `TICK_INTERVAL` | 60 | tick 间隔（秒） |
| `MIN_GAP` | 300 | 两条主动消息最小间隔（5 分钟） |
| `PENDING_TTL` | 300 | pending 消息超时时间（5 分钟），超时后自动丢弃 |
| `ACTIVE_START` | 8 | 活跃时间起始（8:00） |
| `ACTIVE_END` | 23 | 活跃时间结束（23:00） |
| `DECAY_FACTOR` | 0.997 | 每 tick response_rate 乘法衰减 |
| `ACCUMULATION_RATE` | 0.003 | 沉默超阈值后每 tick 累加 |
| `SILENCE_THRESHOLD` | 1800 | 30 分钟沉默后开始累加（秒） |
| `INTERACTION_BOOST` | 0.4 | 用户互动时 response_rate 重设为此值 |
| `LLM_CALL_THRESHOLD` | 0.15 | rate 低于此值不调 LLM |

---

## 注意力系统（response_rate）

`response_rate` 是一个 0~1 的浮点数，控制每次 tick 是否调用 LLM：

### 变化规则

1. **用户互动** → `rate = INTERACTION_BOOST (0.4)`
2. **每 tick** → `rate *= DECAY_FACTOR (0.997)`，自然衰减
3. **沉默 > 30 分钟后** → 每 tick `rate += ACCUMULATION_RATE (0.003)`，逐渐积累想说话的冲动
4. **LLM 决定发消息后** → `rate *= 0.3`，大幅抑制连续发送
5. **LLM 决定等待后** → `rate *= 0.7`，适度降低

### 概率门控

tick 中先检查 `rate >= LLM_CALL_THRESHOLD`，再用 `random() < rate` 做概率判断。两层过滤确保低 rate 时几乎不调 LLM。

### 行为模式

| 场景 | response_rate 行为 | 预期 LLM 调用 |
|------|-------------------|--------------|
| 用户活跃对话中 | rate=0.4 但 MIN_GAP 阻塞 | ~0 次 |
| 对话刚结束 | rate=0.4 → 衰减中 | 1-2 次 |
| 沉默 1-3 小时 | rate 从 0 累加到 0.18-0.54 | 每小时 1-3 次 |
| 全天估算 | — | ~8-15 次 |

---

## Tick 流程（6 道门控）

```python
async def _tick(self):
    # 门控 0: 必须已完成初始化
    if not is_initialized():
        return

    self._update_response_rate()

    # 门控 1: 活跃时间 8:00-23:00（硬门控）
    if not (ACTIVE_START <= hour < ACTIVE_END):
        return

    # 门控 2: 无待消费的 pending_message（超时 PENDING_TTL 则丢弃）
    if self._pending_message is not None:
        if (now - created_at) < PENDING_TTL:
            return
        self._pending_message = None  # 超时丢弃

    # 门控 3: MIN_GAP 5 分钟间隔
    if last_proactive and elapsed < MIN_GAP:
        return

    # 门控 4: 至少有过一次互动
    if last_interaction_time is None:
        return  # 尝试从持久化状态恢复

    # 门控 5: response_rate 概率门控
    if rate < LLM_CALL_THRESHOLD:
        return
    if random() >= rate:
        return

    # → 调 LLM 决策（动态注入 persona）
    result = await self._llm_decide_and_generate()
    if result:
        await conversation_history.add_message("assistant", result["message"])
        self._pending_message = {**result, "created_at": now}
    # → 持久化心跳状态
    emotional_state.save_heartbeat_state(response_rate, last_proactive)
```

---

## LLM 决策 Prompt

Prompt 模板位于 `backend/prompts/heartbeat.md`，占位符：

| 占位符 | 来源 |
|--------|------|
| `{mood_state}` | `EmotionalState.get_mood_description()` |
| `{time_context}` | `EmotionalState.get_time_context()` |
| `{relationship_context}` | `EmotionalState.get_relationship_description()` |
| `{user_info}` | `ConversationHistory.format_profile()` |
| `{recent_context}` | `ConversationHistory.get_recent_context(n=10)` |
| `{hours_since_interaction}` | 距上次互动小时数 |
| `{response_rate}` | 当前注意力值 |

### LLM 输出格式

发消息：
```json
{"action": "send_message", "message": "...", "expression": "..."}
```

等待：
```json
{"action": "wait"}
```

---

## 交互回调机制

`EmotionalState` 提供回调注册：

```python
# 注册
emotional_state.on_interaction(heartbeat.notify_interaction)

# 触发（在 record_interaction() 末尾自动调用）
for cb in self._interaction_callbacks:
    cb()
```

这样 HeartbeatSystem 无需 main.py 额外传递引用，通过 EmotionalState 的回调自动感知用户互动。

---

## API 接口

### `GET /api/proactive`

前端轮询此接口获取主动消息。

**有消息时（含语音）：**
```json
{"message": "哼，你怎么还不来找我说话", "expression": "嘟嘴", "audio": "<base64>"}
```

**有消息时（TTS 失败/未配置，无语音）：**
```json
{"message": "哼，你怎么还不来找我说话", "expression": "嘟嘴"}
```

**无消息时：**
```json
{"message": null}
```

---

## 主动消息语音（TTS + 口型同步 + 推镜）

主动消息和正常聊天效果一致：文字 + 表情 + TTS 语音 + 口型同步 + 字幕 + 推镜。

### 后端流程

`_llm_decide_and_generate()` 中，LLM 返回 `send_message` 后，调用 TTS 合成语音，将 base64 音频附加到 `result["audio"]`。TTS 失败时静默降级（只有文字+表情，无语音）。

### 前端流程

前端轮询 `/api/proactive` 收到主动消息时：
1. 添加消息到聊天记录
2. 切换 Live2D 表情
3. 显示字幕（`showSubtitle()`，5 秒后淡出）
4. 若有 `audio`：推镜（`zoomIn`）+ 播放语音并口型同步（`playWithLipSync`）
5. 语音播放结束后自动回镜（`zoomOut`，由 `useLipSync.onAudioEnd` 回调处理）

### 涉及文件

| 文件 | 改动 |
|------|------|
| `backend/heartbeat.py` | `_llm_decide_and_generate` 中调 TTS，附加 `audio` 字段 |
| `frontend/src/App.jsx` | 轮询处理增加 `playWithLipSync` + `showSubtitle` + `zoomIn` |

---

## HeartbeatSystem 公开方法

| 方法 | 说明 |
|------|------|
| `__init__(emotional_state, conversation_history)` | 构造，注册回调，加载 prompt |
| `start()` | async 后台任务入口（在 lifespan 中 create_task） |
| `pop_pending_message()` | 取出待发送消息，取后清空 |
| `notify_interaction()` | 互动回调，设 `response_rate = INTERACTION_BOOST` |

---

## 历史记录集成

心跳生成的主动消息在 `_tick()` 中 LLM 返回 `send_message` 后，立即写入对话历史：

1. `conversation_history.add_message("assistant", message)` — 写入内存 turns（用 `ConversationTurn("", content)` 表示只有 assistant 的消息）+ SQLite（`save_message()`）
2. `get_context()` 和 `get_recent_context()` 会跳过空 ask，只输出 `assistant: ...`
3. `/api/history` 通过 `get_history_for_frontend()` 返回所有消息（包括心跳消息）
4. 重启后 `_restore_from_db()` 通过 `get_recent_dialogs()` 恢复配对消息，心跳消息不会进入内存 turns（仍保留在 SQLite 中）

---

## 前端并发安全

流式回复与心跳消息互不覆盖：

1. `onGenerationId` 收到时，立即创建带 `generationId` 的 assistant 占位消息
2. `onAudio` / `onDone` 通过 `generationId` 精准匹配更新对应消息
3. 心跳消息独立 `append`，带 `source: 'heartbeat'`，不受流式更新影响

---

## 状态持久化

`nana_state.json` 中的 `heartbeat` 字段：

```json
{
  "mood": { ... },
  "relationship": { ... },
  "daily": { ... },
  "heartbeat": {
    "response_rate": 0.24,
    "last_proactive": "2026-03-06T12:20:00"
  }
}
```

- **写入时机**：`_tick()` 末尾（通过门控后，无论 LLM 决定发消息还是等待）
- **恢复时机**：`__init__` 中从 `emotional_state.get_heartbeat_state()` 读取
- `last_interaction_time` 已有从 `relationship.last_interaction` 恢复的逻辑

---

## 设计备注

- **主动消息不触发 `record_interaction`**：主动消息是角色单方面行为，不应算互动。用户回复时正常聊天流程会触发
- **Prompt 模板使用 `str.replace()` 链**：避免 `str.format()` 在动态字段含 `{` 时抛 `KeyError`
- **Persona 动态注入**：`__init__` 只加载原始模板，每次 `_llm_decide_and_generate()` 重新 `load_persona()` 并替换 `{char_name}` / `{user_name}`
- **JSON 解析三级容错**：① 直接 `json.loads` → ② 匹配 ``` 代码块 → ③ 花括号平衡匹配
- **Pending 消息超时**：`_pending_message` 附带 `created_at`，超过 `PENDING_TTL`（5 分钟）未被前端消费则自动丢弃，`pop_pending_message()` 返回前剥离 `created_at` 字段
