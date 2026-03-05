# 18 — Skill 系统：可插拔能力扩展框架

## 概述

Skill 系统让开发者或用户通过新增 skill 目录来扩展娜娜的能力（如查天气、设提醒、网络搜索等），
无需修改核心代码。设计参考 openclaw 的 skill 机制，适配 nana 的 Python + FastAPI 架构。

---

## 背景：OpenClaw Skill 系统分析

| 特性 | 描述 |
|------|------|
| 格式 | 每个 skill 是一个目录，包含 `SKILL.md`（YAML frontmatter + Markdown 内容） |
| 注入方式 | Markdown 内容直接注入 LLM system prompt |
| 发现机制 | 扫描多个目录（bundled > managed > workspace），高优先级覆盖低优先级 |
| 过滤机制 | 按 OS、环境变量、可执行文件可用性过滤 |
| 用户调用 | `/skillname` 语法，前端/CLI 解析后路由 |
| 工具调用 | 部分 skill 支持确定性路由到具体工具函数 |

---

## 可行性结论

**可行，且工作量合理。** 核心实现分三层：

1. **Prompt 注入**（低风险）：解析 skill 文件，将内容注入 system prompt → nana 自然学会新能力
2. **工具扩展**（中风险）：skill 可提供 Python 工具函数 → 扩展现有 tool loop
3. **用户调用**（低风险）：检测 `/skillname` 前缀 → 后端路由处理

**与 Nana 现有架构的契合点：**
- `tools.py` 已有工具注册/执行框架（`get_datetime`, `search_memory`）→ 可直接扩展
- `main_agent.py` 已有 agentic tool loop（最多 3 次迭代，LLM 决策）→ skill tools 可无缝合并
- `prompts/` 目录已有模块化 prompt 管理 → skills_prompt 追加进去即可
- Provider 工厂模式已建立抽象层规范 → SkillManager 风格一致

**与 Nana 现有架构的差异（需适配）：**
- Nana 是 Python + FastAPI，不是 TypeScript（需重新实现）
- Nana 的 skill 触发场景是聊天消息，不是 CLI 命令
- Nana 已有 JSON 输出格式约束（reply/expression/emotion_update），skill 需兼容

---

## 目录结构

```
backend/
├── skill_manager.py          # 新增：Skill 核心管理器
└── skills/                   # 新增：Skill 目录（每个子目录一个 skill）
    ├── weather/
    │   ├── SKILL.md          # 说明文档（注入 LLM system prompt）
    │   └── tool.py           # 可选：Python 工具实现
    └── datetime_info/
        ├── SKILL.md
        └── tool.py           # 复用现有 get_datetime 工具
```

---

## SKILL.md 格式

YAML frontmatter 描述元数据，Markdown 正文注入 LLM：

```markdown
---
name: weather
description: 查询城市天气
requires:
  env: [WEATHER_API_KEY]      # 缺失则过滤此 skill
model_invocable: true          # 注入 LLM system prompt
user_invocable: true           # 支持 /weather 前缀触发
---

# Weather Skill

当用户询问某个城市的天气时，调用 `get_weather(city)` 工具查询实时天气。
返回温度、天气状况、湿度等信息，用自然语言告知用户。
```

---

## SkillManager 设计（`backend/skill_manager.py`）

```python
class SkillManager:
    def load_skills(self, skills_dir: str)
        # 扫描 skills/ 目录，读取每个子目录的 SKILL.md

    def get_eligible_skills(self) -> list[Skill]
        # 过滤：检查 requires.env 变量是否存在

    def build_skills_prompt(self) -> str
        # 生成注入 LLM 的文档块（所有可用 skill 的 Markdown 正文拼接）

    def get_skill_tools(self) -> dict
        # 返回所有可用 skill 提供的工具函数（从 tool.py 动态导入）

    def find_user_invocable(self, name: str) -> Skill | None
        # 查找 /skillname 对应的 skill
```

---

## 需修改的文件

| 文件 | 改动 |
|------|------|
| `backend/skill_manager.py` | **新建**：实现 SkillManager |
| `backend/main_agent.py` | 初始化 SkillManager；将 `skills_prompt` 注入 system prompt；将 skill tools 合并入 tool loop |
| `backend/tools.py` | 添加 `register_tool(name, func, description)` 动态注册接口 |
| `backend/main.py` | 创建全局 SkillManager 实例；可选：`GET /api/skills` 端点返回可用 skill 列表 |

---

## Prompt 注入位置（`main_agent.py`）

在现有 `soul.md` + `reply.md` 之后追加：

```python
system_prompt = soul_prompt + "\n\n" + reply_prompt
if skills_prompt:
    system_prompt += "\n\n## 可用技能\n" + skills_prompt
```

---

## 用户调用流程

```
用户发送 "/weather 上海"
  ↓
main_agent.py 检测 "/" 前缀
  ↓
SkillManager.find_user_invocable("weather") 找到 skill
  ↓
直接调用对应工具函数（跳过 LLM 工具决策）
  ↓
结果传给 LLM 生成自然语言回复（保持 JSON 格式约束）
```

---

## 实现步骤

1. **创建 `backend/skill_manager.py`**
   - 解析 SKILL.md frontmatter（用 `python-frontmatter` 或手动解析）
   - 过滤（检查 env 变量）
   - 生成 prompt 块
   - 动态导入 `tool.py`

2. **修改 `backend/tools.py`**
   - 添加 `register_tool(name, func, description)` 接口
   - 支持外部 skill 工具动态注入

3. **修改 `backend/main_agent.py`**
   - 集成 SkillManager
   - prompt 注入 + tool 合并入 tool loop

4. **修改 `backend/main.py`**
   - 在启动时初始化 SkillManager
   - 可选：添加 `GET /api/skills` 端点

5. **创建示例 skill**
   - `backend/skills/datetime_info/`：复用现有 `get_datetime` 工具，验证整体链路
   - `backend/skills/weather/`（可选，需 API key）

---

## 验证方式

1. 启动后端，检查日志中 skill 加载和过滤情况
2. 发送消息，确认 skill 文档出现在 LLM 接收的 prompt 中
3. 发送 `/weather 北京`，确认工具调用链路正确
4. 禁用对应环境变量后重启，确认 skill 被正确过滤掉
5. 验证 JSON 格式约束（reply/expression/emotion_update）在 skill 调用后仍正常
