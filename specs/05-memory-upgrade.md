# 05-memory-upgrade — 记忆系统升级

**Status: ✅ Implemented** (2026-03-04)

> **实现备注**：原 spec 设计使用 ChromaDB 做向量存储，实际实现改为 **JSON 文件 + 关键词匹配检索**，放弃了 ChromaDB 和 Embedding 依赖。`embedding.py` 已删除。检索逻辑见 `conversation.py`。

## 背景与目标

当前记忆系统存在的问题：
1. 归档策略粗暴：超过 20 条就把前 10 条原始文本直接存入 ChromaDB
2. 原始对话文本语义密度低，向量检索质量差
3. 用户档案（`me.txt`）是非结构化纯文本，每次全量覆写，信息容易丢失
4. 没有分层：工作记忆与长期记忆混为一体，缺乏对用户知识的持久化管理

**升级目标**（参考 OpenClaw 记忆系统设计）：

1. 建立**三层记忆架构**（工作记忆 → 情节记忆 → 语义记忆）
2. 归档时用 LLM **双重提取**：对话摘要 + 用户画像
3. 用**结构化 JSON** 替代 `me.txt`，实现增量合并而非全量覆写
4. 增强上下文构建，综合三层记忆为 LLM 提供更完整的背景信息

---

## 核心理念（借鉴 OpenClaw）

| OpenClaw 理念 | Nana 适配方案 |
|---|---|
| 文件即真相（Markdown 是权威来源，DB 只是索引） | `user_profile.json` 是用户知识的权威来源，可手动编辑 |
| 分层记忆（工作记忆 / 情节记忆 / 语义记忆） | 三层架构：RAM → ChromaDB → user_profile.json |
| 增量同步（hash 比对，只更新变化部分） | 用户画像增量合并，不覆写已有信息 |
| 多级降级（向量失败 → 关键词 → 空结果） | LLM 提取失败 → 原始文本归档 + 跳过画像更新 |

---

## 设计方案：三层记忆架构

```
┌──────────────────────────────────────────────────────┐
│  Tier 1: 工作记忆 (Working Memory)                     │
│  内存中最近 N 轮对话 · 每轮都更新 · 直接参与上下文      │
└────────────────────┬─────────────────────────────────┘
                     │ 超过阈值时触发归档
                     ▼
┌──────────────────────────────────────────────────────┐
│  LLM 双重提取（一次调用，JSON 输出）                    │
│  ┌─────────────────────┐  ┌────────────────────────┐ │
│  │  ① 对话摘要          │  │  ② 用户画像增量         │ │
│  │  100 字以内          │  │  结构化 JSON             │ │
│  └──────────┬──────────┘  └────────────┬───────────┘ │
└─────────────┼──────────────────────────┼─────────────┘
              ▼                          ▼
┌─────────────────────┐  ┌──────────────────────────────┐
│  Tier 2: 情节记忆     │  │  Tier 3: 语义记忆             │
│  ChromaDB 向量库      │  │  save/memory/user_profile.json│
│  存储对话摘要         │  │  用户事实、偏好、关系          │
│  语义检索相关记忆     │  │  增量合并 · 可手动编辑         │
└─────────────────────┘  └──────────────────────────────┘
```

### Tier 1: 工作记忆 (Working Memory)
- **存储**：内存（`self.turns` 列表）
- **容量**：最近 N 轮对话（默认 20）
- **用途**：直接拼接到 LLM 上下文的 `{chat_history}`
- **变化**：无

### Tier 2: 情节记忆 (Episodic Memory)
- **存储**：ChromaDB（现有 `save/memory/` 目录）
- **内容**：LLM 生成的对话摘要（替代原始文本）
- **检索**：向量语义检索（`retrieve()` 方法，签名不变）
- **元数据**：`timestamp`、`turn_count`、`topics`、`type="summary"`
- **变化**：归档内容从原始文本升级为 LLM 摘要

