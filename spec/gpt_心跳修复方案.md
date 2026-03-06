# GPT 心跳修复方案

## 1. 背景

当前心跳系统负责在用户沉默时生成主动消息，核心链路为：

`HeartbeatSystem._tick()` -> `HeartbeatSystem._llm_decide_and_generate()` -> `GET /api/proactive` -> 前端轮询展示。

现有实现已经能跑通基础功能，但在投递可靠性、上下文一致性、前后端协同和运行时状态恢复上存在明显缺陷，导致：

- 主动消息可能丢失或被覆盖
- 后端记忆不知道自己主动说过什么
- 前端多标签页/轮询异常时行为不稳定
- 首次初始化后 persona 不同步
- 服务重启后心跳行为失真

本方案只定义修复方向、数据结构、接口和实施顺序，不在本文件中直接落实现。

## 2. 现状问题

### P0. 主动消息未进入正式对话历史

当前主动消息仅进入 `HeartbeatSystem._pending_message`，被 `/api/proactive` 取走后不会回写到：

- `ConversationHistory`
- SQLite `messages`
- `/api/history`
- 后续 `recent_context`

直接后果：

- LLM 不知道自己已经主动说过什么
- 心跳可能重复生成相似内容
- 前端历史与后端上下文不一致

### P0. 主动消息是“读取即删除”的脆弱投递

当前 `pop_pending_message()` 的语义是：

- 前端请求成功即删除
- 没有 ack
- 没有重试
- 没有幂等
- 没有多标签页保护

直接后果：

- 浏览器收到响应但渲染失败时消息永久丢失
- 某个标签页先轮询到后，其他标签页再也看不到该消息
- 网络抖动时消息状态不可追踪

### P0. 前端会用普通回复覆盖心跳消息

当前流式聊天结束时，前端以“替换最后一条 assistant 消息”的方式提交最终回复。  
如果心跳消息刚好在流式回复期间插入，它会被正常回复静默覆盖。

### P1. 单条未消费消息会阻塞整个心跳

当前只有一个 `_pending_message` 槽位。只要槽位非空，后续 tick 全部跳过。  
前端断开轮询或消费异常时，心跳系统会长期停摆。

### P1. 心跳 prompt 的 persona 在运行时不会刷新

`HeartbeatSystem` 在构造时只加载一次 prompt 并替换 `{char_name}` / `{user_name}`。  
如果应用启动后才完成初始化，主聊天 prompt 会刷新，但心跳 prompt 仍可能使用默认名字。

### P1. 心跳状态不持久化

以下状态仅在内存中存在：

- `response_rate`
- `last_proactive`
- `last_interaction_time`

服务重启后：

- 冷却窗口丢失
- 注意力累积丢失
- 心跳重新进入冷启动

### P2. 活跃时间依赖服务器本地时区

当前 `8:00-23:00` 使用的是服务器 `datetime.now()`。  
一旦部署机和用户时区不一致，主动消息触发时机会整体偏移。

## 3. 修复目标

本次修复应满足以下目标：

1. 主动消息必须进入统一对话历史，后续上下文可见。
2. 主动消息投递必须可确认、可重试、可过期，不再“读到即丢”。
3. 前端必须按消息 ID 更新普通回复，不能靠“替换最后一条 assistant”。
4. 心跳 prompt 必须使用最新 persona。
5. 重启后心跳节奏应尽量连续，不出现明显行为跳变。
6. 活跃时间应按用户时区计算，至少允许配置。

## 4. 总体设计

### 4.1 主动消息从单槽位改为可确认队列

将当前：

- `_pending_message: dict | None`

改为：

- `pending_messages: deque[ProactiveMessage]`

建议新增消息结构：

```json
{
  "id": "uuid",
  "source": "heartbeat",
  "message": "……",
  "expression": "嘟嘴",
  "audio": "<base64 optional>",
  "created_at": "2026-03-06T12:34:56",
  "delivery_state": "pending",
  "lease_until": null,
  "expire_at": "2026-03-06T12:39:56"
}
```

语义说明：

- `pending`: 尚未投递
- `leased`: 已被某个前端取走，等待 ack
- `acked`: 前端已确认展示/播放
- `expired`: 超时失效，可删除

### 4.2 接口从“读即删”改为“拉取 + ack”

建议将投递接口改为两步：

- `GET /api/proactive`
  - 返回最老的一条可投递消息
  - 服务器为该消息设置短租约，例如 30-60 秒
  - 租约未过期前，不重复投给其他请求
- `POST /api/proactive/ack`
  - 请求体：`{"id": "<message_id>"}`
  - 前端在消息成功写入 UI 后立即 ack
  - 服务器收到 ack 后才真正删除队列项

补充机制：

- 租约过期后允许重新投递
- 消息超过最大生存时间自动标记 `expired`
- 队列长度建议设上限，例如 3 条，超出后丢弃最旧失效项

这比直接上 WebSocket 改动更小，且能在现有轮询架构内完成可靠性修复。

### 4.3 主动消息纳入统一历史模型

当前 `ConversationHistory` 以“用户一条 + 助手一条”的配对轮次为中心，不适合表示“只有 assistant 的主动消息”。  
建议把内存历史模型从轮次改成消息流。

建议新增：

```python
class ConversationMessage:
    role: str          # user / assistant
    content: str
    source: str        # chat / heartbeat
    created_at: str
```

然后：

