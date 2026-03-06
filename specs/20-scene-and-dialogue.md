# 20 — P0：场景背景 + 对话框重设计

## 概述

当前纯黑背景缺乏氛围感，对话以浮动字幕呈现缺少 galgame 质感。本 spec 实现两项核心视觉升级：
1. **场景背景系统**：支持多场景切换 + 日夜色调自动变化
2. **Galgame 风格对话框**：底部半透明文本框 + 打字机逐字效果 + 历史回看

---

## 一、场景背景系统

### 1.1 场景资源

在 `frontend/public/backgrounds/` 下放置三张独立的场景图片（同一场景的不同时段版本）：

```
frontend/public/backgrounds/
├── room-day.png        # 卧室/房间 - 白天（自然光，明亮）
├── room-evening.png    # 卧室/房间 - 黄昏（夕阳暖光，橙色调）
├── room-night.png      # 卧室/房间 - 夜晚（室内灯光亮起，窗外夜空）
```

> 图片分辨率：2560x1440（16:9），anime/插画风格，与 Live2D 角色画风一致。

#### 图片制作流程

1. 先用 AI 生成白天版本 `room-day.png`
2. 以白天版本为基础图，用 AI 改图生成黄昏版本（改窗外天色为夕阳、室内加暖色光）
3. 以白天版本为基础图，用 AI 改图生成夜晚版本（窗外夜空、室内灯光亮起、整体暗调）

这样三张图保持场景一致，但拥有真实的光照差异（窗外天色、灯光开关、影子方向），比 CSS filter 效果好得多。

#### AI 改图 prompt 参考

**黄昏版**：
```
Transform this room to golden hour / sunset time. The window shows an orange-pink sunset sky. Warm golden sunlight casts long shadows across the room. The desk lamp is not turned on yet. Keep the same room layout and furniture, only change the lighting and atmosphere to evening sunset.
```

**夜晚版**：
```
Transform this room to nighttime. The window shows a dark night sky with stars. The room is lit by a warm desk lamp and soft ceiling light. Cozy warm indoor lighting with gentle shadows. The curtains are partially drawn. Keep the same room layout and furniture, only change the lighting and atmosphere to nighttime.
```

### 1.2 日夜自动切换

根据用户本地时间自动切换背景图片：

| 时段 | 时间范围 | 使用图片 |
|------|----------|---------|
| 白天 | 06:00 - 16:59 | `room-day.png` |
| 黄昏 | 17:00 - 18:59 | `room-evening.png` |
| 夜晚 | 19:00 - 05:59 | `room-night.png` |

### 1.3 实现方案

新增组件 `frontend/src/components/Background.jsx`：

```jsx
const BG_MAP = {
  day:     '/backgrounds/room-day.png',
  evening: '/backgrounds/room-evening.png',
  night:   '/backgrounds/room-night.png',
};

function Background() {
  const [timeOfDay, setTimeOfDay] = useState(getTimeOfDay());

  useEffect(() => {
    // 每分钟检测一次时段变化
    const timer = setInterval(() => {
      setTimeOfDay(getTimeOfDay());
    }, 60000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="scene-background">
      {/* 三张图叠在一起，通过 opacity 切换实现 crossfade */}
      {Object.entries(BG_MAP).map(([time, src]) => (
        <img
          key={time}
          src={src}
          alt=""
          className={`scene-bg-img ${time === timeOfDay ? 'active' : ''}`}
        />
      ))}
    </div>
  );
}

function getTimeOfDay() {
  const hour = new Date().getHours();
  if (hour >= 6 && hour < 17) return 'day';
  if (hour >= 17 && hour < 19) return 'evening';
  return 'night';
}
```

### 1.4 CSS

```css
.scene-background {
  position: fixed;
  inset: 0;
  z-index: 0;  /* 在 Live2D canvas 之下 */
  overflow: hidden;
}

.scene-bg-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0;
  transition: opacity 2s ease;  /* crossfade 过渡 */
}

.scene-bg-img.active {
  opacity: 1;
}
```

### 1.5 层级关系

```
z-index 层级（从底到顶）：

0  — .scene-background（场景图）
1  — .live2d-main（Live2D canvas）
10 — .dialogue-box（对话框）
20 — .chat-input-container（输入区域）
30 — .config-btn 等控制按钮
```

需要将 Live2D canvas 的背景设为透明（PIXI Application `backgroundAlpha: 0`）。

---

## 二、浮动字幕式对话文本

### 2.1 设计理念

对话文本采用大号亮色浮动字幕样式，直接叠在画面上，无背景框。文字居中显示，带发光 text-shadow 效果，5 秒后自动淡出。输入栏保持独立的底部半透明面板。

### 2.2 对话框结构

`DialogueBox` 组件渲染两个独立区域（Fragment）：浮动字幕区 + 输入栏。