### Tier 3: 语义记忆 (Semantic Memory) ← 新增
- **存储**：`save/memory/user_profile.json` 文件
- **内容**：从对话中提取的用户知识
- **更新方式**：
  - 归档时：LLM 结构化提取，增量合并到 JSON
  - 每次回复：LLM 返回的 `user_info` 文本存入 `raw_notes` 字段（替代 me.txt）
- **加载**：每次构建上下文时读取，格式化后填入 `{user_info}` 占位符
- **可编辑**：用户可直接编辑 JSON 文件修正信息

---

## 用户画像结构 (`user_profile.json`)

```json
{
  "basic_info": {
    "name": "",
    "gender": "",
    "location": "",
    "occupation": "",
    "birthday": ""
  },
  "preferences": [],
  "interests": [],
  "life_events": [],
  "relationships": [],
  "other_facts": [],
  "raw_notes": "",
  "last_updated": ""
}
```

**字段说明：**

| 字段 | 类型 | 说明 |
|---|---|---|
| `basic_info` | object | 用户基本信息，字段值为字符串，空字符串表示未知 |
| `preferences` | string[] | 用户偏好，如 `["喜欢吃辣", "讨厌看恐怖片"]` |
| `interests` | string[] | 兴趣爱好，如 `["编程", "动漫", "猫"]` |
| `life_events` | string[] | 重要事件，如 `["2024-01 开始学日语"]` |
| `relationships` | string[] | 人际/宠物关系，如 `["有一只猫叫小白"]` |
| `other_facts` | string[] | 其他事实，如 `["经常熬夜", "是程序员"]` |
| `raw_notes` | string | LLM 每次回复提取的原始文本（替代 me.txt） |
| `last_updated` | string | ISO 格式时间戳 |

---

## 文件边界

### 修改文件
- `backend/conversation.py`：三层记忆架构，摘要归档 + 画像管理
- `backend/main_agent.py`：传入 LLM 实例，切换到 user_profile.json

### 新建文件
- `save/memory/user_profile.json`：运行时自动创建（不提交 git）

### 不得修改
- `prompts/reply.txt`（角色人设独立维护）
- ChromaDB 的 collection 名称（保持与现有数据兼容）
- `ConversationTurn` 类
- `get_context()` 和 `retrieve()` 方法的**签名**（内部行为可变）

### 废弃
- `save/me.txt`：由 `save/memory/user_profile.json` 的 `raw_notes` 字段替代

---

## 依赖

- `01-provider-framework`（需要 `get_llm()`）
- `02-llm-providers`（需要 LLM 能正常工作）

---

## 实现要求

### 1. `conversation.py` 修改

#### `ConversationHistory.__init__()` 新增参数

```python
PROFILE_PATH = os.path.join(os.path.dirname(__file__), "..", "save", "memory", "user_profile.json")

DEFAULT_PROFILE = {
    "basic_info": {
        "name": "", "gender": "", "location": "",
        "occupation": "", "birthday": ""
    },
    "preferences": [],
    "interests": [],
    "life_events": [],
    "relationships": [],
    "other_facts": [],
    "raw_notes": "",
    "last_updated": ""
}

def __init__(self, max_turns: int = 20, llm_provider=None):
    ...
    self.llm_provider = llm_provider  # 用于生成摘要和提取画像，None 时降级
```

#### `_auto_archive()` 升级逻辑

```python
async def _auto_archive(self):
    if not self.turns:
        return

    archive_count = len(self.turns) // 2
    archive_turns = self.turns[:archive_count]

    # LLM 双重提取：摘要 + 用户画像
    result = await self._extract_memory(archive_turns)

    print(f"[Memory] 归档 {archive_count} 轮对话")
    print(f"[Memory] 摘要: {result['summary'][:100]}...")

    # Tier 2: 摘要存入 ChromaDB
    self.collection.add(
        documents=[result["summary"]],
        metadatas=[{
            "timestamp": datetime.now().isoformat(),
            "turn_count": archive_count,
            "topics": result.get("topics", ""),
            "type": "summary"
        }],
        ids=[str(uuid.uuid4())]
    )

    # Tier 3: 用户画像增量合并
    if result.get("user_facts"):
        self._merge_profile(result["user_facts"])

    self.turns = self.turns[archive_count:]
```

