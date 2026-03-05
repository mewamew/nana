# 17-mocap-motion-recording — 真人动捕录制动作系统

**Status: 🚧 Phase 1 Done（录制工具 + 手部追踪已实现）**

## 背景

spec 14 的 LLM 生成关键帧方案效果僵硬（LLM 无法理解参数与视觉的映射），已移除。本 spec 采用全新思路：**用摄像头捕捉真人动作，录制为 Live2D 原生 motion3.json，实现自然的动作库**。

核心洞察：Live2D 本就是 VTuber 技术栈，面部/身体追踪 → 参数驱动是成熟方案。我们只需把「实时驱动」变成「录制回放」。

---

## 技术架构

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   摄像头     │────▶│  MediaPipe        │────▶│  参数映射        │
│  (getUserMedia)    │  FaceLandmarker   │     │  blendshapes →   │
│             │     │  + PoseLandmarker │     │  Live2D params   │
└─────────────┘     └──────────────────┘     └────────┬────────┘
                                                       │
                                          ┌────────────▼────────────┐
                                          │  实时预览（PinkFox 模型）  │
                                          │  + 录制器（30fps 采样）   │
                                          └────────────┬────────────┘
                                                       │ 导出
                                                       ▼
                                              motion3.json 文件
                                           （SDK 原生格式，直接播放）
```

---

## 技术选型

### MediaPipe（追踪）

使用 `@mediapipe/tasks-vision`（新版 API），**不用 Kalidokit**（已废弃）。

- **FaceLandmarker**：输出 52 个 ARKit 兼容 blendshapes（`eyeBlinkLeft`、`jawOpen`、`mouthSmileLeft` 等），直接是 0-1 数值，无需从 landmark 坐标计算
- **PoseLandmarker**：33 个身体关键点，用于提取上半身姿态（肩膀角度、身体倾斜）

关键优势：新 API 的 blendshapes 是预计算的高质量结果，比 Kalidokit 从原始 landmark 手动解算更准确。

### motion3.json（输出格式）

Live2D 原生动作格式，SDK 内置播放器自带插值、淡入淡出、优先级混合。

---

## Phase 1：录制工具

### 新增文件

```
frontend/src/components/MotionRecorder.jsx   # 录制工具主组件
frontend/src/hooks/useFaceTracking.js        # MediaPipe 追踪 hook
frontend/src/utils/motion3Export.js          # motion3.json 导出工具
```

### 录制工具 UI

独立页面（开发工具，不在主界面出入口），通过 URL hash `#recorder` 进入：

```
┌──────────────────────────────────────────────────┐
│  [摄像头画面]          │  [PinkFox 实时预览]       │
│  (带 landmark 叠加)    │  (追踪驱动)              │
│                        │                          │
├──────────────────────────────────────────────────┤
│  动作名: [____点头____]                            │
│  [● 录制]  [■ 停止]  [▶ 预览]  [💾 保存]          │
│  时长: 0:00 / 最长 5s           状态: 待命         │
└──────────────────────────────────────────────────┘
```

### 录制流程

1. 打开页面，授权摄像头
2. MediaPipe 实时追踪，PinkFox 模型同步动作（预览效果）
3. 输入动作名（如「点头」「摇头」「挥手」）
4. 点击录制 → 30fps 采样所有驱动参数的当前值
5. 点击停止（或自动 5 秒截断）
6. 预览：回放录制的参数序列
7. 保存：导出为 motion3.json，下载到本地

### 追踪参数映射

#### 面部（FaceLandmarker blendshapes → PinkFox 参数）

