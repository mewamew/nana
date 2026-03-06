# 22 — P2：UI 统一美化 + 情绪光效联动

## 概述

将界面元素从 emoji + 基础样式升级为统一的设计语言，并实现角色背光与情绪的动态联动：
1. **图标系统统一**：emoji 按钮替换为 SVG 图标
2. **输入框装饰**：galgame 风格边框与交互效果
3. **情绪背光联动**：角色背光颜色随表情动态变化

---

## 一、图标系统统一

### 1.1 当前问题

现有 UI 使用 emoji 作为按钮图标（⚙️🔊🔇🎤），存在问题：
- 不同操作系统/浏览器渲染不一致
- 无法精确控制颜色和大小
- 与整体 galgame 美术风格不搭

### 1.2 图标方案

使用内联 SVG 组件，不引入图标库（保持轻量）。

新增 `frontend/src/components/icons/` 目录：

```
frontend/src/components/icons/
├── index.js              # 统一导出
├── MicIcon.jsx           # 麦克风
├── SpeakerIcon.jsx       # 喇叭（TTS 开启）
├── SpeakerOffIcon.jsx    # 喇叭关闭（TTS 关闭）
├── SettingsIcon.jsx      # 齿轮（设置）
├── MusicIcon.jsx         # 音符（BGM 控制，配合 spec-21）
└── HistoryIcon.jsx       # 回看（对话历史，配合 spec-20）
```

### 1.3 图标风格规范

- **线条风格**：细线描边（stroke-width: 1.5-2），不填充
- **颜色**：默认 `rgba(255, 255, 255, 0.7)`，hover 时 `#fff`
- **尺寸**：统一 20x20 viewBox，通过 CSS 控制实际大小
- **过渡**：hover/active 状态 0.2s ease 过渡

示例：

```jsx
function MicIcon({ size = 20, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20"
         fill="none" stroke="currentColor" strokeWidth="1.5"
         className={className}>
      <rect x="7" y="2" width="6" height="10" rx="3" />
      <path d="M4 9a6 6 0 0 0 12 0" />
      <line x1="10" y1="15" x2="10" y2="18" />
      <line x1="7" y1="18" x2="13" y2="18" />
    </svg>
  );
}
```

### 1.4 按钮组件统一

新增 `frontend/src/components/IconButton.jsx`：

```jsx
function IconButton({ icon: Icon, label, active, onClick, ...props }) {
  return (
    <button
      className={`icon-btn ${active ? 'active' : ''}`}
      onClick={onClick}
      title={label}
      {...props}
    >
      <Icon size={20} />
    </button>
  );
}
```

```css
.icon-btn {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(4px);
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.icon-btn:hover {
  background: rgba(47, 164, 231, 0.2);
  border-color: rgba(47, 164, 231, 0.4);
  color: #fff;
}

.icon-btn.active {
  background: rgba(47, 164, 231, 0.3);
  border-color: rgba(47, 164, 231, 0.5);
  color: #2FA4E7;
}
```

---

## 二、输入框装饰

### 2.1 设计目标

输入框从纯功能性样式升级为 galgame 风格，增加装饰感但不影响易用性。

### 2.2 样式升级

```css
.chat-input-container {
  /* 保持现有定位不变 */
  background: linear-gradient(
    135deg,
    rgba(10, 10, 30, 0.8) 0%,
    rgba(20, 20, 50, 0.75) 100%
  );
  border: 1px solid rgba(47, 164, 231, 0.2);
  border-radius: 12px;
  backdrop-filter: blur(12px);
  box-shadow:
    0 4px 20px rgba(0, 0, 0, 0.3),
    inset 0 1px 0 rgba(255, 255, 255, 0.05);
}

/* 输入框获得焦点时，容器边框发光 */
.chat-input-container:focus-within {
  border-color: rgba(47, 164, 231, 0.5);
  box-shadow:
    0 4px 20px rgba(0, 0, 0, 0.3),
    0 0 15px rgba(47, 164, 231, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.05);
}

.chat-input {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  color: #fff;
  font-size: 15px;
  padding: 10px 14px;
  transition: border-color 0.2s ease;
}

.chat-input:focus {
  outline: none;
  border-color: rgba(47, 164, 231, 0.3);
  background: rgba(255, 255, 255, 0.08);
}

.chat-input::placeholder {
  color: rgba(255, 255, 255, 0.3);
}
```

### 2.3 装饰性角标（可选）