#### `_extract_memory()` 方法（双重提取）

```python
async def _extract_memory(self, turns: list) -> dict:
    """
    用 LLM 从对话中提取摘要和用户画像。
    返回: {"summary": str, "topics": str, "user_facts": dict | None}
    失败时降级为原始文本摘要，user_facts 为 None。
    """
    if not self.llm_provider:
        return {
            "summary": "\n".join(str(t) for t in turns),
            "topics": "",
            "user_facts": None
        }

    conversation_text = "\n".join(str(t) for t in turns)

    prompt = f"""请分析以下对话记录，提取两部分信息：

## 对话记录
{conversation_text}

## 要求
请严格按以下 JSON 格式返回（不要包含其他文字）：
{{
  "summary": "对话摘要，100字以内，保留关键信息和重要细节",
  "topics": "话题关键词，逗号分隔，如：美食,旅行,工作",
  "user_facts": {{
    "basic_info": {{}},
    "preferences": [],
    "interests": [],
    "life_events": [],
    "relationships": [],
    "other_facts": []
  }}
}}

注意：
- summary 必须简洁，概括对话的核心内容
- user_facts 中只填写本次对话中**新发现**的用户信息，没有则留空数组/空对象
- basic_info 只填写明确提到的字段（name/gender/location/occupation/birthday）
- 不要编造信息，只提取用户明确说过的内容"""

    try:
        raw = await self.llm_provider.chat(
            [{"role": "user", "content": prompt}],
            temperature=0.3
        )
        data = self._parse_extraction(raw)
        return data
    except Exception as e:
        print(f"[Memory] LLM 提取失败，降级为原始文本: {e}")
        return {
            "summary": "\n".join(str(t) for t in turns),
            "topics": "",
            "user_facts": None
        }
```

#### `_parse_extraction()` 方法

