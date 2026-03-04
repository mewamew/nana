# 03-tts-providers — TTS 多家接入

**Status: ✅ Implemented** (2026-03-04)

## 背景与目标

当前 TTS 在 `tts.py` 中硬编码了 Fish Audio 实现。本 spec 将其重构为 Provider 模式，支持：
- Fish Audio（现有，重构）
- 本地部署的 Qwen3 TTS（新增）

---

## 文件边界

### 新建文件
- `backend/providers/tts/fish_audio.py`
- `backend/providers/tts/qwen3_tts.py`

### 修改文件
- `backend/providers/__init__.py`：补全 `get_tts()` 工厂函数
- `backend/chat_service.py`：将 `TTSService` 替换为 `get_tts()`

### 不得修改
- `backend/tts.py`（保留兼容）
- `backend/providers/tts/base.py`

---

## 依赖

- `01-provider-framework`

---

## 实现要求

### `fish_audio.py`

从现有 `tts.py` 迁移逻辑，调整为 Provider 模式：

```python
class FishAudioProvider(BaseTTSProvider):
    def __init__(self, config: dict):
        self.api_key = config.get("api_key", "")
        self.reference_id = config.get("reference_id", "")
```

**`synthesize()` 实现：**
1. 参考现有 `tts.py` 中的 Fish Audio 实现逻辑迁移过来
2. 使用 `httpx.AsyncClient`，超时 60 秒
3. 返回原始音频字节（MP3 格式）
4. TTS 未配置（api_key 为空）时返回 `b""`

**`is_configured()` 逻辑：**
```python
def is_configured(self) -> bool:
    return bool(self.api_key and self.api_key.strip())
```

### `qwen3_tts.py`

Qwen3 TTS 本地部署 API 规范（基于 vLLM-Omni 部署）：

**API 端点**：`POST {base_url}/v1/audio/speech`

**请求格式**：
```json
{
  "input": "要合成的文字",
  "voice": "vivian",
  "response_format": "mp3",
  "task_type": "CustomVoice"
}
```

**响应**：二进制音频数据（MP3）

```python
class Qwen3TTSProvider(BaseTTSProvider):
    def __init__(self, config: dict):
        self.base_url = config.get("base_url", "http://localhost:8887").rstrip("/")
        self.voice = config.get("voice", "vivian")
```

**`synthesize()` 实现：**
1. POST 到 `{base_url}/v1/audio/speech`
2. 请求体按上述格式
3. 直接返回响应的二进制内容
4. 连接失败时打印 `[Qwen3TTS] 本地服务连接失败，请确认服务已启动: {e}`
5. 连接失败时返回 `b""`（不抛出异常，降级处理）

**`is_configured()` 逻辑：**
始终返回 `True`（本地服务不需要 api_key）

### `chat_service.py` 修改

1. 移除对 `TTSService` 的导入
2. 在需要调用 TTS 时，使用 `get_tts()` 获取实例
3. TTS 未配置（`provider.is_configured()` 为 False）时跳过合成，返回 `b""`
4. 保持现有的"先生成文字回复，再合成语音"的顺序不变

---

## 约束

- 不修改 TTS 的触发时机（仍在获得完整回复后才合成）
- Qwen3TTS 的 voice 参数从 config 读取，不硬编码

---

## 验收标准

- [ ] FishAudio provider 能正常合成音频（需要有效 api_key）
- [ ] FishAudio api_key 为空时返回 `b""`，不报错
- [ ] Qwen3TTS provider 能连接本地服务合成音频
- [ ] Qwen3TTS 本地服务未启动时，返回 `b""` 并打印提示，不崩溃
- [ ] 切换 `config.json` 中 `tts.active` 后重启，自动使用新 provider