在输入框容器的四角添加微小的装饰线条，增加 galgame 文本框质感：

```css
.chat-input-container::before,
.chat-input-container::after {
  content: '';
  position: absolute;
  width: 12px;
  height: 12px;
  border-color: rgba(47, 164, 231, 0.3);
  border-style: solid;
  pointer-events: none;
}

.chat-input-container::before {
  top: -1px;
  left: -1px;
  border-width: 1px 0 0 1px;
  border-radius: 4px 0 0 0;
}

.chat-input-container::after {
  bottom: -1px;
  right: -1px;
  border-width: 0 1px 1px 0;
  border-radius: 0 0 4px 0;
}
```

---

## 三、情绪背光联动

### 3.1 扩展 spec-21 的角色背光

spec-21 定义了静态的蓝色背光。本 spec 将其升级为情绪驱动的动态背光：

| 表情类别 | 背光颜色 | 示例表情 |
|---------|---------|---------|
| 默认 | 淡蓝 `rgba(47, 164, 231, 0.15)` | 死鱼眼、nn眼 |
| 开心 | 暖橙 `rgba(255, 200, 100, 0.15)` | 咪咪眼、吐舌 |
| 害羞/爱情 | 粉红 `rgba(255, 150, 180, 0.18)` | 脸红、爱心 |
| 伤心 | 冷蓝 `rgba(100, 150, 255, 0.15)` | 眼泪、泪眼 |
| 生气 | 暗红 `rgba(255, 80, 80, 0.12)` | 生气、黑脸、生气瘪嘴 |
| 俏皮 | 金色 `rgba(255, 220, 50, 0.12)` | 嘟嘴、钱钱眼 |

### 3.2 实现

通过 CSS 变量在 App 层根据当前表情设置背光颜色：

```jsx
// App.jsx
const rimColor = expressionToRimColor(currentExpression);

<div className="app" style={{ '--rim-color': rimColor }}>
```

```css
.live2d-main::after {
  background: radial-gradient(
    ellipse,
    var(--rim-color, rgba(47, 164, 231, 0.15)) 0%,
    transparent 70%
  );
  transition: background 1.5s ease;
}
```

### 3.3 表情到颜色的映射函数

```javascript
function expressionToRimColor(expression) {
  const map = {
    '咪咪眼': 'rgba(255, 200, 100, 0.15)',
    '吐舌':   'rgba(255, 200, 100, 0.15)',
    '脸红':   'rgba(255, 150, 180, 0.18)',
    '爱心':   'rgba(255, 150, 180, 0.18)',
    '眼泪':   'rgba(100, 150, 255, 0.15)',
    '泪眼':   'rgba(100, 150, 255, 0.15)',
    '生气':   'rgba(255, 80, 80, 0.12)',
    '黑脸':   'rgba(255, 80, 80, 0.12)',
    '生气瘪嘴': 'rgba(255, 80, 80, 0.12)',
    '嘟嘴':   'rgba(255, 220, 50, 0.12)',
    '钱钱眼': 'rgba(255, 220, 50, 0.12)',
  };
  return map[expression] || 'rgba(47, 164, 231, 0.15)';
}
```

---

## 四、文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 新增 | `frontend/src/components/icons/*.jsx` | SVG 图标组件（6-7 个） |
| 新增 | `frontend/src/components/IconButton.jsx` | 统一按钮组件 |
| 修改 | `frontend/src/App.jsx` | 替换 emoji 按钮、集成情绪背光 |
| 修改 | `frontend/src/App.css` | 按钮样式、输入框装饰、背光变量 |
| 修改 | `frontend/src/components/VoiceInput.jsx` | 使用 MicIcon 替换 emoji |
| 修改 | `frontend/src/components/ConfigPanel.jsx` | 使用 SettingsIcon 替换 emoji |

---

## 五、依赖

- **前置**：spec-20（层级系统）、spec-21（基础背光 + 情绪 overlay）
- **后端无改动**：本 spec 纯前端

---

## 六、验证

1. 所有按钮（麦克风、TTS、设置）显示 SVG 图标，hover 时颜色变化平滑
2. 不同浏览器/OS 上图标渲染一致
3. 输入框聚焦时边框发光，装饰角标可见
4. 角色表情切换时，背光颜色平滑过渡（1.5s）
5. 脸红时粉色背光、生气时红色背光、默认蓝色背光
6. 所有新样式在 1920x1080 和 1366x768 分辨率下正常显示
