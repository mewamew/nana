# 18 — Skill 系统：可插拔能力扩展框架

## 概述

Skill 系统通过新增 skill 目录来扩展娜娜的能力（如查天气、设提醒、网络搜索等），无需修改核心代码。
每个 skill 由一个 `SKILL.md`（元数据 + 行为约束）和可选的 `tool.py`（工具实现）构成。

---

## 目录结构

```
backend/
├── skill_manager.py
└── skills/
    └── weather/
        ├── SKILL.md
        ├── tool.py
        └── requirements.txt    # 可选，有则自动安装
```

---

## SKILL.md 格式

```markdown
---
name: weather                   # 必填，skill 唯一标识
description: 一句话描述 + LLM 行为约束（常驻 prompt）
requires_env: [KEY1, KEY2]     # 可选，缺失则跳过此 skill
---

可选的 Markdown 正文。
仅在 skill 无 tool.py 时注入 LLM（用于纯 prompt 类 skill）。
有 tool.py 的 skill 行为约束写进 description 即可，body 留空。
```

frontmatter 字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | 必填，对应工具名和 skill 目录名 |
| `description` | string | 必填，注入 LLM prompt 的简短描述，含行为约束 |
| `requires_env` | list | 可选，所需环境变量；缺失则跳过该 skill |

---

## tool.py 格式

```python
import httpx

# LLM 看到的工具描述（比 SKILL.md description 更详细，专用于工具调用场景）
DESCRIPTION = "查询指定城市的实时天气信息。"

# 参数说明（dict，key=参数名，value=说明）
PARAMETERS = {
    "city": "城市名称，支持中英文",
    "days_ahead": "0=今天，1=明天，2=后天（可选，默认0）",
}

def run(city: str = "", days_ahead: int = 0) -> str:
    ...
    return "结果字符串"
```

- `run()` 必须存在，参数对应 `PARAMETERS` 中的 key
- 返回值为字符串，LLM 会将其作为工具结果
- `run()` 可以是同步或 async 函数，框架自动适配

---

## SkillManager（`backend/skill_manager.py`）

### 加载流程

```
启动时 → 扫描 backend/skills/ 各子目录
  ↓
读取 SKILL.md → 解析 frontmatter（自实现，无需 PyYAML）
  ↓
检查 requires_env → 缺失则跳过
  ↓
安装 requirements.txt（有则执行 pip install）
  ↓
动态导入 tool.py → 调用 register_tool() 注入 tools.py
  ↓
构建 Skill 对象，加入 self.skills
```

### build_skills_prompt()

生成注入 LLM 的文本块，两层结构：

```
- weather: 查询指定城市的天气（今天实时/明天后天预报）...
- another_skill: 描述...

[可选] 无 tool.py 的 skill 的 Markdown 正文（详细行为指令）
```

有 `tool.py` 的 skill 只用 description 那一行；无 `tool.py` 的 skill 额外追加 body。

---

## 工具调用流程

```
用户消息 → main_agent._run_tool_loop()
  ↓
LLM 读取 tool_decision.md（含动态渲染的 tool_definitions）
  ↓
LLM 决策：{"action": "call_tool", "tool": "weather", "args": {"city": "北京", "days_ahead": 1}}
  ↓
ToolExecutor.execute("weather", args) → _dynamic_tool_funcs["weather"](**args)
  ↓
结果字符串传回 main_agent → 注入最终 reply prompt
```

### tool_decision.md 规则

prompt 不硬编码工具名，依赖 `{tool_definitions}` 动态渲染所有已注册工具：

```
判断规则：
- 仔细阅读上方"可用工具"列表，每个工具的描述已说明适用场景
- 如果用户的需求与某个工具的描述匹配，则调用该工具
- 没有合适工具时，直接回复，不调用工具
```

---

## Prompt 注入位置（`main_agent.py`）

skills_prompt 在 `format()` 之后追加（避免花括号冲突）：

```python
prompt = self.prompt_template.format(...)   # format() 先执行
if self.skill_manager:
    skills_content = self.skill_manager.build_skills_prompt()
    if skills_content:
        prompt += "\n\n## 可用技能\n" + skills_content
```

---

## Weather Skill（已实现）

数据源：**open-meteo.com**（免费，无需 API key）
- 今天：`/v1/forecast?current=...` 实时数据
- 明天/后天：`/v1/forecast?daily=...` 预报数据（最多 7 天）
- 地理编码：`geocoding-api.open-meteo.com/v1/search`，按人口降序取最大城市

中文音译映射（open-meteo geocoding 不识别中文音译外国城市）：

```python
CN_TO_EN = {"伦敦": "London", "纽约": "New York City", "巴黎": "Paris", ...}
```

参数：

| 参数 | 类型 | 说明 |
|------|------|------|
| `city` | str | 城市名，支持中英文 |
| `days_ahead` | int | 0=今天（默认），1=明天，2=后天，最多 7 |

网络要求：`wttr.in` 在部分网络环境被 DNS 拦截（解析到保留 IP `198.18.x.x`），改用 open-meteo 规避。

---

## 新增 Skill 步骤

1. 在 `backend/skills/<skill_name>/` 新建目录
2. 写 `SKILL.md`（frontmatter 必填 `name` + `description`）
3. 写 `tool.py`（含 `DESCRIPTION`、`PARAMETERS`、`run()` 函数）
4. 如有第三方依赖，写 `requirements.txt`
5. 重启后端，SkillManager 自动安装依赖、注册工具

---

## 验证

重启后端，日志应显示：

```
[SkillManager] 安装依赖: <skill_name>
[SkillManager] 注册工具: <skill_name>
[SkillManager] Loaded skill: <skill_name>
```

缺少 `requires_env` 中的环境变量时，日志显示：

```
[SkillManager] 跳过 skill <name>：缺少环境变量 [KEY]
```

---

## 未实现（待规划）

- `/skillname` 用户直接调用语法（跳过 LLM 决策直接执行）
- `GET /api/skills` 端点返回可用 skill 列表
- skill 优先级 / 覆盖机制（bundled > user > workspace）
