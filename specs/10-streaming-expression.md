# 10-streaming-expression — 流式表情解析

**Status: ✅ Implemented (2026-03-04)**

## 背景与目标

当前表情提取逻辑：等 LLM 流式输出完毕 → 拼接全文 → `extract_expression()` 提取 → 发送 expression 事件。这导致表情触发滞后，用户先看到一大段文字后才出现表情变化。

本 spec 改进为**流式增量检测**：在 SSE 流式输出过程中，用增量正则扫描已累积的文本，一旦检测到 `expression` 字段就立即 yield expression 事件，实现表情与文字近乎同时到达前端。

仅修改后端，前端无需改动（已有 `onExpression` 回调）。

---

## 文件边界

### 修改文件
- `backend/chat_service.py`：流式过程中增量检测 expression

### 不得修改
- `backend/main_agent.py`
- `backend/main.py`
- `backend/conversation.py`
- `frontend/` 下任何文件
- `backend/providers/`

---

## 依赖

无（独立于其他 spec）

---

## 接口契约

### SSE 事件流变化

**当前行为**：
```
text → text → text → ... → expression → audio → done
```

**新行为**：
```
text → text → expression → text → text → ... → audio → done
```

expression 事件可能在 text 流的任意位置出现（取决于 LLM 何时输出 `"expression"` 字段），而非只在末尾。

前端已有 `onExpression` 回调，无需修改。

---

## 实现要求

### `chat_service.py` 修改

在 `generate_reply_stream()` 方法中加入增量表情检测：

```python
async def generate_reply_stream(
    self, message: str
) -> AsyncGenerator[dict[str, str], None]:
    """流式生成回复，按事件类型 yield 字典"""
    chunks: list[str] = []
    expression_sent = False  # 标记：是否已发送过 expression

    async for chunk in self.main_agent.reply_stream(message):
        if not chunk:
            continue
        chunks.append(chunk)
        yield {"type": "text", "content": chunk}

        # 增量检测 expression（仅在尚未发送时扫描）
        if not expression_sent:
            accumulated = "".join(chunks)
            expression = self._try_extract_expression(accumulated)
            if expression:
                expression_sent = True
                yield {"type": "expression", "content": expression}

    # 兜底逻辑：流中未检测到则在结束后提取
    if not expression_sent:
        full_text = "".join(chunks)
        expression = self.main_agent.extract_expression(full_text)
        if expression:
            yield {"type": "expression", "content": expression}

    # 合成语音（TTS）
    try:
        tts = get_tts()
        if tts.is_configured():
            full_text = "".join(chunks)
            clean_text = self.main_agent.extract_reply_text(full_text)
            audio_bytes = await tts.synthesize(clean_text)
            if audio_bytes:
                audio_b64 = base64.b64encode(audio_bytes).decode("ascii")
                yield {"type": "audio", "content": audio_b64}
    except NotImplementedError:
        pass
```

### `_try_extract_expression()` 方法

```python
import re

# expression 字段的增量正则（匹配部分 JSON 中的 expression 值）
_EXPRESSION_PATTERN = re.compile(r'"expression"\s*:\s*"([^"]+)"')

def _try_extract_expression(self, accumulated: str) -> str | None:
    """
    从已累积的文本中增量提取 expression 字段。
    返回表情名称字符串，或 None。
    """
    match = self._EXPRESSION_PATTERN.search(accumulated)
    if match:
        return match.group(1).strip()
    return None
```

---

## 关键设计决策

| 问题 | 决策 |
|------|------|
| 每个 chunk 都扫描还是间隔扫描 | 每个 chunk 都扫描，正则匹配非常快（微秒级），不影响性能 |
| 正则 vs JSON 解析 | 正则：LLM 流式输出中 JSON 不完整，无法用 `json.loads` |
| expression 发送多次吗 | 否，`expression_sent` flag 保证只发送一次 |
| 兜底逻辑是否保留 | 保留：流中未检测到时，结束后用 `extract_expression()` 兜底 |
| 是否修改 `MainAgent` | 否，`extract_expression()` 保持原有实现，本 spec 只在 `ChatService` 层增加增量检测 |
| 正则是否编译为类属性 | 是，`_EXPRESSION_PATTERN` 作为类属性预编译，避免重复编译 |

---

## 性能分析

- 每个 chunk 到达时对已累积文本做一次正则搜索
- 典型回复长度 200~500 字符，正则匹配耗时 < 1μs
- `expression_sent = True` 后不再扫描，避免后续 chunk 的无意义匹配
- 总开销可忽略不计

---

## 验收标准

- [ ] LLM 输出包含 expression 时，前端在文字流中途即收到表情事件，而非等全文完成
- [ ] 对 LLM 不输出 expression 的情况，兜底逻辑仍正常工作
- [ ] expression 事件只发送一次，不会重复
- [ ] TTS 语音合成不受影响（仍在流结束后执行）
- [ ] `MainAgent.extract_expression()` 不被修改，兜底逻辑复用现有实现
- [ ] 前端无需任何修改即可支持新行为
