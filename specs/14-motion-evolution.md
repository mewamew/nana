# 14-motion-evolution — 动作自进化系统

**Status: 📋 Planned**

## 背景与目标

PinkFox 模型有 100+ 可控参数（头部、身体、面部、尾巴、兽耳等），但 `model3.json` 中没有注册任何动作（Motions），角色只能切换静态表情，缺乏肢体动态。

本 spec 建立一套 **LLM 驱动的动作生成 + 选择系统**：
- 预置 10 个种子动作
- LLM 回复时选择匹配的动作
- 当 LLM 选了库中不存在的动作名时，自动调 LLM 生成关键帧并缓存
- 动作库随对话积累自然增长，实现"自进化"

---

## 核心设计

### 简化关键帧格式

**不使用** Live2D 原生 `motion3.json`（贝塞尔曲线段，格式复杂、LLM 难以准确生成），改用简化 JSON，前端 `requestAnimationFrame` + `setParameterValueById` 线性插值播放：

```json
{
  "name": "点头",
  "description": "轻轻点头表示同意",
  "duration": 0.8,
  "tracks": [
    {
      "param": "HeadAngleY",
      "keyframes": [
        { "t": 0.0, "v": 0 },
        { "t": 0.3, "v": -8 },
        { "t": 0.6, "v": 2 },
        { "t": 0.8, "v": 0 }
      ]
    }
  ]
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | 动作名（中文，作为查找键） |
| `description` | string | 简要描述 |
| `duration` | float | 总时长（0.3 ~ 3.0 秒） |
| `tracks` | array | 每个元素驱动一个参数 |
| `tracks[].param` | string | Live2D 参数 ID |
| `tracks[].keyframes` | array | `{t, v}` 对，按 t 升序 |

**约束：**
- 首帧 `t` 必须为 0.0
- 末帧 `t` 必须等于 `duration`
- 末帧 `v` 必须等于首帧 `v`（回到静止位置）
- 每 track 最多 8 个关键帧
- 每动作最多 6 个 tracks
- 仅允许白名单中的参数 ID

### 与表情系统的关系

表情系统使用 `key2`~`key17` 参数（0/1 切换，控制预绘制表情图层）。动作系统使用 **完全不同** 的连续参数（头部角度、眼睛开闭、嘴型等），两者无冲突，可同时生效。

### 自进化流程

```
LLM 回复 JSON 新增 "motion": "动作名"
  → 后端查 motion_library.json
    → 存在：直接发 motion 事件
    → 不存在：调 LLM 生成关键帧 → 验证 → 存库 → 发事件
  → 前端 rAF 线性插值播放
```

---

## 文件边界

### 新增文件
| 文件 | 作用 |
|------|------|
| `backend/motion_library.py` | 动作库管理：存储、验证、LLM 生成、种子动作 |
| `backend/prompts/motion_generate.txt` | 动作生成 prompt 模板 |
| `frontend/src/hooks/useMotionPlayer.js` | requestAnimationFrame 关键帧插值播放器 |

### 修改文件
| 文件 | 改动 |
|------|------|
| `backend/prompts/reply.txt` | 输出格式新增 `"motion"` 字段 + `{motion_list}` 占位符 |
| `backend/main_agent.py` | 注入 motion_list、新增 `extract_motion()` |
| `backend/chat_service.py` | expression 事件之后发 motion 事件（查库 / 生成） |
| `frontend/src/api/client.js` | SSE switch 新增 `"motion"` case |
| `frontend/src/components/Live2DModel.jsx` | useImperativeHandle 新增 `setParameter(paramId, value)` |
| `frontend/src/App.jsx` | 接入 useMotionPlayer hook + onMotion 回调 |

### 运行时自动创建
| 文件 | 说明 |
|------|------|
| `save/motion_library.json` | 持久化动作库，初始含 10 个种子，随对话增长 |

### 不得修改
- `backend/main.py`（无需新端点，复用现有 `/api/chat` SSE 流）
- `backend/conversation.py`
- `backend/providers/` 下任何文件
- Live2D 模型文件（`frontend/public/models/`）

---

## 依赖

- Spec 01 (Provider Framework)：复用 LLM provider 进行动作生成
- Spec 08 (Agentic Loop)：动作选择集成到回复 prompt 中

---

## 参数白名单

仅以下参数可用于动作，均为连续值参数：

| 参数 ID | 名称 | 范围 | 静止值 |
|---------|------|------|--------|
| `HeadAngleX` | 头部左右 | [-30, 30] | 0 |
| `HeadAngleY` | 头部上下 | [-30, 30] | 0 |
| `HeadAngleZ` | 头部倾斜 | [-30, 30] | 0 |
| `ParamBodyAngleX` | 身体左右 | [-10, 10] | 0 |
| `ParamBodyAngleY` | 身体前后 | [-10, 10] | 0 |
| `ParamBodyAngleZ` | 身体倾斜 | [-10, 10] | 0 |
| `ParamEyeLOpen` | 左眼开闭 | [0, 1] | 1 |
| `ParamEyeROpen` | 右眼开闭 | [0, 1] | 1 |
| `ParamEyeLSmile` | 左眼微笑 | [0, 1] | 0 |
| `ParamEyeRSmile` | 右眼微笑 | [0, 1] | 0 |
| `ParamEyeBallX` | 眼珠左右 | [-1, 1] | 0 |
| `ParamEyeBallY` | 眼珠上下 | [-1, 1] | 0 |
| `ParamBrowLY` | 左眉上下 | [-1, 1] | 0 |
| `ParamBrowRY` | 右眉上下 | [-1, 1] | 0 |
| `ParamBrowLAngle` | 左眉角度 | [-1, 1] | 0 |
| `ParamBrowRAngle` | 右眉角度 | [-1, 1] | 0 |
| `ParamMouthForm` | 嘴型 | [-1, 1] | 0 |
| `ParamMouthOpenY` | 嘴巴开合 | [0, 1] | 0 |
| `CheekPuff2` | 鼓脸 | [0, 1] | 0 |
| `EyeSquint` | 眯眼 | [0, 1] | 0 |
| `Param62` | 噘嘴 | [0, 1] | 0 |
| `BunnyEarL1` | 左耳根部 | [-30, 30] | 0 |
| `BunnyEarR1` | 右耳根部 | [-30, 30] | 0 |
| `Param_Angle_Rotation_1_ArtMesh199` | 尾巴根部 | [-30, 30] | 0 |
| `ShoulderY` | 肩膀上下 | [-10, 10] | 0 |

---

## 实施方案

### Step 1: 动作库后端模块

**文件:** `backend/motion_library.py`

`MotionLibrary` 类（实例化为单例）：

```python
class MotionLibrary:
    LIBRARY_PATH = os.path.join(os.path.dirname(__file__), "..", "save", "motion_library.json")
