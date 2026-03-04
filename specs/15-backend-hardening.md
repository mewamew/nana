# 15-backend-hardening — 后端健壮性优化

**Status: 📋 Planned**

## 背景

经过代码审查，发现后端存在以下需要优化的问题。这些问题不影响核心功能，但会影响稳定性和安全性。

---

## 优化项

### 1. 日志写文件改为异步

**问题**：`conversation.py` 中日志写入使用同步 `open()` + `write()`，会阻塞事件循环。

**方案**：使用 `aiofiles` 或将写入操作丢到线程池（`asyncio.to_thread`）。

---

### 2. 修复 SSL 验证被禁用

**问题**：`providers/llm/openai_compatible.py` 中 httpx 客户端设置了 `verify=False`，跳过了 SSL 证书验证，存在中间人攻击风险。

**方案**：移除 `verify=False`，恢复默认的 SSL 验证。如果特定本地服务（如 Ollama、LM Studio）需要跳过验证，可根据 `base_url` 是否为 localhost 来决定。

---

### 3. JSON 文件存储加锁

**问题**：`conversation.py` 中 `summaries.json` 和 `user_profile.json` 的读写没有文件锁，并发写入可能导致数据丢失。

**方案**：
- 短期：使用 `asyncio.Lock` 保护写入操作
- 长期：考虑迁移到 SQLite（通过 `aiosqlite`），天然支持并发和事务

---

### 4. 进程管理优化

**问题**：uvicorn `--reload` 模式下，杀掉 reloader 父进程后，worker 子进程变成孤儿进程继续运行，导致端口无法释放。

**方案**：
- 开发环境：使用 `--workers 1` 避免 multiprocessing，或用 `taskkill //F //T`（带 `/T` 杀进程树）
- 可选：在 `main.py` 中注册 `signal handler`，收到终止信号时清理子进程
