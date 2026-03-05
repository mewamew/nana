import importlib.util
import os
import re
import sys
from dataclasses import dataclass, field
from typing import Callable


@dataclass
class Skill:
    name: str
    description: str        # 常驻 prompt 的简短描述（含行为约束）
    requires_env: list[str]
    body: str               # 详细指令，仅无 tool_func 的 skill 注入
    tool_func: Callable | None = None
    tool_params: dict = field(default_factory=dict)


def _parse_frontmatter(text: str) -> tuple[dict, str]:
    """解析 YAML frontmatter（不依赖 PyYAML，仅支持简单 key: value 格式）"""
    text = text.strip()
    if not text.startswith("---"):
        return {}, text

    end = text.find("\n---", 3)
    if end == -1:
        return {}, text

    fm_text = text[3:end].strip()
    body = text[end + 4:].strip()

    meta = {}
    for line in fm_text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        m = re.match(r"^(\w+)\s*:\s*(.+)$", line)
        if not m:
            continue
        key, val = m.group(1), m.group(2).strip()
        # 解析布尔值
        if val.lower() == "true":
            meta[key] = True
        elif val.lower() == "false":
            meta[key] = False
        # 解析列表（简单 [a, b] 格式）
        elif val.startswith("[") and val.endswith("]"):
            items = [x.strip().strip("'\"") for x in val[1:-1].split(",") if x.strip()]
            meta[key] = items
        else:
            meta[key] = val.strip("'\"")

    return meta, body


class SkillManager:
    def __init__(self, skills_dir: str):
        self.skills: list[Skill] = []
        if os.path.isdir(skills_dir):
            self._load(skills_dir)

    def _load(self, skills_dir: str):
        from tools import register_tool

        for entry in sorted(os.listdir(skills_dir)):
            skill_dir = os.path.join(skills_dir, entry)
            if not os.path.isdir(skill_dir):
                continue
            skill_md = os.path.join(skill_dir, "SKILL.md")
            if not os.path.isfile(skill_md):
                continue

            with open(skill_md, "r", encoding="utf-8") as f:
                content = f.read()

            meta, body = _parse_frontmatter(content)
            if not meta.get("name"):
                print(f"[SkillManager] 跳过 {entry}：缺少 name 字段")
                continue

            # 检查环境变量
            requires_env = meta.get("requires_env", [])
            if isinstance(requires_env, str):
                requires_env = [requires_env]
            missing = [k for k in requires_env if not os.environ.get(k)]
            if missing:
                print(f"[SkillManager] 跳过 skill {meta['name']}：缺少环境变量 {missing}")
                continue

            # 安装 requirements.txt（如有）
            req_txt = os.path.join(skill_dir, "requirements.txt")
            if os.path.isfile(req_txt):
                import subprocess
                print(f"[SkillManager] 安装依赖: {meta['name']}")
                subprocess.check_call(
                    [sys.executable, "-m", "pip", "install", "-r", req_txt],
                    stdout=subprocess.DEVNULL,
                )

            # 尝试加载 tool.py
            tool_func = None
            tool_params = {}
            tool_py = os.path.join(skill_dir, "tool.py")
            if os.path.isfile(tool_py):
                try:
                    spec = importlib.util.spec_from_file_location(
                        f"skills.{entry}.tool", tool_py
                    )
                    mod = importlib.util.module_from_spec(spec)
                    sys.modules[f"skills.{entry}.tool"] = mod
                    spec.loader.exec_module(mod)

                    if hasattr(mod, "run"):
                        tool_func = mod.run
                    tool_params = getattr(mod, "PARAMETERS", {})
                    tool_desc = getattr(mod, "DESCRIPTION", meta.get("description", ""))

                    register_tool(
                        name=meta["name"],
                        func=tool_func,
                        description=tool_desc,
                        parameters=tool_params,
                    )
                    print(f"[SkillManager] 注册工具: {meta['name']}")
                except Exception as e:
                    print(f"[SkillManager] 加载 {entry}/tool.py 失败: {e}")

            skill = Skill(
                name=meta["name"],
                description=meta.get("description", ""),
                requires_env=requires_env,
                body=body,
                tool_func=tool_func,
                tool_params=tool_params,
            )
            self.skills.append(skill)
            print(f"[SkillManager] Loaded skill: {skill.name}")

    def build_skills_prompt(self) -> str:
        lines = []
        bodies = []

        for s in self.skills:
            # 第一层：所有 skill 的紧凑描述（常驻）
            lines.append(f"- {s.name}: {s.description}")
            # 第二层：无 tool_func 的 skill 注入 body（行为指令）
            if not s.tool_func and s.body.strip():
                bodies.append(s.body.strip())

        result = "\n".join(lines)
        if bodies:
            result += "\n\n" + "\n\n".join(bodies)
        return result
