# 04-stt-providers — STT 语音输入接入

**Status: ✅ Implemented** (2026-03-04)

## 背景与目标

当前项目没有语音输入功能。本 spec 实现后端 STT 能力，支持：
- 本地 Whisper（离线，无需 API Key）
- 本地部署的 Qwen3-ASR-Flash（通过 vLLM 部署）

---

## 文件边界

### 新建文件
- `backend/providers/stt/whisper_local.py`
- `backend/providers/stt/qwen3_asr.py`

### 修改文件
- `backend/providers/__init__.py`：补全 `get_stt()` 工厂函数
- `backend/main.py`：新增 `/api/stt` 端点

### 不得修改
- `backend/providers/stt/base.py`

---

## 依赖

- `01-provider-framework`

---

## 实现要求

### `whisper_local.py`

```python
class WhisperLocalProvider(BaseSTTProvider):
    def __init__(self, config: dict):
        self.model_name = config.get("model", "medium")
        self.device = config.get("device", "cpu")
        self.language = config.get("language", "zh")
        self._model = None   # 懒加载
```

**懒加载逻辑：**
```python
def _get_model(self):
    if self._model is None:
        import whisper
        print(f"[Whisper] 正在加载模型 {self.model_name}，首次加载需要一些时间...")
        self._model = whisper.load_model(self.model_name, device=self.device)
        print(f"[Whisper] 模型加载完成")
    return self._model
```

**`transcribe()` 实现：**
1. 将 `audio_data` 写入临时文件（`tempfile.NamedTemporaryFile`，后缀与 `format` 参数对应）
2. 调用 `model.transcribe(temp_file_path, language=self.language)`
3. 返回 `result["text"].strip()`
4. 使用 `asyncio.get_event_loop().run_in_executor(None, ...)` 在线程池中运行（Whisper 是同步的）
5. 确保临时文件在 finally 中删除

**依赖包**：`openai-whisper`（pip install openai-whisper）

### `qwen3_asr.py`

Qwen3-ASR 本地部署 API 规范（OpenAI 兼容的 transcription 接口）：

**API 端点**：`POST {base_url}/v1/audio/transcriptions`

**请求格式**：`multipart/form-data`
- `file`：音频文件
- `model`：`"Qwen/Qwen3-ASR-1.7B"`（固定值）

**响应格式**：
```json
{ "text": "识别出的文字" }
```

```python
class Qwen3ASRProvider(BaseSTTProvider):
    def __init__(self, config: dict):
        self.base_url = config.get("base_url", "http://localhost:8888").rstrip("/")
```

**`transcribe()` 实现：**
1. 使用 `httpx.AsyncClient` POST 到 `{base_url}/v1/audio/transcriptions`
2. multipart/form-data 格式：`files={"file": (f"audio.{format}", audio_data, f"audio/{format}")}`
3. data 中包含 `model=Qwen/Qwen3-ASR-1.7B`
4. 返回 `response.json()["text"].strip()`
5. 连接失败时返回 `""` 并打印 `[Qwen3ASR] 本地服务连接失败: {e}`

### `/api/stt` 端点（`main.py`）

```python
@app.post("/api/stt")
async def speech_to_text(file: UploadFile = File(...), format: str = Form("webm")):
    audio_data = await file.read()
    stt = get_stt()
    text = await stt.transcribe(audio_data, format=format)
    return JSONResponse(content={"text": text})
```

**需要的导入**：
```python
from fastapi import UploadFile, File, Form
from providers import get_stt
```

---

## 约束

- Whisper 模型只加载一次（懒加载 + 单例模式）
- 不在 STT Provider 中处理音频格式转换（前端传什么格式就用什么格式）
- `/api/stt` 端点不参与对话流程，只做纯粹的音频→文字转换
- STT 不影响现有的 `/api/chat` 端点

---

## 验收标准

- [ ] 上传 WAV 文件到 `/api/stt`，能返回识别文字
- [ ] Whisper 第一次调用时打印加载提示，第二次不重复加载
- [ ] Qwen3ASR 本地服务未启动时返回 `{"text": ""}`，不报 500 错误
- [ ] 切换 `stt.active` 后重启，自动使用新 provider
- [ ] 支持 webm、wav、mp3 格式的音频输入
