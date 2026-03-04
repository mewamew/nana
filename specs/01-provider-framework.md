# 01-provider-framework — Provider 基础框架

**Status: ✅ Implemented** (2026-03-04)

## 背景与目标

当前项目配置硬编码在 `config.py` 中，LLM/TTS 没有抽象层，无法灵活切换。
本 spec 建立整个 Provider 架构的基础：配置管理器 + 各 Provider 基类 + 工厂函数。

**其他所有 spec（02~07）都依赖本 spec 的输出。**

---

## 文件边界

### 新建文件
- `backend/config_manager.py`
- `backend/providers/__init__.py`
- `backend/providers/llm/__init__.py`
- `backend/providers/llm/base.py`
- `backend/providers/tts/__init__.py`
- `backend/providers/tts/base.py`
- `backend/providers/stt/__init__.py`
- `backend/providers/stt/base.py`
- `config.example.json`（项目根目录）

### 修改文件
- `.gitignore`：添加 `config.json`

### 不得修改
- `backend/config.py`（保留但标记为废弃，兼容旧代码，后续 spec 逐步替换引用）
- 其他任何现有文件

---

## 依赖

无（本 spec 是所有其他 spec 的基础）

---

## 接口契约

### ConfigManager

```python
class ConfigManager:
    CONFIG_PATH = "../config.json"   # 相对于 backend/ 目录

    @classmethod
    def load(cls) -> dict:
        """加载完整配置，文件不存在时从 config.example.json 复制并返回默认值"""

    @classmethod
    def save(cls, config: dict) -> None:
        """保存完整配置到 config.json"""

    @classmethod
    def get_llm_config(cls) -> dict:
        """返回 config["llm"]"""

    @classmethod
    def get_tts_config(cls) -> dict:
        """返回 config["tts"]"""

    @classmethod
    def get_stt_config(cls) -> dict:
        """返回 config["stt"]"""

    @classmethod
    def update(cls, partial_config: dict) -> dict:
        """
        深度合并 partial_config 到现有配置并保存。
        返回更新后的完整配置。
        示例：update({"llm": {"active": "qwen"}}) 只更新 active 字段
        """

    @classmethod
    def get_masked(cls) -> dict:
        """
        返回脱敏配置（api_key 替换为 '***'），用于前端展示。
        仅对非空的 api_key 做脱敏，空字符串保持为空字符串。
        """
```

### 基类接口（详见 ARCHITECTURE.md 第 5 节）

`BaseLLMProvider`、`BaseTTSProvider`、`BaseSTTProvider` 严格按照 ARCHITECTURE.md 中的定义实现。

### 工厂函数（`providers/__init__.py`）

```python
def get_llm() -> BaseLLMProvider: ...
def get_tts() -> BaseTTSProvider: ...
def get_stt() -> BaseSTTProvider: ...
```

工厂函数每次调用都**重新读取** `ConfigManager`，保证配置变更后立即生效（热重载）。

---

## 实现要求

### `config_manager.py`

1. `CONFIG_PATH` 相对路径计算：`os.path.join(os.path.dirname(__file__), "..", "config.json")`
2. `load()` 逻辑：
   - 文件存在 → 读取并返回
   - 文件不存在 → 读取 `config.example.json`，写入 `config.json`，返回默认配置
   - 读取失败 → 打印错误，返回空配置结构 `{"llm": {...}, "tts": {...}, "stt": {...}}`
3. `update()` 使用递归深度合并，不是简单覆盖
4. `get_masked()` 递归遍历所有 `api_key` 字段，非空则替换为 `"***"`

### `config.example.json`

严格按照 ARCHITECTURE.md 第 4 节的完整结构，所有 `api_key` 为空字符串。

### 基类文件

- `base.py` 中只有抽象基类定义，不包含任何具体实现
- `BaseLLMProvider` 提供 `chat()` 的默认实现（聚合 `chat_stream()`）
- `BaseTTSProvider` 提供 `is_configured()` 默认返回 `True`
- `__init__.py` 文件只做导入，不包含逻辑

### `.gitignore`

在现有内容基础上追加：
```
# 运行时配置（含 API Key，不提交）
config.json
```

---

## 约束

- `ConfigManager` 不做缓存，每次调用都从磁盘读取（性能不是瓶颈，热重载更重要）
- 不引入任何新的第三方依赖（只用标准库 `json`、`os`、`copy`）
- `providers/__init__.py` 中的工厂函数在 Provider 类未找到时抛出 `ValueError` 并附带清晰错误信息

---

## 验收标准

- [ ] `config.example.json` 存在于项目根目录，结构完整
- [ ] `config.json` 已加入 `.gitignore`
- [ ] `ConfigManager.load()` 在 `config.json` 不存在时能自动创建
- [ ] `ConfigManager.get_masked()` 正确脱敏 api_key
- [ ] `ConfigManager.update({"llm": {"active": "qwen"}})` 只更新 active，不影响其他字段
- [ ] `get_llm()` / `get_tts()` / `get_stt()` 能根据 config.json 返回正确的 Provider 实例（此时具体 Provider 类由 02/03/04 spec 实现后才能完整测试）
- [ ] 所有基类都是抽象类，直接实例化会抛出 `TypeError`
