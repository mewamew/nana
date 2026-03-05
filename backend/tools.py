import asyncio
from typing import TYPE_CHECKING, Callable

if TYPE_CHECKING:
    from conversation import ConversationHistory

_dynamic_tool_funcs: dict[str, Callable] = {}


def register_tool(name: str, func: Callable, description: str, parameters: dict = None):
    TOOL_DEFINITIONS.append({
        "name": name,
        "description": description,
        "parameters": parameters or {}
    })
    _dynamic_tool_funcs[name] = func


TOOL_DEFINITIONS = [
    {
        "name": "search_memory",
        "description": "在长期记忆中搜索相关历史信息。需要回忆以前对话时使用。",
        "parameters": {"query": "搜索关键词"},
    },
]


def render_tool_definitions() -> str:
    lines = []
    for tool in TOOL_DEFINITIONS:
        params = ""
        if tool["parameters"]:
            params = "，参数：" + "、".join(f"{k}({v})" for k, v in tool["parameters"].items())
        lines.append(f'- {tool["name"]}: {tool["description"]}{params}')
    return "\n".join(lines)


class ToolExecutor:
    def __init__(self, conversation_history: "ConversationHistory") -> None:
        self.conversation_history = conversation_history

    async def execute(self, tool_name: str, args: dict) -> str:
        if tool_name == "search_memory":
            query = args.get("query", "")
            return self._search_memory(query)
        elif tool_name in _dynamic_tool_funcs:
            func = _dynamic_tool_funcs[tool_name]
            if asyncio.iscoroutinefunction(func):
                return str(await func(**args))
            return str(func(**args))
        else:
            return f"[错误] 未知工具: {tool_name}"

    def _search_memory(self, query: str) -> str:
        if not query:
            return "[错误] search_memory 需要提供 query 参数"
        results = self.conversation_history.retrieve(query, n_results=3)
        if not results:
            return "未找到相关记忆。"
        return "\n".join(f"- {r}" for r in results)
