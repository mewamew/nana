# 22 — UI 统一美化 + 情绪光效联动（已实现）

## 概述

将界面元素从 emoji + 基础样式升级为统一的设计语言，并实现角色背光与情绪的动态联动：
1. **图标系统统一**：emoji 按钮替换为 SVG 图标
2. **输入框装饰**：galgame 风格边框与交互效果
3. **情绪背光联动**：角色背光颜色随表情动态变化

---

## 一、图标系统统一（已实现）

### 1.1 图标组件

`frontend/src/components/icons/` 目录，6 个 SVG 图标组件：

```
frontend/src/components/icons/
├── index.js              # 统一导出
├── MicIcon.jsx           # 麦克风（矩形+弧线+底座）
├── SpeakerIcon.jsx       # 喇叭+声波弧线（TTS 开启）
├── SpeakerOffIcon.jsx    # 喇叭+X叉（TTS 关闭）
├── SettingsIcon.jsx      # 圆心+齿轮射线（设置）
├── MusicIcon.jsx         # 双音符+连杆（BGM 控制）
└── HistoryIcon.jsx       # 三横线列表（对话历史）
```

### 1.2 图标风格规范

- **线条风格**：`stroke="currentColor"` strokeWidth 1.5，strokeLinecap/strokeLinejoin round
- **颜色**：默认 `rgba(255, 255, 255, 0.7)`，hover 时 `#fff`，active 时 `#2FA4E7`
- **尺寸**：viewBox `0 0 20 20`，通过 `size` prop 控制实际大小
- **props**：所有图标接收 `size` + `className`

### 1.3 按钮组件

`frontend/src/components/IconButton.jsx`：

```jsx
function IconButton({ icon: Icon, label, active, className = '', onClick, ...props })
```

- 渲染 `<button className="icon-btn">` + `<Icon size={20} />`
- `active` prop 控制高亮状态
- `className` 叠加位置类（如 `btn-pos-config`）
- `...props` 透传给 button 元素
- VoiceInput 的麦克风按钮因有特殊 mouseDown/Up/touchStart/End 事件，直接使用 `<MicIcon>` 不走 IconButton

---

## 二、按钮布局（已实现）

### 2.1 右上角按钮组

4 个按钮固定在右上角，从左到右排列：

| 位置类 | right | 按钮 | 图标 |
|--------|-------|------|------|
| `.btn-pos-tts` | 176px | TTS 开关 | SpeakerIcon / SpeakerOffIcon |
| `.btn-pos-bgm` | 124px | BGM 开关 | MusicIcon |
| `.btn-pos-history` | 72px | 对话历史 | HistoryIcon |
| `.btn-pos-config` | 20px | 设置 | SettingsIcon |

所有按钮 `position: fixed; top: 20px; z-index: 30`。

### 2.2 输入栏按钮

仅保留麦克风按钮在输入栏内（VoiceInput 组件）。

### 2.3 统一按钮样式

```css
.icon-btn {
  width: 42px; height: 42px; border-radius: 50%;
  border: 1px solid rgba(255,255,255,0.15);
  background: rgba(0,0,0,0.4);
  backdrop-filter: blur(4px);
  color: rgba(255,255,255,0.7);
  transition: all 0.2s ease;
}
.icon-btn:hover  → 蓝色调背景 + 白色
.icon-btn.active → 蓝色高亮
.icon-btn.off    → 半透明
```

---

## 三、输入框装饰（已实现）

### 3.1 输入栏容器 `.dialogue-input-bar`

- `max-width: 600px`（从 960px 缩短）
- `background: linear-gradient(135deg, rgba(10,10,30,0.8), rgba(20,20,50,0.75))`
- `border: 1px solid rgba(47,164,231,0.2)`
- `box-shadow: 0 4px 20px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.05)`

### 3.2 焦点效果

```css
.dialogue-input-bar:focus-within {
  border-color: rgba(47,164,231,0.45);
  box-shadow: ... + 0 0 12px rgba(47,164,231,0.15);
}
```

### 3.3 四角装饰线

`::before`（左上）和 `::after`（右下）各绘制 12px L 型边框，颜色 `rgba(47,164,231,0.5)`。

### 3.4 输入框

```css
.chat-input       → border: rgba(255,255,255,0.08), background: rgba(255,255,255,0.05)
.chat-input:focus  → border-color: rgba(47,164,231,0.3), background: rgba(255,255,255,0.08)
::placeholder      → color: rgba(255,255,255,0.3)
```

---

## 四、情绪背光联动（已实现）

### 4.1 角色背光 (Rim Light)

`.app .live2d-main::after` 伪元素：
- 绝对定位，底部居中，宽 80%，高 60%
- `radial-gradient(ellipse, var(--rim-color) 0%, transparent 70%)`
- `transition: background 1.5s ease`
- `z-index: 0; pointer-events: none`

### 4.2 表情→颜色映射

`expressionToRimColor(expression)` 在 App.jsx 顶层定义：

| expression | 颜色 | 语义 |
|-----------|------|------|
| `shy` | `rgba(255, 130, 180, 0.2)` | 害羞→粉 |
| `angry` | `rgba(220, 60, 60, 0.18)` | 生气→红 |
| `sad` | `rgba(100, 140, 220, 0.18)` | 伤心→蓝 |
| `happy` | `rgba(255, 220, 100, 0.18)` | 开心→金 |
| 默认/null | `rgba(47, 164, 231, 0.15)` | 默认→淡蓝 |

通过 CSS 变量 `--rim-color` 设在根 div `<div className="app" style={{ '--rim-color': ... }}>`。

---

## 五、文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 新增 | `frontend/src/components/icons/MicIcon.jsx` | 麦克风图标 |
| 新增 | `frontend/src/components/icons/SpeakerIcon.jsx` | 喇叭图标 |
| 新增 | `frontend/src/components/icons/SpeakerOffIcon.jsx` | 喇叭关闭图标 |
| 新增 | `frontend/src/components/icons/SettingsIcon.jsx` | 齿轮图标 |
| 新增 | `frontend/src/components/icons/MusicIcon.jsx` | 音符图标 |
| 新增 | `frontend/src/components/icons/HistoryIcon.jsx` | 列表图标 |
| 新增 | `frontend/src/components/icons/index.js` | 统一 re-export |
| 新增 | `frontend/src/components/IconButton.jsx` | 统一按钮组件 |
| 修改 | `frontend/src/App.css` | icon-btn 样式、位置类、删旧按钮样式、输入框装饰、rim light |
| 修改 | `frontend/src/App.jsx` | 替换 4 个 emoji 按钮为 IconButton、rim light CSS 变量 |
| 修改 | `frontend/src/components/VoiceInput.jsx` | 🎤 → MicIcon |
| 修改 | `frontend/src/components/VoiceInput.css` | 对齐 icon-btn 风格 |

---

## 六、依赖

- **前置**：spec-20（层级系统）、spec-21（基础背光 + 情绪 overlay）
- **后端无改动**：本 spec 纯前端

---

## 七、验证（已通过）

1. 所有按钮显示 SVG 图标，hover 时颜色平滑变化
2. 输入框聚焦时边框发光，四角装饰线可见
3. 角色表情变化时背光颜色平滑过渡（1.5s）：害羞→粉、生气→红、默认→蓝
4. BGM/TTS 按钮 active/off 状态正确切换
5. 麦克风按钮录音/转写状态保持正常（红色脉动、蓝色等待）
6. TTS 按钮已移至右上角按钮组
7. 输入栏宽度缩短至 max-width 600px
8. `npm run build` 编译通过