```python
def _parse_extraction(self, raw: str) -> dict:
    """解析 LLM 返回的 JSON，支持 markdown 代码块包裹"""
    import re

    text = raw.strip()

    # 尝试直接解析
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        # 尝试提取 markdown 代码块中的 JSON
        pattern = r'```(?:json\n|\n)?([^`]*?)```'
        match = re.search(pattern, text, re.DOTALL)
        if match:
            data = json.loads(match.group(1).strip())
        else:
            raise ValueError(f"无法解析 LLM 返回: {text[:200]}")

    # 确保必要字段存在
    return {
        "summary": data.get("summary", ""),
        "topics": data.get("topics", ""),
        "user_facts": data.get("user_facts", None)
    }
```

#### 用户画像管理方法

```python
def load_profile(self) -> dict:
    """加载用户画像，文件不存在时返回默认结构"""
    try:
        if os.path.exists(self.PROFILE_PATH):
            with open(self.PROFILE_PATH, "r", encoding="utf-8") as f:
                profile = json.load(f)
                # 确保所有字段存在（兼容旧版本）
                for key, default_value in self.DEFAULT_PROFILE.items():
                    if key not in profile:
                        profile[key] = default_value
                return profile
    except Exception as e:
        print(f"[Memory] 加载用户画像失败: {e}")
    return json.loads(json.dumps(self.DEFAULT_PROFILE))  # deep copy

def _save_profile(self, profile: dict) -> None:
    """保存用户画像到文件"""
    os.makedirs(os.path.dirname(self.PROFILE_PATH), exist_ok=True)
    profile["last_updated"] = datetime.now().isoformat()
    with open(self.PROFILE_PATH, "w", encoding="utf-8") as f:
        json.dump(profile, f, ensure_ascii=False, indent=2)

def _merge_profile(self, new_facts: dict) -> None:
    """将新提取的用户信息增量合并到画像中"""
    profile = self.load_profile()

    # 合并 basic_info（只覆写非空字段）
    for key, value in new_facts.get("basic_info", {}).items():
        if value and key in profile["basic_info"]:
            profile["basic_info"][key] = value

    # 合并数组字段（去重追加）
    array_fields = ["preferences", "interests", "life_events", "relationships", "other_facts"]
    for field in array_fields:
        existing = profile.get(field, [])
        new_items = new_facts.get(field, [])
        for item in new_items:
            if item and item not in existing:
                existing.append(item)
        profile[field] = existing

    self._save_profile(profile)
    print(f"[Memory] 用户画像已更新")

def update_raw_notes(self, notes: str) -> None:
    """更新 raw_notes 字段（由 main_agent 每次回复时调用，替代 me.txt）"""
    if not notes:
        return
    profile = self.load_profile()
    profile["raw_notes"] = notes
    self._save_profile(profile)

def format_profile(self) -> str:
    """将用户画像格式化为可读文本，用于填入 prompt 的 {user_info} 占位符"""
    profile = self.load_profile()
    parts = []

    # basic_info
    info_items = {k: v for k, v in profile.get("basic_info", {}).items() if v}
    if info_items:
        labels = {"name": "名字", "gender": "性别", "location": "所在地",
                  "occupation": "职业", "birthday": "生日"}
        info_str = "、".join(f"{labels.get(k, k)}: {v}" for k, v in info_items.items())
        parts.append(f"基本信息：{info_str}")

    # 数组字段
    field_labels = {
        "preferences": "偏好", "interests": "兴趣",
        "life_events": "近况", "relationships": "关系",
        "other_facts": "其他"
    }
    for field, label in field_labels.items():
        items = profile.get(field, [])
        if items:
            parts.append(f"{label}：{'、'.join(items)}")

    # raw_notes（LLM 每轮提取的原始文本，作为补充）
    raw = profile.get("raw_notes", "").strip()
    if raw and not parts:
        # 如果结构化字段为空，直接用 raw_notes（过渡期兼容）
        return raw

    return "\n".join(parts) if parts else ""
```

#### `add_dialog()` 改为 async

```python
async def add_dialog(self, user_message: str, assistant_message: str):
    turn = ConversationTurn(user_message, assistant_message)
    self.turns.append(turn)
    if len(self.turns) >= self.max_turns:
        await self._auto_archive()
```

#### `get_context()` 增强（签名不变）

```python
def get_context(self) -> str:
    """获取格式化后的对话上下文（签名不变，内部增强）"""
    return "\n".join(str(turn) for turn in self.turns)
```

> 注意：`get_context()` 保持只返回当前对话轮次。用户画像通过 `format_profile()` 单独获取，由 `main_agent.py` 填入 prompt 的 `{user_info}` 占位符。这样保持了职责清晰：`get_context()` = 工作记忆，`format_profile()` = 语义记忆，`retrieve()` = 情节记忆。

---

### 2. `main_agent.py` 修改

#### `__init__()` 变更

```python
def __init__(self, llm_service, conversation_history: ConversationHistory):
    self.conversation_history = conversation_history
    self.llm_service = llm_service
    with open("prompts/reply.txt", "r", encoding="utf-8") as file:
        self.prompt_template = file.read()

    self.log_dir = "save/log"
    os.makedirs(self.log_dir, exist_ok=True)

    # 用户信息改为从 user_profile.json 读取（替代 me.txt）
    # self.user_info_file = "save/me.txt"  ← 废弃
    # self.user_info = self._load_user_info()  ← 废弃
```

#### 用户信息读取改用 `format_profile()`

```python
# 旧方式（废弃）
# self.user_info → 从 me.txt 读取的纯文本

# 新方式：所有需要 user_info 的地方改为
user_info = self.conversation_history.format_profile()
```

具体影响的方法：

- `reply_stream()` 中：`user_info=self.user_info` → `user_info=self.conversation_history.format_profile()`
- `_generate_reply()` 中：同上
- `_handle_full_response()` 中：`self._save_user_info(data["user_info"])` → `self.conversation_history.update_raw_notes(data["user_info"])`

#### 删除废弃方法

移除 `_load_user_info()` 和 `_save_user_info()`，以及 `self.user_info_file` 和 `self.user_info` 属性。

---

### 3. `chat_service.py` 修改

将 LLM provider 传入 ConversationHistory：

```python
class ChatService:
    def __init__(self):
        self.llm_adapter = LLMProviderAdapter()
        self.conversation_history = ConversationHistory(
            max_turns=Config.MAX_TURNS,
            llm_provider=get_llm()    # 传入 LLM provider 供记忆系统使用
        )
        self.main_agent = MainAgent(self.llm_adapter, self.conversation_history)
```

---

## 数据流总览

### 每次用户对话

```
用户发消息
    ↓
main_agent 构建 prompt:
    user_info ← conversation_history.format_profile()    ← Tier 3 语义记忆
    chat_history ← conversation_history.get_context()    ← Tier 1 工作记忆
    memory ← conversation_history.retrieve(message)      ← Tier 2 情节记忆
    ↓
LLM 生成回复 (含 reply + user_info + expression)
    ↓
main_agent 处理回复:
    保存 user_info → conversation_history.update_raw_notes()  ← 更新 raw_notes
    记录对话 → conversation_history.add_dialog()              ← 更新工作记忆
    ↓
如果 turns >= 20，触发 _auto_archive():
    LLM 双重提取 → summary + user_facts
    summary → ChromaDB                                        ← 更新情节记忆
    user_facts → _merge_profile()                             ← 更新语义记忆
    移除已归档的对话轮次
```

### 过渡期兼容

- 如果 `user_profile.json` 不存在且 `me.txt` 存在，`format_profile()` 可回退读取 `me.txt`（可选实现，非强制）
- 现有 ChromaDB 中的原始文本记录（`type` 字段不存在的旧数据）仍可被 `retrieve()` 正常检索
- 新归档的数据带有 `type="summary"` 元数据，可区分新旧记录

---

## 约束

- 摘要/提取失败时**必须降级**为原始文本归档 + 跳过画像更新，不能让归档流程崩溃
- 不改变 `retrieve()` 的接口签名和查询行为
- 不更改 ChromaDB 的 collection 名称（保持与现有数据兼容）
- 不修改 `prompts/reply.txt`
- 提取 prompt 中不包含 Nana 的角色设定（保持通用性）
- `user_profile.json` 写入时必须使用 `encoding="utf-8"`
- `save/memory/` 目录不提交到 git（已在 `.gitignore` 中）

---

## 验收标准

- [ ] 对话超过 20 轮后触发归档，ChromaDB 中存储的是 LLM 摘要而非原始文本
- [ ] 归档时自动提取用户画像，增量合并到 `user_profile.json`
- [ ] LLM 不可用时，降级为原始文本归档 + 跳过画像更新，不报错
- [ ] `user_profile.json` 中的信息只增量追加，不丢失已有信息
- [ ] `format_profile()` 能将结构化画像格式化为可读文本
- [ ] `main_agent.py` 每次回复时将 `user_info` 存入 `raw_notes`（替代 me.txt）
- [ ] 归档后的摘要能被 `retrieve()` 正常检索到
- [ ] 现有 ChromaDB 旧数据（原始文本）仍可检索
- [ ] `user_profile.json` 可被用户手动编辑，编辑后的内容在下次对话中生效

---

## 未来演进方向（不在本 spec 范围内）

以下改进可在本 spec 完成后逐步实现：

1. **混合检索**：在 ChromaDB 向量检索基础上增加关键词检索（参考 OpenClaw 的 hybrid search）
2. **画像去重与整理**：归档时用 LLM 清理 `user_profile.json`，合并相似条目、移除过时信息
3. **记忆日志**：参考 OpenClaw 的 `memory/YYYY-MM-DD.md` 日志机制，按日期保存对话摘要文件
4. **上下文压缩前抢救**：参考 OpenClaw 的 memory flush 机制，在对话即将超长时自动保存重要信息
5. **Embedding 缓存**：按内容 hash 缓存 embedding 结果，避免重复计算
6. **时间衰减**：对情节记忆施加时间衰减权重，让近期记忆更容易被检索到