| ARKit Blendshape | PinkFox 参数 | 转换 |
|---|---|---|
| `eyeBlinkLeft` | `ParamEyeLOpen` | `1 - value` |
| `eyeBlinkRight` | `ParamEyeROpen` | `1 - value` |
| `eyeSquintLeft` + `eyeSquintRight` | `EyeSquint` | `avg * 30` |
| `eyeLookInLeft` - `eyeLookOutLeft` | `ParamEyeBallX` | 映射到 ±1 |
| `eyeLookUpLeft` - `eyeLookDownLeft` | `ParamEyeBallY` | 映射到 ±1 |
| `browDownLeft` | `ParamBrowLY` | `-(value * 30)` |
| `browDownRight` | `ParamBrowRY` | `-(value * 30)` |
| `browInnerUp` | `ParamBrowLAngle`, `ParamBrowRAngle` | `value * 30` |
| `jawOpen` | `ParamMouthOpenY` | 直接映射 |
| `mouthSmileLeft` + `mouthSmileRight` | `ParamMouthForm` | `avg` |
| `mouthPucker` | `Param62` | `value * 30` |
| `cheekPuff` | `CheekPuff2` | `value * 30` |
| `mouthShrugLower` | `MouthShrugLower` | `value * 30` |

#### 头部旋转（FaceLandmarker facialTransformationMatrixes）

| 来源 | PinkFox 参数 | 说明 |
|---|---|---|
| rotation.yaw | `ParamAngleX` | 左右转头（±30） |
| rotation.pitch | `ParamAngleY` | 上下点头（±30） |
| rotation.roll | `ParamAngleZ` | 歪头（±30） |
| rotation.yaw × 0.3 | `ParamBodyAngleX` | 身体跟随（衰减） |
| rotation.pitch × 0.3 | `ParamBodyAngleY` | 身体跟随（衰减） |

#### 手部（PoseLandmarker → 手臂参数）✅ 已实现

通过 PoseLandmarker (lite, GPU) 从肩/肘/腕/食指关键点计算手臂姿态：

| 来源 | PinkFox 参数 | 说明 |
|---|---|---|
| segmentAngle(shoulder, elbow) | `Param33` / `Param37` | 左/右整臂上下（上臂偏转角）|
| bendAngle(shoulder, elbow, wrist) | `Param34` / `Param38` | 左/右前臂弯曲（肘关节角）|
| wrist→index 相对前臂偏转 | `Param35` / `Param39` | 左/右手腕弯曲 |
| wrist→index 的 Y 分量 | `Param36` / `Param40` | 左/右手指朝向 |

实现细节：
- 镜像处理：左手 x 方向取反
- EMA 平滑：alpha=0.25（比面部更重，抑制 pose 抖动）
- 死区过滤：变化量 < 0.05 时不更新，消除静止微抖
- 降级：无 pose 结果时手部参数不写入，面部录制不受影响

---

## Phase 2：动作管理

### 文件存放

录制好的 motion3.json 放入模型目录：

```
frontend/public/models/PinkFox/
├── PinkFox.model3.json        # 注册 motions
├── motions/
│   ├── nod.motion3.json       # 点头
│   ├── shake.motion3.json     # 摇头
│   ├── tilt.motion3.json      # 歪头
│   ├── wave.motion3.json      # 挥手
│   ├── shy.motion3.json       # 害羞缩
│   └── ...
```

### 注册到 model3.json

在 PinkFox.model3.json 的 `FileReferences.Motions` 中注册：

```json
{
  "FileReferences": {
    "Motions": {
      "nod":   [{ "File": "motions/nod.motion3.json",   "FadeInTime": 0.3, "FadeOutTime": 0.5 }],
      "shake": [{ "File": "motions/shake.motion3.json", "FadeInTime": 0.3, "FadeOutTime": 0.5 }],
      "wave":  [{ "File": "motions/wave.motion3.json",  "FadeInTime": 0.3, "FadeOutTime": 0.5 }],
      "shy":   [{ "File": "motions/shy.motion3.json",   "FadeInTime": 0.3, "FadeOutTime": 0.5 }]
    }
  }
}
```

### 播放方式

注册后直接用 SDK 原生 API，**不需要自定义播放器**：

```js
// Live2DModel.jsx 中暴露方法
model.motion('nod')           // 播放点头
model.motion('wave', 0, 2)    // 播放挥手（FORCE 优先级）
```

---

## Phase 3：对话联动

### 后端 prompt 改动

在 `reply.md` 中加回动作选择（仅从固定列表选，不允许自创）：

```markdown
## 动作

从以下动作中选一个配合你的回复（不需要时留空字符串）：
点头, 摇头, 歪头, 挥手, 害羞缩, ...

只能从以上列表选择，不允许自创。
```

