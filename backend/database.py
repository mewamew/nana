import os
import sqlite3
from datetime import datetime


class Database:
    def __init__(self, db_path: str = None):
        if db_path is None:
            db_path = os.path.join(os.path.dirname(__file__), "..", "save", "nana.db")
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        self.db_path = db_path
        self._init_db()

    def _init_db(self):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id TEXT NOT NULL DEFAULT 'default',
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
            """)
            conn.commit()

    def save_dialog(self, user_message: str, assistant_message: str, session_id: str = "default"):
        """保存一轮 user + assistant 对话"""
        now = datetime.now().isoformat()
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                "INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)",
                (session_id, "user", user_message, now),
            )
            conn.execute(
                "INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)",
                (session_id, "assistant", assistant_message, now),
            )
            conn.commit()

    def save_message(self, role: str, content: str, session_id: str = "default"):
        """保存单条消息（心跳等非配对消息）"""
        now = datetime.now().isoformat()
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                "INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)",
                (session_id, role, content, now),
            )
            conn.commit()

    def get_recent_dialogs(self, n: int = 20, session_id: str = "default") -> list[tuple[str, str]]:
        """返回最近 N 轮对话 [(user_msg, assistant_msg), ...]"""
        with sqlite3.connect(self.db_path) as conn:
            # 取最近 n*2 条消息（每轮 2 条），按 id 正序
            rows = conn.execute(
                """
                SELECT role, content FROM (
                    SELECT id, role, content
                    FROM messages
                    WHERE session_id = ?
                    ORDER BY id DESC
                    LIMIT ?
                ) sub ORDER BY id ASC
                """,
                (session_id, n * 2),
            ).fetchall()

        # 配对为 (user, assistant) 轮次
        dialogs = []
        i = 0
        while i < len(rows) - 1:
            if rows[i][0] == "user" and rows[i + 1][0] == "assistant":
                dialogs.append((rows[i][1], rows[i + 1][1]))
                i += 2
            else:
                i += 1
        return dialogs

    def get_history_for_frontend(self, limit: int = 50, session_id: str = "default") -> list[dict]:
        """返回前端格式的历史消息 [{type, content}, ...]"""
        with sqlite3.connect(self.db_path) as conn:
            rows = conn.execute(
                """
                SELECT role, content FROM (
                    SELECT id, role, content
                    FROM messages
                    WHERE session_id = ?
                    ORDER BY id DESC
                    LIMIT ?
                ) sub ORDER BY id ASC
                """,
                (session_id, limit),
            ).fetchall()

        return [{"type": role, "content": content} for role, content in rows]
