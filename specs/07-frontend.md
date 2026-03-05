# 07-frontend — 前端改造

**Status: ✅ Implemented** (2026-03-04)

## 背景与目标

当前前端问题：
1. 等待完整回复才显示，无流式体验
2. 所有配置硬编码，无法通过 UI 修改
3. 没有语音输入功能

本 spec 改造：
1. **SSE 流式字幕**：文字逐字出现
2. **配置面板**：可视化管理所有 Provider 配置
3. **语音输入**：麦克风录音 → STT → 自动填充输入框

---

## 文件边界

### 新建文件
- `frontend/src/api/client.js`
- `frontend/src/components/ConfigPanel.jsx`
- `frontend/src/components/ConfigPanel.css`
- `frontend/src/components/VoiceInput.jsx`
- `frontend/src/components/VoiceInput.css`

### 修改文件
- `frontend/src/App.jsx`：接入 SSE，集成新组件
- `frontend/src/App.css`：新增配置面板和语音按钮样式

### 不得修改
- `frontend/src/components/Live2DModel.jsx`（Live2D 核心逻辑）
- `frontend/src/components/LoadingDots.jsx`
- `frontend/src/main.jsx`
- `frontend/index.html`

---

## 依赖

- `06-backend-api`（SSE 接口、config 接口、stt 接口必须就绪）

---

## 实现要求

### `api/client.js`