### SSE 事件恢复

`chat_service.py` 重新加入 motion 事件（简化版，只传动作名）：

```python
motion_name = self.main_agent.extract_motion(full_text)
if motion_name:
    yield {"type": "motion", "content": motion_name}
```

### 前端播放

```js
onMotion: (motionName) => {
  live2dRef.current?.playMotion(motionName)
}

// Live2DModel.jsx
playMotion: (name) => {
  if (!modelRef.current) return
  modelRef.current.motion(name, 0, 2)  // FORCE 优先级
}
```

对比 spec 14：不再传关键帧 JSON，只传动作名字符串，前端不再需要自定义播放器。

---

## motion3.json 导出格式

录制器输出的标准格式：

```json
{
  "Version": 3,
  "Meta": {
    "Duration": 1.5,
    "Fps": 30,
    "Loop": false,
    "CurveCount": 8,
    "TotalSegmentCount": 360,
    "TotalPointCount": 720,
    "FadeInTime": 0.3,
    "FadeOutTime": 0.5
  },
  "Curves": [
    {
      "Target": "Parameter",
      "Id": "ParamAngleX",
      "Segments": [0, 0, 0, 0.033, 2.1, 0, 0.066, 5.3, ...]
    },
    {
      "Target": "Parameter",
      "Id": "ParamAngleY",
      "Segments": [0, 0, 0, 0.033, -3.2, 0, 0.066, -8.1, ...]
    }
  ]
}
```

Segments 编码规则：
- 首帧：`[t0, v0]`（初始点）
- 后续帧：`[0, t, v]`（0 = 线性插值标识）
- 例：`[0, 0, 0, 0.033, 5, 0, 0.066, 10]` = 在 t=0 值为 0，线性过渡到 t=0.033 值为 5，再线性过渡到 t=0.066 值为 10

---

## 建议录制的种子动作（10 组，含手部）

录制建议：每个动作 2-3 秒，动作幅度稍大，先静止起手 → 动作 → 回到静止（方便循环过渡）。需保持上半身在画面中。

| # | 动作名 | 面部 | 手部 | 用途 |
|---|--------|------|------|------|
| 1 | 打招呼 | 微笑，眼睛睁大 | 右手举起摇摆 | 开场/问候 |
| 2 | 开心大笑 | 大笑嘴张开，眯眼 | 双手微抬 | 收到夸奖/开心时 |
| 3 | 害羞 | 微笑，眼睛下看 | 双手举到脸旁 | 被夸奖/害羞场景 |
| 4 | 思考中 | 嘴微闭，眼看左上 | 右手抬到下巴附近 | 处理问题/加载时 |
| 5 | 生气鼓腮 | 鼓腮，皱眉，嘟嘴 | 双手放下握拳姿态 | 被惹恼/撒娇 |
| 6 | 惊讶 | 嘴大张，眼睁大 | 双手快速举起 | 意外事件/吓一跳 |
| 7 | 困倦打哈欠 | 嘴大张再合上，眯眼 | 右手举到嘴旁 | 闲置过久/深夜 |
| 8 | 点头同意 | 头上下点，微笑 | 手自然垂放 | 确认/回应用户 |
| 9 | 摇头拒绝 | 头左右摇，嘟嘴 | 右手左右摆 | 拒绝/不同意 |
| 10 | 再见挥手 | 微笑，微侧头 | 右手举起慢摆 | 结束对话/告别 |

---

## 依赖

```
@mediapipe/tasks-vision    # 面部+身体追踪（~5MB WASM）
```

不需要 Kalidokit（已废弃），不需要 Cubism Editor（免费方案）。

---

## 实现顺序

1. ~~**Phase 1**：录制工具（`useFaceTracking` + `RecorderPage` + `motion3Export`）~~ ✅
2. ~~手部追踪：PoseLandmarker → Param33-40 映射~~ ✅
3. 用录制工具录制 10 个种子动作 ⬅️ **下一步**
3. **Phase 2**：动作管理（放入 motions/ 目录，注册到 model3.json）
4. **Phase 3**：对话联动（prompt + SSE + 前端播放）
