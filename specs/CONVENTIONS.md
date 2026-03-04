# CONVENTIONS.md — 代码规范

> 所有 Agent 实现时必须遵守本规范。

---

## 1. Python 规范

### 基本要求
- Python 最低版本：3.10
- 使用 `async/await` 处理所有 I/O 操作
- 类型注解：函数参数和返回值必须有类型注解
- 字符串：统一使用双引号

### 文件编码
- 所有 Python 文件顶部不需要 `# -*- coding: utf-8 -*-`（Python 3 默认 UTF-8）
- 写入文件时必须显式指定 `encoding="utf-8"`

### 导入顺序
```python
# 1. 标准库
import os
import asyncio
from typing import AsyncGenerator

# 2. 第三方库
import httpx
from fastapi import FastAPI

# 3. 本地模块
from config_manager import ConfigManager
from providers.llm.base import BaseLLMProvider
```

### 错误处理
```python
# 正确：记录具体错误信息，向上抛出或返回合理默认值
try:
    result = await some_api_call()
except httpx.TimeoutException as e:
    print(f"[ProviderName] 请求超时: {e}")
    raise
except Exception as e:
    print(f"[ProviderName] 未知错误: {e}")
    raise

# 错误：捕获所有异常却不处理
try:
    ...
except:
    pass
```

### 日志输出
- 使用 `print(f"[模块名] 信息")` 格式，不引入 logging 库
- Provider 名称放在方括号里，方便定位：`[DeepSeek]`, `[FishAudio]`, `[Whisper]`

---

## 2. 文件命名

| 类型 | 规范 | 示例 |
|------|------|------|
| Python 文件 | `snake_case.py` | `openai_compatible.py` |
| React 组件 | `PascalCase.jsx` | `ConfigPanel.jsx` |
| CSS 文件 | 与组件同名 | `ConfigPanel.css` |
| 工具函数 | `camelCase.js` | `client.js` |

---

## 3. Provider 实现规范

每个 Provider 文件结构：
```python
# backend/providers/llm/some_provider.py

from providers.llm.base import BaseLLMProvider
from typing import AsyncGenerator

class SomeProvider(BaseLLMProvider):
    def __init__(self, config: dict):
        """
        config 为 config.json 中对应 provider 的配置字典
        例如: {"api_key": "xxx", "model": "model-name", "base_url": "..."}
        """
        self.api_key = config.get("api_key", "")
        self.model = config.get("model", "default-model")
        self.base_url = config.get("base_url", "")

    async def chat_stream(
        self,
        messages: list[dict],
        temperature: float = 0.7
    ) -> AsyncGenerator[str, None]:
        # 实现流式生成
        ...

    def is_configured(self) -> bool:
        return bool(self.api_key)
```

---

## 4. React/前端规范

- 使用函数组件 + Hooks，不使用 class 组件
- 状态管理：useState / useRef / useEffect，不引入 Redux 等额外状态库
- API 请求统一通过 `src/api/client.js` 封装，组件内不直接写 `fetch`
- CSS：每个组件有对应的 `.css` 文件，不使用 inline style（除非动态值）
- 组件 props 用解构：`function MyComp({ value, onChange }) {...}`

---

## 5. 禁止事项

- **不得**在代码中硬编码 API Key 或 URL
- **不得**在 `providers/` 目录外直接 import 具体 Provider 类
- **不得**修改 `prompts/reply.txt`
- **不得**修改 `Live2DModel.jsx` 中 Live2D 初始化和渲染逻辑（除非是 07-frontend spec 明确要求）
- **不得**引入 `config.py`（旧文件，已被 `config_manager.py` 取代）
- **不得**创建 `.env` 文件