```

**方法：**
- `get(name: str) -> dict | None` — 按名称查询
- `add(motion: dict) -> None` — 添加并持久化
- `list_names() -> list[str]` — 返回所有动作名（供 prompt 注入）
- `list_summary() -> str` — 格式化为 `"点头, 摇头, 歪头, ..."` 供 prompt 使用
- `validate(motion: dict) -> bool` — 校验格式、参数白名单、关键帧约束
- `generate_motion(name: str, description: str) -> dict | None` — 调 LLM 生成 → 自动修正 → 验证 → 存库
- `_fix_keyframe_constraints(motion: dict) -> None` — 自动修正常见 LLM 错误：首帧 t=0、末帧归零、值域裁剪、移除非白名单参数

**初始化逻辑：**
- 加载 `save/motion_library.json`，文件不存在时用 `SEED_MOTIONS` 常量初始化
- `SEED_MOTIONS` 内嵌 10 个种子动作（Python dict 常量）

### Step 2: 动作生成 Prompt

**文件:** `backend/prompts/motion_generate.txt`

```
你是一个Live2D动作设计师。根据动作名称生成关键帧数据。

## 动作名称
{motion_name}

## 可用参数
{param_reference}

## 输出格式（严格 JSON，不要包含其他文字）
{{"name":"{motion_name}","description":"...","duration":<秒>,"tracks":[...]}}

## 规则
1. 每个 track 最多 8 个关键帧，每个动作最多 6 个 tracks
2. 首帧 t=0.0，末帧 t=duration，末帧 v 必须等于首帧 v
3. v 必须在参数范围内
4. duration 在 0.5~2.0 秒之间（复杂动作可到 3.0）
5. 注意左右对称（双眼、双眉应同步变化）
6. 动作要自然流畅
```

`{param_reference}` 由 MotionLibrary 根据白名单自动格式化，形如：
```
HeadAngleX (头部左右, -30~30, 静止=0)
HeadAngleY (头部上下, -30~30, 静止=0)
...
```

### Step 3: 回复 Prompt 增加 motion 字段

**文件:** `backend/prompts/reply.txt`

输出格式从：
```json
{"reply": "...", "user_info": "...", "expression": "..."}
```
改为：
```json
{"reply": "...", "user_info": "...", "expression": "...", "motion": "..."}
```

新增 prompt 段落：
```
## 动作
从以下动作中选一个配合你的回复（不需要时留空字符串）：
{motion_list}
也可以自己起一个新动作名（2-4个中文字），系统会自动学习生成。
```

> **注意：** CONVENTIONS.md 第 5 节规定"不得修改 prompts/reply.txt"。本 spec 作为功能扩展，需要在 reply.txt 中新增 motion 相关字段，属于必要的格式升级。实施时应同步更新 CONVENTIONS.md 将此约束标记为"已被 spec-14 扩展"。

### Step 4: 后端流程串联

**文件:** `backend/main_agent.py`

- 构造函数中实例化 `MotionLibrary`
- `reply_stream()` 格式化 prompt 时注入 `{motion_list}` = `self.motion_library.list_summary()`
- 新增 `extract_motion(full_text: str) -> str | None`：从 LLM JSON 输出解析 motion 字段

**文件:** `backend/chat_service.py`

SSE 事件流顺序变为：text (多次) → expression (1次) → **motion (0~1次)** → audio (0~1次) → done

```python
# motion 处理（在 expression 之后、TTS 之前）
motion_name = self.main_agent.extract_motion(full_text)
if motion_name:
    motion_data = self.motion_library.get(motion_name)
    if not motion_data:
        # 库中不存在，调 LLM 生成（首次 ~1-2s，之后永久缓存）
        motion_data = await self.motion_library.generate_motion(
            motion_name, f"角色做出'{motion_name}'的动作"
        )
    if motion_data:
        yield {"type": "motion", "content": json.dumps(motion_data, ensure_ascii=False)}