```jsx
function DialogueBox({ text, textVisible, isTypewriter, children }) {
  return (
    <>
      <div className={`dialogue-text-area ${textVisible && text ? 'visible' : 'hidden'}`}>
        <div className="dialogue-text">
          {isTypewriter ? <TypewriterText text={text} /> : text}
        </div>
      </div>
      <div className="dialogue-input-bar">
        {children}
      </div>
    </>
  );
}
```

### 2.3 打字机效果

`TypewriterText` 内置于 `DialogueBox.jsx`：

- 每字符间隔 40ms
- 点击文字立即显示全部（跳过动画）
- 完成后光标消失
- heartbeat 主动消息使用打字机效果，流式回复直接更新文本

### 2.4 字幕样式

```css
.dialogue-text-area {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  bottom: 90px;
  width: 90%;
  max-width: 960px;
  z-index: 10;
  text-align: center;
  background: none;
  border: none;
  padding: 0;
  transition: opacity 0.4s ease;
}

.dialogue-text-area.hidden {
  opacity: 0;
  pointer-events: none;
}

.dialogue-text {
  color: rgba(180, 230, 255, 0.95);
  font-size: 38px;
  font-weight: 700;
  line-height: 1.5;
  text-shadow: 0 0 10px rgba(100, 200, 255, 0.6), 0 2px 4px rgba(0, 0, 0, 0.8);
}

.dialogue-input-bar {
  position: fixed;
  left: 50%;
  bottom: 20px;
  transform: translateX(-50%);
  width: 90%;
  max-width: 960px;
  z-index: 10;
  border-radius: 12px;
  /* 半透明面板样式 */
}
```

### 2.5 历史回看

鼠标滚轮上滑时显示历史对话列表（overlay），类似 galgame 的 backlog：

```jsx
function DialogueHistory({ history, visible, onClose }) {
  return (
    <div className={`dialogue-history ${visible ? 'show' : ''}`}>
      <div className="history-header">
        <span>对话记录</span>
        <button onClick={onClose}>✕</button>
      </div>
      <div className="history-list">
        {history.map((entry, i) => (
          <div key={i} className={`history-entry ${entry.role}`}>
            {entry.role === 'assistant' && (
              <span className="history-name">{entry.name}</span>
            )}
            <p>{entry.content}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
```

触发方式：在对话框区域鼠标滚轮上滑，或点击对话框右上角小按钮。按 ESC 或点击空白处关闭。

---

## 三、与现有系统的集成

### 3.1 App.jsx 改动

- `subtitle` 状态重命名为 `dialogueText`，接入 `DialogueBox` 组件
- 新增 `dialogueHistory` 数组，每次收到完整回复后追加
- `charName` 仅用于 `DialogueHistory`，不传给 `DialogueBox`
- 移除旧的 `.subtitles` DOM

### 3.2 Live2DModel.jsx 改动

- PIXI Application 设置 `backgroundAlpha: 0`，使背景透明
- 移除或注释掉黑色 `backgroundColor` 配置

### 3.3 流式文本与打字机效果的协调

当前 SSE 流式返回文本片段。两种策略：

**方案 A（推荐）：流式即打字机**
- SSE 每个 chunk 直接追加到对话框，天然就是逐字效果
- 不需要额外的打字机定时器
- 速度由网络和 LLM 生成速度决定，更自然

**方案 B：等待完整文本后播放打字机**
- 收集完整回复后触发 TypewriterText
- 可精确控制速度，但需要等待完整响应

建议采用方案 A，将 SSE 的流式文本直接显示在对话框中。TypewriterText 组件仅作为主动消息（非流式）的展示方式。

---

## 四、文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 新增 | `frontend/src/components/Background.jsx` | 场景背景 + 日夜切换 |
| 新增 | `frontend/src/components/DialogueBox.jsx` | 对话框 + 打字机效果 |
| 新增 | `frontend/src/components/DialogueHistory.jsx` | 历史回看 |
| 新增 | `frontend/public/backgrounds/room-day.png` | 白天场景图 |
| 新增 | `frontend/public/backgrounds/room-evening.png` | 黄昏场景图（AI 改图生成） |
| 新增 | `frontend/public/backgrounds/room-night.png` | 夜晚场景图（AI 改图生成） |
| 修改 | `frontend/src/App.jsx` | 集成新组件，移除旧字幕 |
| 修改 | `frontend/src/App.css` | 新增对话框/背景样式，调整 z-index |
| 修改 | `frontend/src/components/Live2DModel.jsx` | 背景透明化 |

---

## 五、验证

1. 启动前端，确认背景图正确加载并填满屏幕
2. 修改系统时间，验证日/黄昏/夜三种色调平滑切换
3. 发送消息，确认浮动字幕大字居中显示在画面上，无背景框
4. 字幕 5 秒后自动淡出
5. 打字机效果（heartbeat）和流式文本（对话回复）正常
6. 输入栏保持底部独立圆角面板样式
7. 对话框区域鼠标上滑，打开历史回看
8. Live2D 角色在背景图上正确渲染（无黑色矩形遮挡）
9. 输入框、配置按钮等 UI 层级正确，不被背景遮挡