- `add_dialog(user, assistant)` 改成内部调用两次 `add_message()`
- 新增 `add_message(role, content, source="chat")`
- 心跳主动消息调用 `add_message("assistant", ..., source="heartbeat")`
- `get_context()` 改为按消息序列拼接，而不是假设永远是 user/assistant 配对

数据库层同步调整：

- 新增通用 `save_message(session_id, role, content, source, created_at)`
- `save_dialog()` 保留为兼容包装器
- `get_recent_dialogs()` 逐步改为 `get_recent_messages()`
- `/api/history` 直接返回消息流

### 4.4 前端按消息 ID 更新流式回复

当前问题不是“轮询本身”，而是普通回复的提交流程依赖“替换最后一条 assistant 消息”。  
修复思路：

- 用户发送消息时，前端创建一条带 `generationId` 的 assistant 占位消息
- 流式文本持续更新该占位消息
- `onDone` / `onAudio` 只更新对应 `generationId` 的那条消息
- 心跳主动消息单独 append，带 `source: 'heartbeat'` 和 `id`

这样即使心跳消息在普通回复期间插入，也不会被覆盖。

建议前端消息结构至少增加：

```js
{
  id: "...",
  type: "assistant",
  source: "chat" | "heartbeat",
  generationId: "...",
  content: "..."
}
```

### 4.5 persona 改为调用时动态注入

不要在 `HeartbeatSystem.__init__()` 中一次性替换名字。  
改为：

- `__init__()` 只加载原始模板
- 每次 `_llm_decide_and_generate()` 时重新 `load_persona()`
- 再执行占位符替换

这样首次初始化后，心跳无需重建即可拿到最新名字。

### 4.6 心跳状态持久化

建议新增单独文件：

- `save/heartbeat_state.json`

理由：

- 避免与 `EmotionalState` 共写 `nana_state.json` 时出现职责耦合
- 便于单独管理版本和回滚

建议持久化字段：

```json
{
  "response_rate": 0.24,
  "last_proactive": "2026-03-06T12:20:00",
  "last_interaction_time": "2026-03-06T11:52:00"
}
```

写入时机：

- `notify_interaction()`
- `_tick()` 内部更新 `response_rate` 后
- 生成主动消息后
- ack/expire 清理后

启动时恢复：

- 先读 `heartbeat_state.json`
- 若缺失 `last_interaction_time`，再退回 `EmotionalState.relationship.last_interaction`

### 4.7 活跃时间改为用户时区

建议来源优先级：

1. persona/config 中显式配置的 `timezone`
2. 前端首次上报的浏览器时区
3. 兜底服务器本地时区

后端使用 `zoneinfo.ZoneInfo` 计算当前用户本地小时，再执行活跃窗口门控。

## 5. 实施顺序

### 阶段 1：先修数据模型和投递语义

- 为主动消息增加 `id`、租约、过期时间
- 新增 `GET /api/proactive` + `POST /api/proactive/ack`
- 移除 `pop_pending_message()` 的“读即删”语义
- 增加队列锁，保证并发请求下不会重复租出同一条消息

### 阶段 2：统一对话历史

- 引入 `ConversationMessage`
- 为 `ConversationHistory` 增加 `add_message()`
- 数据库增加 `save_message()` / `get_recent_messages()`
- 主动消息写入历史与数据库
- `/api/history` 返回 heartbeat 消息

### 阶段 3：修前端覆盖问题

- 给前端消息加 `id/source/generationId`
- 普通回复按 `generationId` 更新
- 心跳消息独立插入
- ack 在消息成功写入界面后触发

### 阶段 4：修行为一致性

- persona 动态注入 heartbeat prompt
- 增加 `heartbeat_state.json`
- 用户时区支持

## 6. 不建议这样修

以下方案看起来简单，但不建议采用：

- 继续保留 `_pending_message` 单槽位，只额外加超时
  - 只能缓解阻塞，不能解决投递丢失和多标签页问题
- 在 `/api/proactive` 取走时直接删除，同时让前端“自己记住”
  - 后端仍然没有可靠确认机制
- 把主动消息硬塞成一条伪造的 user/assistant 配对轮次
  - 会污染上下文结构，后续检索和格式化会越来越难维护

## 7. 验收标准

修复完成后至少满足：

1. 心跳消息出现在 `/api/history` 中，并参与后续 `recent_context`。
2. 前端在普通回复进行中收到心跳消息时，两者都能保留。
3. 浏览器拿到心跳消息但未 ack 时，消息不会立即丢失，租约过期后可再次投递。
4. 前端停止轮询后，旧消息过期不会永久阻塞后续心跳。
5. 首次初始化完成后，心跳消息使用最新 `char_name` / `user_name`。
6. 服务重启后，`MIN_GAP` 和 `response_rate` 行为连续，不出现明显突变。
7. 当用户时区与服务器时区不同，主动消息仍按用户本地 8:00-23:00 控制。

## 8. 建议补充测试

- 后端单元测试
  - 租约发放、ack、超时重投、过期清理
- 后端集成测试
  - 主动消息入库、`/api/history` 可见、重启后状态恢复
- 前端行为测试
  - 流式回复与心跳消息并发时不会互相覆盖
- 手工联调
  - 单标签页、多标签页、断网恢复、TTS 开关、首次初始化后 persona 刷新

## 9. 本次修复范围边界

本方案优先修复可靠性和一致性，不在本轮处理以下增强项：

- 从轮询切换到 WebSocket/SSE 推送
- 更复杂的主动消息优先级调度
- 多用户、多会话的完整心跳隔离
- 主动消息的个性化 AB 策略

这些可以在基础可靠性修复完成后再评估。
