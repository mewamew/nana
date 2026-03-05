# 16 — 心跳系统：60s tick + LLM 决策 + 注意力管理

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
   ┌─────────────────┐
   │   5 道门控检查    │
   │  1. 活跃时间      │
   │  2. 无 pending    │
   │  3. MIN_GAP       │
   │  4. 有过互动      │
   │  5. rate 概率门控  │
   └────────┬─────────┘
            │ 通过
            ▼
   LLM 决策 + 生成
   {"action": "send_message" | "wait"}
            │
            ▼
   前端轮询 /api/proactive 取走消息
```

---

## 文件清单

| 文件 | 职责 |
|------|------|
| `backend/heartbeat.py` | HeartbeatSystem 类，tick 循环、门控、注意力系统、LLM 调用 |
| `backend/prompts/heartbeat.md` | LLM 决策 prompt（action 选择 + 消息生成） |
| `backend/emotional_state.py` | 交互回调机制（`on_interaction()` + `record_interaction()` 触发） |
| `backend/main.py` | lifespan 中启动心跳任务，`/api/proactive` 端点 |

---

## 常量定义

| 常量 | 值 | 说明 |
|------|------|------|
| `TICK_INTERVAL` | 60 | tick 间隔（秒） |
| `MIN_GAP` | 300 | 两条主动消息最小间隔（5 分钟） |
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

## Tick 流程（5 道门控）

```python
async def _tick(self):
    self._update_response_rate()

    # 门控 1: 活跃时间 8:00-23:00（硬门控）
    if not (ACTIVE_START <= hour < ACTIVE_END):
        return

    # 门控 2: 无待消费的 pending_message
    if self._pending_message is not None:
        return

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

    # → 调 LLM 决策
    result = await self._llm_decide_and_generate()
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
| `{recent_context}` | `ConversationHistory.get_context()` |
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

**有消息时：**
```json
{"message": "哼，你怎么还不来找我说话", "expression": "嘟嘴"}
```

**无消息时：**
```json
{"message": null}
```

接口行为不变，前端无需改动。

---

## HeartbeatSystem 公开方法

| 方法 | 说明 |
|------|------|
| `__init__(emotional_state, conversation_history)` | 构造，注册回调，加载 prompt |
| `start()` | async 后台任务入口（在 lifespan 中 create_task） |
| `pop_pending_message()` | 取出待发送消息，取后清空 |
| `notify_interaction()` | 互动回调，设 `response_rate = INTERACTION_BOOST` |