```javascript
const BASE_URL = "http://localhost:8000"

export const api = {
  // SSE 流式对话
  chatStream(message, ttsEnabled = true, callbacks) {
    // callbacks: { onText, onExpression, onAudio, onDone, onError }
    // 使用 fetch + ReadableStream 解析 SSE
    // 请求 body 中传递 tts_enabled 字段
  },

  // 语音识别
  async transcribe(audioBlob, format = "webm") {
    const formData = new FormData()
    formData.append("file", audioBlob, `audio.${format}`)
    formData.append("format", format)
    const res = await fetch(`${BASE_URL}/api/stt`, { method: "POST", body: formData })
    return res.json()  // { text: "..." }
  },

  // 获取配置（脱敏）
  async getConfig() {
    const res = await fetch(`${BASE_URL}/api/config`)
    return res.json()
  },

  // 更新配置
  async updateConfig(partial) {
    const res = await fetch(`${BASE_URL}/api/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(partial)
    })
    return res.json()
  }
}
```

**SSE 解析（`chatStream`）**：
1. 使用 `fetch` 发 POST，`response.body.getReader()` 读取流
2. 按 `\n\n` 分割事件块，每块解析 `data:` 后的 JSON
3. 根据 `type` 字段调用对应 callback
4. 收到 `done` 事件时停止读取

### `App.jsx` 改造

**状态调整：**
```javascript
const [showConfig, setShowConfig] = useState(false)  // 控制配置面板显示
const [isRecording, setIsRecording] = useState(false) // 录音状态
const [ttsEnabled, setTtsEnabled] = useState(() => {  // TTS 开关（localStorage 持久化）
  const saved = localStorage.getItem('ttsEnabled')
  return saved !== null ? JSON.parse(saved) : true
})
```

**`handleSendMessage` 改造（SSE 版本）：**

```javascript
const handleSendMessage = async () => {
  if (!input.trim()) return
  const userMessage = input
  setInput("")
  setLoading(true)

  // 立即显示用户消息
  setMessages(prev => [...prev, { type: "user", content: userMessage }])

  let assistantText = ""

  api.chatStream(userMessage, ttsEnabled, {
    onText: (chunk) => {
      // 解析 JSON 中的 reply 字段（逐步累积）
      assistantText += chunk
      const replyText = tryExtractReply(assistantText)  // 尝试提取 reply 字段
      if (replyText) {
        setMessages(prev => {
          const last = prev[prev.length - 1]
          if (last?.type === "assistant") {
            return [...prev.slice(0, -1), { type: "assistant", content: replyText }]
          }
          return [...prev, { type: "assistant", content: replyText }]
        })
      }
    },
    onExpression: (expression) => {
      if (live2dRef.current) live2dRef.current.showExpression(expression)
    },
    onAudio: (audioBase64) => {
      if (ttsEnabled) playAudio(audioBase64)  // TTS 关闭时跳过播放
    },
    onDone: () => {
      setLoading(false)
    },
    onError: (msg) => {
      console.error("Chat error:", msg)
      setLoading(false)
    }
  })
}
```

**`tryExtractReply` 辅助函数：**
```javascript
function tryExtractReply(raw) {
  // 尝试从流式累积的 JSON 片段中提取 reply 字段
  // 完整 JSON 时：解析并返回 reply
  // 不完整时：返回 null
  try {
    const data = JSON.parse(raw)
    return data.reply || null
  } catch {
    // 尝试正则匹配 "reply": "..."
    const match = raw.match(/"reply"\s*:\s*"([^"]*)"/)
    return match ? match[1] : null
  }
}
```

**布局调整（JSX）：**
```jsx
return (
  <div className="app">
    {/* 右上角配置按钮 */}
    <button className="config-btn" onClick={() => setShowConfig(true)}>⚙</button>

    {/* 配置面板（模态） */}
    {showConfig && <ConfigPanel onClose={() => setShowConfig(false)} />}

    {/* Live2D 主区域（不变） */}
    <div className="live2d-main">
      <Live2DDisplay ref={live2dRef} />
      <div className="subtitles">...</div>
    </div>

    {/* 输入区域：语音按钮 + 输入框 + TTS 开关 */}
    <div className="chat-input-container">
      <VoiceInput
        onTranscribed={(text) => setInput(prev => prev + text)}
      />
      <input ... />
      <button className={`tts-toggle${ttsEnabled ? '' : ' off'}`} onClick={toggleTts}>
        {ttsEnabled ? '🔊' : '🔇'}
      </button>
    </div>
  </div>
)
```

### `ConfigPanel.jsx`

**功能：**
- 启动时调用 `api.getConfig()` 加载当前配置
- 展示 LLM / TTS / STT 三个 tab
- 每个 tab 显示：
  - 当前激活的 provider（下拉选择）
  - 当前激活 provider 的详细配置（api_key、model、base_url 等输入框）
  - 其他 provider 折叠展示（点击展开编辑）
- 底部"保存"按钮调用 `api.updateConfig()`
- api_key 输入框类型为 `password`，避免明文显示
- 未配置的 provider（api_key 为空）显示橙色警告图标

**注意**：
- GET 返回的 api_key 为 `"***"`，用户不修改时不回传（保持原值）
- 用户填入新 api_key 时才回传新值
- 实现一个简单的状态跟踪：哪些字段被修改过

### `VoiceInput.jsx`

```jsx
function VoiceInput({ onTranscribed }) {
  const [recording, setRecording] = useState(false)
  const mediaRecorderRef = useRef(null)
  const chunksRef = useRef([])

  const startRecording = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const mediaRecorder = new MediaRecorder(stream)
    chunksRef.current = []
    mediaRecorder.ondataavailable = (e) => chunksRef.current.push(e.data)
    mediaRecorder.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: "audio/webm" })
      const result = await api.transcribe(blob, "webm")
      if (result.text) onTranscribed(result.text)
      stream.getTracks().forEach(t => t.stop())
    }
    mediaRecorder.start()
    mediaRecorderRef.current = mediaRecorder
    setRecording(true)
  }

  const stopRecording = () => {
    mediaRecorderRef.current?.stop()
    setRecording(false)
  }

  return (
    <button
      className={`voice-btn ${recording ? "recording" : ""}`}
      onMouseDown={startRecording}
      onMouseUp={stopRecording}
      onTouchStart={startRecording}
      onTouchEnd={stopRecording}
      title="按住说话"
    >
      🎤
    </button>
  )
}
```

**交互设计**：按住录音，松开发送（Push-to-Talk 模式）

---

## UI 细节要求

**配置按钮**：固定在右上角，圆形，半透明背景

**配置面板**：
- 全屏遮罩 + 居中卡片
- 最大宽度 600px
- 有关闭按钮（右上角 ×）
- 保存时显示"保存中..."状态

**语音按钮**：
- 在输入框左侧
- 录音时变红色 + 轻微跳动动画
- 识别完成后文字自动填入输入框

**TTS 开关按钮**：
- 在输入框右侧，42x42 圆形按钮，与配置按钮风格一致
- 开启状态：🔊 图标，正常透明度
- 关闭状态：🔇 图标，降低透明度（`.tts-toggle.off`）
- 状态通过 `localStorage('ttsEnabled')` 持久化
- TTS 关闭时：后端跳过 TTS 合成，前端跳过 `playWithLipSync()`

**字幕流式效果**：
- 文字逐渐出现，有 0.1s 的 fade-in 过渡

---

## 约束

- 不修改 Live2D 相关逻辑
- ConfigPanel 保存操作只更新"已修改"的字段，不覆盖未修改字段的原始值
- VoiceInput 在浏览器不支持麦克风权限时静默失败，不显示组件（`return null`）

---

## 验收标准

- [ ] 发送消息后，字幕逐字出现（SSE 流式）
- [ ] 配置面板能正确显示当前配置（api_key 显示 `***`）
- [ ] 在配置面板切换 LLM provider 并保存，重新对话使用新 provider
- [ ] 按住麦克风按钮录音，松开后识别文字填入输入框
- [ ] 配置面板在移动端也能正常使用
- [ ] 录音按钮在未获得麦克风权限时不崩溃