```

生成失败时静默跳过，不影响主流程（expression 和 audio 正常发送）。

### Step 5: 前端关键帧播放器

**新文件:** `frontend/src/hooks/useMotionPlayer.js`

自定义 hook，基于 `requestAnimationFrame` 实现关键帧线性插值：

```javascript
export default function useMotionPlayer(live2dRef) {
    // playMotion(motionJson) — 解析 JSON，启动 rAF 循环
    // stopMotion() — 取消当前动画
    // 线性插值：根据 elapsed time 在相邻关键帧间 lerp
    // 动画结束后自动将所有参数归位到末帧值
    // 新动作到来时打断旧动作
}
```

**关键函数：**
- `interpolate(keyframes, t)` — 在关键帧数组中找到当前时间 t 对应的两个关键帧，线性插值
- 每帧通过 `live2dRef.current.setParameter(paramId, value)` 设值

**文件:** `frontend/src/components/Live2DModel.jsx`

`useImperativeHandle` 新增通用参数设置方法：

```javascript
setParameter: (paramId, value) => {
    if (!modelRef.current) return
    modelRef.current.internalModel.coreModel.setParameterValueById(paramId, value)
}
```

### Step 6: 前端事件对接

**文件:** `frontend/src/api/client.js`

SSE switch 新增：
```javascript
case "motion":
    onMotion?.(parsed.content)
    break
```

`chatStream` 回调签名扩展为 `{ onText, onExpression, onMotion, onAudio, onDone, onError }`。

**文件:** `frontend/src/App.jsx`

```javascript
import useMotionPlayer from './hooks/useMotionPlayer'

// 在 App 组件内：
const { playMotion } = useMotionPlayer(live2dRef)

// chatStream 回调新增：
onMotion: (motionJson) => playMotion(motionJson)
```

---

## 种子动作列表

初始预置 10 个动作，覆盖常见情感场景：

| 名称 | 主要参数 | 时长 | 场景 |
|------|---------|------|------|
| 点头 | HeadAngleY | 0.8s | 同意、理解 |
| 摇头 | HeadAngleX | 1.0s | 不同意、无奈 |
| 歪头 | HeadAngleZ + EyeBallX | 0.8s | 好奇、疑问 |
| 眨眼 | EyeLOpen + EyeROpen | 0.4s | 俏皮 |
| 鼓脸 | CheekPuff2 + BrowL/RY | 1.5s | 生气、撒娇 |
| 竖耳 | BunnyEarL1 + BunnyEarR1 | 0.8s | 注意、好奇 |
| 摇尾巴 | Tail Rotation 1 | 1.2s | 开心 |
| 微笑 | EyeL/RSmile + MouthForm | 1.2s | 温柔 |
| 害羞 | HeadAngleY/Z + EyeBallY + ShoulderY | 1.5s | 害羞、不好意思 |
| 不满 | HeadAngleX + BrowL/RAngle + Param62 | 1.2s | 不高兴、嫌弃 |

---

## 边界情况

| 场景 | 处理 |
|------|------|
| LLM 生成的 JSON 格式错误 | `_fix_keyframe_constraints` 自动修正 → 仍失败则静默跳过 |
| LLM 回复中 motion 字段为空 | 不发 motion 事件，正常流程 |
| 动作生成延迟（~1-2s） | 仅首次生成时有延迟，永久缓存后瞬时返回 |
| 动作库文件损坏 | 加载失败时从种子动作重建 |
| 动作与 lip-sync 冲突 | 动作事件在 audio 之前发送，时序上自然错开；若未来需要，可排除 ParamMouthOpenY |
| 多个动作快速触发 | 新动作打断旧动作（cancelAnimationFrame） |

---

## 验证方法

1. 启动后端 + 前端，发消息观察是否返回 motion 事件
2. 角色播放种子动作（如点头、摇尾巴），动画流畅无闪烁
3. 发送消息触发 LLM 选择库中不存在的动作名 → 后端日志输出 "新动作已生成" → `save/motion_library.json` 新增记录
4. 重启后端，同一动作名直接从缓存返回（无生成延迟）
5. 表情（静态 key 切换）和动作（参数动画）同时生效、互不干扰
6. 动作结束后参数自动归位，不影响后续表情和动作
