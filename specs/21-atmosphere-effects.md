# 21 — P1：粒子效果 + 氛围光 + BGM ✅

> **状态**：已实现

## 概述

在场景背景（spec-20）基础上，增加动态视觉效果和音频氛围层，提升沉浸感：
1. **粒子效果**：樱花（白天）、光斑（黄昏）、萤火虫（夜晚）
2. **氛围光效**：暗角 + 情绪色调叠加
3. **BGM**：日/夜背景音乐自动切换，crossfade 过渡

> 角色背光（Rim Light）未实现，暂不需要；环境音（鸟叫、风声等）后续按需追加。

---

## 实现文档

### 文件结构

| 文件 | 职责 |
|------|------|
| `frontend/src/utils/timeOfDay.js` | 共享时段判断函数，Background / Particles / BGM 复用 |
| `frontend/src/components/Particles.jsx` | 纯 CSS 粒子效果组件（20 个 `<span>`） |
| `frontend/src/components/MoodOverlay.jsx` | 表情→情绪映射，全屏色调叠层 |
| `frontend/src/audio/AudioManager.js` | 单例 BGM 管理器，crossfade + localStorage 持久化 |
| `frontend/public/audio/bgm/calm.mp3` | 日常 BGM（白天 + 黄昏） |
| `frontend/public/audio/bgm/night.mp3` | 夜间 BGM |
| `frontend/src/App.jsx` | 集成所有组件，管理 timeOfDay / expression / bgmMuted 状态 |
| `frontend/src/App.css` | 粒子动画、暗角、情绪 overlay、BGM 按钮样式 |
| `frontend/src/components/Background.jsx` | 改为 import 共享 `getTimeOfDay` |

### 粒子系统

- 通过 `timeOfDay` prop 映射粒子类型：`day→sakura`、`evening→sparkle`、`night→firefly`
- 20 个 `<span>` 粒子，`randomStyle(i)` 生成随机 top/left/duration/delay
- 纯 CSS `transform` + `opacity` 动画（GPU 加速）
- `@media (prefers-reduced-motion: reduce)` 时隐藏

### 情绪叠层

表情→情绪映射：

| 表情 | 情绪 | 色调 |
|------|------|------|
| 咪咪眼、爱心、吐舌 | happy | 暖黄 `rgba(255,220,100,0.08)` |
| 脸红 | shy | 浅红 `rgba(255,130,150,0.1)` |
| 眼泪、泪眼 | sad | 冷蓝 `rgba(100,140,200,0.1)` |
| 生气、黑脸、生气瘪嘴 | angry | 暗红 `rgba(200,60,60,0.08)` |
| 其他 | none | 透明 |

- 2s CSS transition 平滑切换
- 表情触发后 4s 自动消退（App.jsx useEffect）

### BGM 管理

- `AudioManager` 单例，管理 `Audio()` 实例
- `setTimeOfDay(time)`：day/evening → calm.mp3，night → night.mp3
- 切换时 2s crossfade（20 步 × 100ms 渐变）
- `toggle()` 切换静音，状态存 localStorage（`bgmMuted`）
- `tryAutoPlay()` 在首次用户交互时调用（复用 warmUp 调用点 + BGM 按钮点击）
- 默认音量 0.3

### 暗角效果

固定全屏 `.vignette` div，`radial-gradient` 从中心透明到四周半透明黑色，z-index: 3。

### z-index 层级

```
0  — .scene-background（场景图）
1  — .live2d-main（Live2D canvas）
2  — .particles（粒子层）
3  — .vignette（暗角）
4  — .mood-overlay（情绪色调）
10 — .dialogue-text-area / .dialogue-input-bar（对话框）
30 — 控制按钮（bgm-toggle、history-btn、config-btn）
50 — .dialogue-history（历史 overlay）
```

### BGM 按钮

- 位于右上角，history-btn 左侧（right: 124px）
- 样式复用 config-btn/history-btn 同一风格
- 图标：♫（开启）/ ♪（关闭），`.off` 时半透明
