# 09-lip-sync — 口型同步

**Status: ✅ Implemented (2026-03-04)**

## 背景与目标

当前 TTS 播放语音时，Live2D 模型嘴巴不动，表现力不足。

本 spec 为语音播放加入**实时口型同步**：通过 Web Audio API 分析音频音量，驱动 Live2D 模型的 `ParamMouthOpenY` 参数，实现说话时嘴巴随音量张合。

纯前端改动，不涉及后端。

---

## 文件边界

### 新建文件
- `frontend/src/hooks/useLipSync.js`：口型同步 Hook

### 修改文件
- `frontend/src/components/Live2DModel.jsx`：暴露 `setMouthOpenY(value)` 方法
- `frontend/src/App.jsx`：用 `playWithLipSync()` 替代 `playAudio()`

### 不得修改
- `backend/` 下任何文件
- `Live2DModel.jsx` 中 Live2D 初始化和渲染逻辑（仅在 `useImperativeHandle` 中新增方法）
- 不引入任何新 npm 依赖

---

## 依赖

无（独立于其他 spec）

---

## 接口契约

### `useLipSync` Hook

```javascript
// frontend/src/hooks/useLipSync.js

/**
 * @param {Object} options
 * @param {Function} options.onMouthValue - 每帧回调，参数为 0~1 的张嘴程度
 * @returns {{ playWithLipSync: (audioBase64: string) => void, stopLipSync: () => void }}
 */
export function useLipSync({ onMouthValue }) {
  // 内部维护 AudioContext + AnalyserNode
  // playWithLipSync: base64 → ArrayBuffer → AudioBufferSourceNode → 播放 + rAF 循环
  // rAF 循环中: analyser.getByteFrequencyData → 计算平均音量 → 归一化到 0~1 → onMouthValue(value)
  // 音频结束时: onMouthValue(0) + 停止 rAF
}
```

### `Live2DModel.jsx` 新增暴露方法

```javascript
useImperativeHandle(ref, () => ({
  // ... 现有方法保持不变

  setMouthOpenY: (value) => {
    // value: 0~1，0 = 闭嘴，1 = 张嘴最大
    if (!modelRef.current) return
    const coreModel = modelRef.current.internalModel.coreModel
    coreModel.setParameterValueById("ParamMouthOpenY", value)
  }
}))
```

### `App.jsx` 集成

```javascript
// 引入 Hook
import { useLipSync } from './hooks/useLipSync'

// 在 App 组件内
const { playWithLipSync, stopLipSync } = useLipSync({
  onMouthValue: (value) => {
    if (live2dRef.current) live2dRef.current.setMouthOpenY(value)
  }
})

// onAudio 回调中替换
onAudio: (audioBase64) => {
  playWithLipSync(audioBase64)  // 替代原有的 playAudio(audioBase64)
}
```

---

## 实现要求

### `useLipSync.js` 核心逻辑

```javascript
export function useLipSync({ onMouthValue }) {
  const audioCtxRef = useRef(null)
  const rafIdRef = useRef(null)
  const sourceRef = useRef(null)

  // 懒初始化 AudioContext（避免浏览器自动播放策略问题）
  function getAudioContext() {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)()
    }
    return audioCtxRef.current
  }

  function stopLipSync() {
    if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current)
    if (sourceRef.current) {
      try { sourceRef.current.stop() } catch {}
    }
    onMouthValue(0)
  }

  async function playWithLipSync(audioBase64) {
    stopLipSync()

    const ctx = getAudioContext()
    if (ctx.state === "suspended") await ctx.resume()

    // base64 → ArrayBuffer
    const binary = atob(audioBase64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const audioBuffer = await ctx.decodeAudioData(bytes.buffer)

    // 构建音频图: source → analyser → destination
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 256
    const dataArray = new Uint8Array(analyser.frequencyBinCount)

    const source = ctx.createBufferSource()
    source.buffer = audioBuffer
    source.connect(analyser)
    analyser.connect(ctx.destination)
    sourceRef.current = source

    // rAF 循环
    function tick() {
      analyser.getByteFrequencyData(dataArray)
      // 计算低频段平均音量（人声主要集中在低频）
      const slice = dataArray.slice(0, 32)
      const avg = slice.reduce((sum, v) => sum + v, 0) / slice.length
      const normalized = Math.min(avg / 128, 1.0)  // 归一化到 0~1
      onMouthValue(normalized)
      rafIdRef.current = requestAnimationFrame(tick)
    }

    source.onended = () => {
      cancelAnimationFrame(rafIdRef.current)
      onMouthValue(0)
    }

    source.start()
    tick()
  }

  // 清理
  useEffect(() => {
    return () => {
      stopLipSync()
      if (audioCtxRef.current) audioCtxRef.current.close()
    }
  }, [])

  return { playWithLipSync, stopLipSync }
}
```

### 关键参数

| 参数 | 值 | 说明 |
|------|-----|------|
| `fftSize` | 256 | 频率分析精度，256 足够且性能好 |
| 低频采样范围 | `dataArray[0:32]` | 人声基频主要在 85-300Hz |
| 归一化除数 | 128 | `Uint8Array` 最大值 255，取一半作为阈值使嘴巴更灵敏 |
| `ParamMouthOpenY` | PinkFox 模型已验证存在 | 值域 0~1 |

---

## 关键设计决策

| 问题 | 决策 |
|------|------|
| 使用 Web Audio API 还是 MediaRecorder | Web Audio API（AnalyserNode 专为此设计） |
| 是否需要 Viseme 映射 | 不需要，音量驱动的简单方案效果已足够 |
| AudioContext 何时创建 | 懒初始化，首次播放时创建（符合浏览器策略） |
| TTS 未配置时的行为 | 无影响，`onAudio` 不会被调用 |
| 原有 `playAudio` 函数 | 可保留或删除，替换为 `playWithLipSync` 后不再需要 |

---

## 验收标准

- [x] TTS 语音播放时，Live2D 模型嘴巴随音量实时张合
- [x] 语音结束后嘴巴自动闭合（`ParamMouthOpenY` 归零）
- [x] 无 TTS 时（TTS 未配置），行为与当前完全一致，无报错
- [x] `Live2DModel.jsx` 原有的表情和跟踪功能不受影响
- [x] 多次快速发送消息时，旧音频被正确停止，不会出现多个音频重叠
- [ ] ~~不引入任何新 npm 依赖~~ → 实际引入了 `wlipsync` 包，用于更精准的音素识别（见下方备注）

---

## 实现备注（与 Spec 的差异）

实际实现使用了 **wLipSync** 而非简单的 `AnalyserNode` 方案：
- 引入 `wlipsync` npm 包，通过 `wlipsync-profile.json` 做日语音素识别
- 口型值基于 `node.volume` + `node.weights`（A/E/I/O/U/S）计算，比纯音量更准确

---

## 调优记录

### 口型幅度增强（2026-03-04）

初始接入后嘴巴动幅不够明显，对 `useLipSync.js` 顶部常量做如下调整：

| 参数 | 旧值 | 新值 | 原因 |
|------|------|------|------|
| `VOLUME_SCALE` | `0.9` | `3.0` | wLipSync volume 值偏小，主要放大杠杆 |
| `VOLUME_EXPONENT` | `0.7` | `0.5` | 幂函数更凸，中低音量段幅度更大 |
| `CAP` | `0.7` | `1.0` | 去掉人为上限，允许嘴张到最大 |
| `LERP_WINDOW_MS` | `120` | `80` | 平滑窗口缩短，跟音节节奏更贴紧 |
