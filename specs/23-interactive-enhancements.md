# 23 — P3：互动增强（心情指示 + 快捷回复 + 触摸反应）

## 概述

借鉴 galgame 和养成游戏的互动机制，增加三项功能：
1. **心情指示器**：显示角色当前情绪状态
2. **快捷回复选项**：对话中偶尔提供 2-3 个可选回复
3. **触摸反应**：点击 Live2D 角色不同区域触发不同反应

---

## 一、心情指示器

### 1.1 设计

在屏幕左上角或角色旁边显示一个小型心情状态卡片，展示角色当前情绪。

视觉参考：养成游戏的状态面板，但极度精简。

### 1.2 组件

新增 `frontend/src/components/MoodIndicator.jsx`：

```jsx
function MoodIndicator({ expression, characterName }) {
  const mood = expressionToMood(expression);

  return (
    <div className="mood-indicator">
      <div className="mood-icon">{mood.icon}</div>
      <div className="mood-label">{mood.label}</div>
    </div>
  );
}
```

### 1.3 表情到心情的映射

```javascript
function expressionToMood(expression) {
  const moods = {
    '咪咪眼': { icon: '😊', label: '开心', color: '#FFD700' },
    '爱心':   { icon: '💕', label: '喜欢', color: '#FF69B4' },
    '脸红':   { icon: '😳', label: '害羞', color: '#FF9999' },
    '吐舌':   { icon: '😜', label: '调皮', color: '#FFA500' },
    '嘟嘴':   { icon: '😤', label: '不满', color: '#FF8C00' },
    '生气':   { icon: '💢', label: '生气', color: '#FF4444' },
    '生气瘪嘴': { icon: '😠', label: '恼怒', color: '#FF6347' },
    '黑脸':   { icon: '😑', label: '无语', color: '#888888' },
    '死鱼眼': { icon: '😒', label: '无聊', color: '#AAAAAA' },
    '眼泪':   { icon: '😢', label: '难过', color: '#6495ED' },
    '泪眼':   { icon: '🥺', label: '委屈', color: '#87CEEB' },
    '钱钱眼': { icon: '🤑', label: '兴奋', color: '#32CD32' },
    'nn眼':   { icon: '😌', label: '平静', color: '#B0C4DE' },
  };
  return moods[expression] || { icon: '😌', label: '平静', color: '#B0C4DE' };
}
```

### 1.4 样式

```css
.mood-indicator {
  position: fixed;
  top: 20px;
  left: 20px;
  z-index: 30;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 20px;
  transition: all 0.5s ease;
}

.mood-icon {
  font-size: 18px;
  transition: transform 0.3s ease;
}

.mood-indicator:hover .mood-icon {
  transform: scale(1.2);
}

.mood-label {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.7);
  font-weight: 500;
}
```

### 1.5 动画

表情变化时，心情图标做一个轻微的弹跳动画：

```css
.mood-icon.changed {
  animation: mood-bounce 0.4s ease;
}

@keyframes mood-bounce {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.3); }
}
```

---

## 二、快捷回复选项

### 2.1 设计思路

在特定场景下（角色提问、需要选择时），在对话框下方显示 2-3 个可点击的快捷回复按钮，类似 galgame 的选项分支。

### 2.2 后端支持

在 LLM 回复格式中新增可选字段 `quick_replies`：

修改 `backend/prompts/reply.md`，在输出格式中增加：

```json
{
  "reply": "<回答内容>",
  "expression": "<表情>",
  "quick_replies": ["选项1", "选项2", "选项3"]
}
```

字段说明：
- `quick_replies`：可选，数组，2-3 个简短选项文本
- 仅在角色主动提问或需要用户做选择时提供
- 大多数普通回复不需要此字段（为 null 或省略）

### 2.3 SSE 事件扩展

在流结束前新增事件类型：

```
data: {"type": "quick_replies", "content": "[\"选项1\",\"选项2\"]"}
```

### 2.4 前端组件

新增 `frontend/src/components/QuickReplies.jsx`：

```jsx
function QuickReplies({ options, onSelect, visible }) {
  if (!visible || !options?.length) return null;

  return (
    <div className="quick-replies">
      {options.map((option, i) => (
        <button
          key={i}
          className="quick-reply-btn"
          onClick={() => onSelect(option)}
          style={{ animationDelay: `${i * 0.1}s` }}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
```

### 2.5 样式

```css
.quick-replies {
  position: fixed;
  bottom: 210px;  /* 在对话框上方 */
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 12px;
  z-index: 15;
}

.quick-reply-btn {
  padding: 10px 24px;
  background: rgba(10, 10, 30, 0.8);
  border: 1px solid rgba(47, 164, 231, 0.4);
  border-radius: 24px;
  color: rgba(255, 255, 255, 0.9);
  font-size: 14px;
  cursor: pointer;
  backdrop-filter: blur(8px);
  transition: all 0.2s ease;
  animation: reply-fade-in 0.3s ease forwards;
  opacity: 0;
  transform: translateY(10px);
}

@keyframes reply-fade-in {
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.quick-reply-btn:hover {
  background: rgba(47, 164, 231, 0.3);
  border-color: rgba(47, 164, 231, 0.7);
  box-shadow: 0 0 12px rgba(47, 164, 231, 0.2);
  transform: translateY(-2px);
}

.quick-reply-btn:active {
  transform: translateY(0);
}
```

