from datetime import datetime
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from conversation import ConversationHistory

TOOL_DEFINITIONS = [
    {
        "name": "get_datetime",
        "description": "获取当前的日期和时间。用户询问时间、日期、星期几时使用。",
        "parameters": {},
    },
    {
        "name": "search_memory",
        "description": "在长期记忆中搜索相关历史信息。需要回忆以前对话时使用。",
        "parameters": {"query": "搜索关键词"},
    },
]

_WEEKDAYS = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"]


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
        if tool_name == "get_datetime":
            return self._get_datetime()
        elif tool_name == "search_memory":
            query = args.get("query", "")
            return self._search_memory(query)
        else:
            return f"[错误] 未知工具: {tool_name}"

    def _get_datetime(self) -> str:
        now = datetime.now()
        weekday = _WEEKDAYS[now.weekday()]
        return now.strftime(f"%Y年%m月%d日 {weekday} %H:%M:%S")

    def _search_memory(self, query: str) -> str:
        if not query:
            return "[错误] search_memory 需要提供 query 参数"
        results = self.conversation_history.retrieve(query, n_results=3)
        if not results:
            return "未找到相关记忆。"
        return "\n".join(f"- {r}" for r in results)