### 2.6 交互逻辑

- 点击选项后，该选项文本作为用户输入发送
- 点击后快捷回复按钮组消失
- 用户也可以忽略选项，直接在输入框打字
- 在输入框开始输入时，快捷回复自动消失

---

## 三、触摸反应

### 3.1 设计

点击 Live2D 角色的不同区域触发不同反应（语音 + 表情 + 对话），类似养成游戏的"摸头""戳脸"互动。

### 3.2 Live2D Hit Area 映射

Live2D 模型支持 hit area 检测。根据 PinkFox 模型的 hit area 定义映射：

| Hit Area | 触发动作 | 角色反应类型 |
|----------|---------|-------------|
| Head | 摸头 | 开心/害羞 |
| Body | 戳身体 | 轻微不满/傲娇 |
| Face | 戳脸 | 害羞/嘟嘴 |

> 具体 hit area 名称取决于模型配置，需从 model3.json 确认。

### 3.3 后端 API

新增端点或复用现有 chat 端点，发送触摸事件：

```
POST /api/touch
Body: { "area": "head" }
Response: SSE stream（与 chat 同格式）
```

或更简单地：将触摸事件转化为一条特殊的用户消息发给现有 chat 接口：

```javascript
// 前端将触摸转化为聊天消息
const touchMessages = {
  head: '[用户摸了摸你的头]',
  body: '[用户戳了戳你]',
  face: '[用户捏了捏你的脸]',
};
```

**推荐使用后者**，无需新增后端端点，且 LLM 能根据上下文生成更自然的反应。

### 3.4 Live2D 组件改动

在 `Live2DModel.jsx` 中添加 hit area 点击回调：

```javascript
model.on('hit', (hitAreas) => {
  const area = hitAreas[0]; // 取第一个命中区域
  if (area && onTouch) {
    onTouch(area);
  }
});
```

### 3.5 触摸频率限制

- 触摸操作有 3 秒冷却时间，避免频繁触发
- 冷却期间点击播放一个简短的"嗯？"表情变化但不发送请求
- 前端维护冷却状态

```javascript
const [touchCooldown, setTouchCooldown] = useState(false);

const handleTouch = (area) => {
  if (touchCooldown) return;
  setTouchCooldown(true);
  setTimeout(() => setTouchCooldown(false), 3000);
  // 发送触摸消息
  sendMessage(touchMessages[area]);
};
```

### 3.6 触摸视觉反馈

点击时在触摸位置显示一个小型涟漪效果：

```css
.touch-ripple {
  position: absolute;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.3);
  animation: ripple 0.6s ease-out forwards;
  pointer-events: none;
}

@keyframes ripple {
  0% {
    transform: scale(0);
    opacity: 1;
  }
  100% {
    transform: scale(3);
    opacity: 0;
  }
}
```

---

## 四、文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 新增 | `frontend/src/components/MoodIndicator.jsx` | 心情指示器 |
| 新增 | `frontend/src/components/QuickReplies.jsx` | 快捷回复选项 |
| 修改 | `frontend/src/App.jsx` | 集成三个新功能 |
| 修改 | `frontend/src/App.css` | 心情指示器、快捷回复、涟漪样式 |
| 修改 | `frontend/src/components/Live2DModel.jsx` | 添加 hit area 点击回调 |
| 修改 | `backend/prompts/reply.md` | 输出格式增加 `quick_replies` 字段 |
| 修改 | `backend/chat_service.py` | 解析并推送 `quick_replies` SSE 事件 |

---

## 五、依赖

- **前置**：spec-20（对话框系统）、spec-22（图标系统）
- **后端改动量小**：仅 prompt 格式扩展 + SSE 事件类型

---

## 六、验证

### 心情指示器
1. 角色回复时，左上角心情指示器实时更新
2. 表情从"开心"切换到"生气"时，图标做弹跳动画
3. 心情指示器不遮挡其他 UI 元素

### 快捷回复
1. 角色提问时，对话框上方出现 2-3 个选项按钮
2. 按钮依次淡入（错开 0.1s）
3. 点击选项后，文本发送到聊天，选项消失
4. 用户在输入框开始打字时，选项自动消失
5. 普通回复不出现快捷选项

### 触摸反应
1. 点击 Live2D 角色头部区域，角色回复开心/害羞反应
2. 点击间隔 < 3s 时不触发新请求
3. 点击位置显示涟漪效果
4. 触摸消息以 `[用户摸了摸你的头]` 格式发送，LLM 自然回应
