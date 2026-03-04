# OpenClaw 记忆系统技术方案

> 本文档是对 D:\dev\openclaw 项目记忆系统的完整技术调研，用于指导 Nana 项目记忆系统的改造设计。

---

## 一、核心理念

**Markdown 文件即记忆源（Single Source of Truth）**

OpenClaw 不通过数据库 CRUD 管理记忆内容。所有记忆的唯一权威来源是磁盘上的 Markdown 文件，数据库只是这些文件的**索引副本**，随时可以从文件重建。

```
workspace/
├── MEMORY.md              # 长期记忆（精炼的事实、决策、偏好）
└── memory/
    └── YYYY-MM-DD.md      # 每日记忆日志（追加写入）
```

- `MEMORY.md` — 人工整理的长期记忆，只在主会话/私聊中加载
- `memory/YYYY-MM-DD.md` — 每日流水记忆，启动时自动加载今天和昨天的内容
- 所有文件可以直接用编辑器修改，也可以用 git 管理版本

---

## 二、整体架构

```
┌─────────────────────────────────────────────────────┐
│                   Agent 层                           │
│  memory_search(query)    memory_get(path, from, lines) │
└──────────────┬──────────────────────┬───────────────┘
               │                      │
┌──────────────▼──────────────────────▼───────────────┐
│              Search Manager (路由层)                  │
│  ┌─────────────────┐    ┌────────────────────────┐   │
│  │  QMD Backend     │    │  Builtin Backend       │   │
│  │  (实验性外部进程) │    │  (SQLite, 默认)        │   │
│  └────────┬────────┘    └───────────┬────────────┘   │
│           │  失败时自动降级 ──────────→│               │
└───────────┴─────────────────────────┴───────────────┘
                                      │
┌─────────────────────────────────────▼───────────────┐
│              MemoryIndexManager                      │
│                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────┐ │
│  │ Sync Ops     │  │ Embedding Ops│  │ Search     │ │
│  │ (文件同步)    │  │ (向量生成)   │  │ (混合检索) │ │
│  └──────┬───────┘  └──────┬───────┘  └─────┬──────┘ │
│         │                 │                 │        │
│  ┌──────▼─────────────────▼─────────────────▼──────┐ │
│  │               SQLite 数据库                      │ │
│  │  chunks | chunks_vec | chunks_fts | cache | meta│ │
│  └─────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
```

---

## 三、存储层：SQLite 数据库

每个 Agent 有独立的 SQLite 数据库，路径为 `~/.openclaw/state/memory/{agentId}.sqlite`。

### 3.1 数据表

| 表名 | 作用 | 主要字段 |
|------|------|---------|
| `meta` | 索引元数据 | `key TEXT PK, value TEXT` |
| `files` | 已索引文件跟踪 | `path TEXT PK, source TEXT, hash TEXT, mtime INT, size INT` |
| `chunks` | 文本分块+向量 | `id TEXT PK, path, source, start_line, end_line, hash, model, text, embedding, updated_at` |
| `chunks_vec` | sqlite-vec 虚拟表 | `id TEXT PK, embedding FLOAT[dims]` — 用于快速向量相似度检索 |
| `chunks_fts` | FTS5 全文索引 | `text`(索引列), `id, path, source, model, start_line, end_line`(UNINDEXED) |
| `embedding_cache` | Embedding 缓存 | `provider, model, provider_key, hash`(复合PK), `embedding, dims, updated_at` |

### 3.2 索引元数据 (meta 表)

存储在 key = `"memory_index_meta_v1"` 中，JSON 格式：

```typescript
{
  model: string;          // embedding 模型名
  provider: string;       // provider 名称
  providerKey?: string;   // provider 配置 hash（用于检测配置变更）
  sources?: string[];     // 数据来源列表 ["memory", "sessions"]
  chunkTokens: number;    // 分块大小
  chunkOverlap: number;   // 分块重叠
  vectorDims?: number;    // 向量维度
}
```

当任何字段与当前配置不匹配时，触发**全量重建索引**。

### 3.3 Chunk ID 生成

```
id = SHA-256("{source}:{path}:{startLine}:{endLine}:{textHash}:{model}")
```

---

## 四、Embedding 层

### 4.1 支持的 Provider

| Provider | 默认模型 | 类型 | 备注 |
|----------|---------|------|------|
| local | `embeddinggemma-300m-qat-Q8_0.gguf` | 本地 (node-llama-cpp) | 免费离线，auto 模式最优先 |
| openai | `text-embedding-3-small` | 远程 API | auto 模式第二优先 |
| gemini | `gemini-embedding-001` | 远程 API | |
| voyage | `voyage-4-large` | 远程 API | |
| mistral | `mistral-embed` | 远程 API | |
| ollama | `nomic-embed-text` | 本地服务 | 不参与 auto 选择 |

### 4.2 Auto 模式选择顺序

1. **Local** — 如果本地模型文件存在（不是 URL）
2. **OpenAI** — 如果有 API key
3. **Gemini** — 如果有 API key
4. **Voyage** — 如果有 API key
5. **Mistral** — 如果有 API key
6. 全部失败 → **FTS-only 模式**（纯关键词检索）

### 4.3 Embedding 接口

```typescript
type EmbeddingProvider = {
  id: string;
  model: string;
  maxInputTokens?: number;
  embedQuery(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
};
```

### 4.4 Embedding 缓存

- 缓存键：`(provider, model, provider_key, hash)` — 其中 hash 是文本内容的 SHA-256
- 所有 embedding 在存储前做 **L2 归一化**（`sanitizeAndNormalizeEmbedding`）
- 超过 `maxEntries` 时按 `updated_at` 淘汰最旧的
- 文件内容没变 = hash 没变 = 命中缓存，跳过 embedding 计算

### 4.5 批量处理

```
EMBEDDING_BATCH_MAX_TOKENS = 8000     // 单批最大 token 数
EMBEDDING_INDEX_CONCURRENCY = 4       // 并发数
EMBEDDING_RETRY_MAX_ATTEMPTS = 3      // 最大重试次数
EMBEDDING_RETRY_BASE_DELAY_MS = 500   // 重试基础延迟
EMBEDDING_RETRY_MAX_DELAY_MS = 8000   // 重试最大延迟
```

- 支持 OpenAI / Gemini / Voyage 的异步 Batch API（提交 job → 轮询结果）
- 重试逻辑：指数退避 + 抖动，仅对 `rate_limit / 429 / 5xx` 等错误重试
- 超时：远程 2 分钟，本地 10 分钟
- 批量 API 连续失败 2 次后自动禁用，降级为逐条调用

### 4.6 降级与容错

```
配置的 Provider 失败 → 尝试 fallback Provider → 仍失败 → FTS-only 模式
```

如果在索引过程中发现 embedding 相关错误，会自动尝试激活 fallback provider 并重新索引。

---

## 五、同步机制（文件 → 索引）

### 5.1 触发时机

| 触发条件 | 配置项 | 默认值 |
|---------|--------|--------|
| 搜索前 | `sync.onSearch` | `true` |
| Session 启动时 | `sync.onSessionStart` | `true` |
| 文件变化（chokidar 监听） | `sync.watch` | `true` |
| 定时轮询 | `sync.intervalMinutes` | 未设置（0=不启用） |
| Session 对话增量达到阈值 | `sync.sessions.deltaBytes / deltaMessages` | `100KB / 50条` |

### 5.2 文件监听

使用 chokidar 监听以下路径：
- `MEMORY.md`, `memory.md`（根目录）
- `memory/**/*.md`（递归子目录）
- `extraPaths` 中配置的额外路径

忽略目录：`.git, node_modules, .pnpm-store, .venv, venv, .tox, __pycache__`

防抖：`watchDebounceMs = 1500ms`（文件变化后等待稳定再触发同步）

### 5.3 增量同步流程

```
1. listMemoryFiles() → 列出所有 .md 文件
2. buildFileEntry() → 计算每个文件的 hash (SHA-256)
3. 对比数据库中已有记录:
   - hash 相同 → 跳过
   - hash 不同 → 重新索引该文件
   - 数据库中有但磁盘没有 → 删除索引记录
4. indexFile(entry):
   a. 读取文件内容
   b. chunkMarkdown() → 分块
   c. embedChunksInBatches() → 生成 embedding（命中缓存则跳过）
   d. 写入 chunks / chunks_vec / chunks_fts 表
   e. 更新 files 表
```

### 5.4 全量重建索引

当配置变更（model、provider、分块参数等）导致元数据不匹配时，执行**安全重建**：

```
1. 创建临时数据库 {dbPath}.tmp-{uuid}
2. 从旧数据库拷贝 embedding cache 到新库（避免重算）
3. 在新库中索引所有文件
4. 原子交换：旧库 → 备份，新库 → 正式，删除备份
5. 失败则恢复旧库
```

### 5.5 Session 文件同步

Session 对话记录（`~/.openclaw/state/agents/<agentId>/sessions/*.jsonl`）的同步：

```
1. 监听 onSessionTranscriptUpdate 事件
2. 防抖 5 秒
3. 检查增量：bytes 变化 > 100KB 或 messages 变化 > 50 条
4. 满足阈值 → 标记 dirty → 触发 sync
5. buildSessionEntry():
   a. 解析 JSONL，筛选 type="message" 的 user/assistant 消息
   b. 提取文本内容
   c. redactSensitiveText() → 脱敏
   d. 格式化为 "User: xxx\nAssistant: xxx"
   e. 构建 lineMap（内容行号 → 原始 JSONL 行号的映射）
```

---

## 六、分块策略

### 6.1 参数

```
DEFAULT_CHUNK_TOKENS = 400    // 每块最大 token 数
DEFAULT_CHUNK_OVERLAP = 80    // 块间重叠 token 数
```

### 6.2 算法 (`chunkMarkdown`)

```
maxChars = max(32, tokens * 4)      // 1 token ≈ 4 字符（近似）
overlapChars = max(0, overlap * 4)

1. 按换行符拆分文件内容为行数组
2. 逐行累积到当前块：
   - 如果加入当前行后不超过 maxChars → 追加
   - 如果超过 → flush 当前块，从上一块末尾携带 overlapChars 的行作为下一块开头
3. 超长单行（>maxChars）→ 按 maxChars 截断为多个片段
4. 每个块记录: startLine(1-indexed), endLine, text, hash(SHA-256)
```

### 6.3 Provider 输入限制

如果 provider 有 `maxInputTokens` 限制，分块后还会过滤掉超长的 chunk（`enforceEmbeddingMaxInputTokens`）。

---

## 七、搜索系统

### 7.1 搜索入口

Agent 调用 `memory_search(query)` 工具 → `MemoryIndexManager.search(query, opts)`

### 7.2 两种模式

#### FTS-only 模式（无 Embedding Provider）

```
查询 → extractKeywords(query)
     → 对每个关键词独立调用 searchKeyword()
     → 合并/去重（同一 chunk 取最高分）
     → 过滤 minScore → 取 top maxResults
```

#### Hybrid 模式（有 Embedding Provider）

```
查询
  ├── 向量搜索:
  │     embedQueryWithTimeout(query) → 查询 embedding
  │     searchVector() → 在 chunks_vec 表中找最近邻
  │     返回 N*candidateMultiplier 个候选
  │
  └── 关键词搜索:
        extractKeywords(query) → 提取关键词
        searchKeyword() → FTS5 BM25 检索
        bm25RankToScore() → rank 转 0~1 分数
        返回 N*candidateMultiplier 个候选

合并: mergeHybridResults()
  → 按 chunk id 合并两路结果
  → score = vectorWeight * vectorScore + textWeight * textScore
  → 时间衰减（可选）
  → 排序
  → MMR 去重（可选）
  → 过滤 minScore
  → 取 top maxResults
```

### 7.3 默认参数

```
maxResults = 6                     // 最多返回 6 条
minScore = 0.35                    // 最低分数阈值
candidateMultiplier = 4            // 候选池 = maxResults * 4
vectorWeight = 0.7                 // 向量搜索权重
textWeight = 0.3                   // 关键词搜索权重
```

向量权重和文本权重会被归一化，确保和为 1.0。

### 7.4 向量搜索 (`searchVector`)

**有 sqlite-vec 扩展时：**

```sql
SELECT c.id, c.path, c.start_line, c.end_line, c.text, c.source,
       vec_distance_cosine(v.embedding, ?) AS dist
FROM chunks_vec v
JOIN chunks c ON c.id = v.id
WHERE c.model = ?
ORDER BY dist ASC
LIMIT ?
```

score = 1 - dist（距离转相似度）

**无 sqlite-vec 时（JS 降级）：**

加载所有 chunks → 在 JS 中计算 cosine similarity → 排序取 top N

### 7.5 关键词搜索 (`searchKeyword`)

```sql
SELECT id, path, source, start_line, end_line, text, bm25(chunks_fts) AS rank
FROM chunks_fts
WHERE chunks_fts MATCH ?
ORDER BY rank ASC
LIMIT ?
```

BM25 rank 转分数：`score = 1 / (1 + max(0, rank))`

FTS 查询构建：`"hello" AND "world"`（每个 token 用双引号包裹，AND 连接）

### 7.6 松弛降级

如果严格 minScore 过滤后没有结果，但关键词搜索有命中，则放宽阈值到 `min(minScore, textWeight)` 并只返回关键词匹配的结果。这确保了不会因为向量搜索拉低了分数而完全空手。

### 7.7 关键词提取 (`extractKeywords`)

支持 7 种语言的停用词：英语(119词)、西班牙语、葡萄牙语、阿拉伯语、韩语、日语、中文。

分词策略因语言而异：
- **英文等**：按空格+标点分割
- **中文** (CJK \u4e00-\u9fff)：字符 unigram + bigram
- **日文**：按文字体系(ASCII/片假名/汉字/平假名)拆分，汉字做字符+bigram
- **韩文**：停用词过滤 + 助词剥离

过滤规则：
- 移除所有语言的停用词
- 英文短于 3 字符的排除
- 纯数字排除
- 纯标点排除

---

## 八、高级搜索特性

### 8.1 MMR (Maximal Marginal Relevance) 去重

**目的**：避免返回的结果内容过于相似，增加多样性。

**默认关闭**（`mmr.enabled = false, lambda = 0.7`）

**算法**：
```
1. 对所有候选结果分词（小写 + /[a-z0-9_]+/g）
2. 归一化分数到 [0, 1]
3. 贪心迭代选择：
   对每个剩余候选:
     maxSim = max(jaccard(候选, 已选中的每一个))
     mmrScore = lambda * relevance - (1-lambda) * maxSim
   选 mmrScore 最高的（平局则选原始分数更高的）
```

lambda 越高越侧重相关性，越低越侧重多样性。

### 8.2 时间衰减 (Temporal Decay)

**目的**：让更近期的记忆权重更高。

**默认关闭**（`temporalDecay.enabled = false, halfLifeDays = 30`）

**公式**：
```
decayLambda = ln(2) / halfLifeDays
multiplier = exp(-decayLambda * ageInDays)
decayedScore = score * multiplier
```

**时间提取策略**：
1. 优先从文件名提取日期（如 `memory/2026-03-03.md` → 2026-03-03）
2. "常青"文件（`MEMORY.md`、非日期命名的文件）**不做衰减**
3. 其他回退到文件的 mtime

---

## 九、记忆自动 Flush（压缩前抢救）

当对话即将达到 context window 上限、系统准备做 compaction（压缩上下文）时，OpenClaw 会：

```
1. 检测到 token 估算超过阈值: contextWindow - reserveTokensFloor - softThresholdTokens
2. 发送一个静默的 agentic turn，提示模型将重要信息写入 MEMORY.md
3. 模型可以回复 NO_REPLY 表示没有需要记住的内容
4. 然后再执行上下文压缩
```

配置项：`agents.defaults.compaction.memoryFlush`

**设计要点**：确保不会因为上下文被裁剪而丢失重要信息。

---

## 十、Agent 工具接口

### 10.1 `memory_search`

```typescript
// 输入
{
  query: string;           // 搜索查询
  maxResults?: number;     // 最多返回条数（默认6）
  minScore?: number;       // 最低分数阈值（默认0.35）
}

// 输出
{
  results: Array<{
    path: string;          // 来源文件路径
    startLine: number;     // 起始行号
    endLine: number;       // 结束行号
    score: number;         // 相关度分数
    snippet: string;       // 文本片段（最长700字符）
    source: "memory" | "sessions";
    citation?: string;     // 引用标记 "path#L1-L5"
  }>;
  provider: string;
  model: string;
  mode: "hybrid" | "fts-only";
}
```

### 10.2 `memory_get`

```typescript
// 输入
{
  path: string;            // 相对路径，如 "MEMORY.md" 或 "memory/2026-03-03.md"
  from?: number;           // 起始行号（0-indexed）
  lines?: number;          // 读取行数
}

// 输出
{
  text: string;            // 文件内容
  path: string;            // 规范化路径
}
```

只允许读取 `.md` 文件，路径必须在 workspace 的 memory 目录或 extraPaths 内。

---

## 十一、CLI 命令

```bash
openclaw memory status              # 查看索引状态（文件数、chunk 数、provider 等）
openclaw memory status --deep       # 深度探测（检查 vector/embedding 可用性）
openclaw memory status --deep --index  # 探测 + 脏数据重建索引
openclaw memory index               # 强制重建索引
openclaw memory search "query"      # 手动语义搜索测试
```

---

## 十二、配置体系

完整配置结构（`ResolvedMemorySearchConfig`）：

```typescript
{
  enabled: boolean;
  sources: ("memory" | "sessions")[];
  extraPaths: string[];

  // Embedding 配置
  provider: "openai" | "local" | "gemini" | "voyage" | "mistral" | "ollama" | "auto";
  model: string;
  fallback: "openai" | "local" | "gemini" | "voyage" | "mistral" | "ollama" | "none";
  remote?: {
    baseUrl?: string;
    apiKey?: string;
    headers?: Record<string, string>;
    batch?: { enabled: boolean; wait: boolean; concurrency: number; pollIntervalMs: number; timeoutMinutes: number };
  };
  local?: { modelPath?: string; modelCacheDir?: string };

  // 存储配置
  store: {
    driver: "sqlite";
    path: string;                    // 如 "~/.openclaw/state/memory/{agentId}.sqlite"
    vector: { enabled: boolean; extensionPath?: string };
  };

  // 分块配置
  chunking: {
    tokens: number;                  // 默认 400
    overlap: number;                 // 默认 80
  };

  // 同步配置
  sync: {
    onSessionStart: boolean;
    onSearch: boolean;
    watch: boolean;
    watchDebounceMs: number;         // 默认 1500
    intervalMinutes: number;
    sessions: {
      deltaBytes: number;            // 默认 100_000
      deltaMessages: number;         // 默认 50
    };
  };

  // 搜索配置
  query: {
    maxResults: number;              // 默认 6
    minScore: number;                // 默认 0.35
    hybrid: {
      enabled: boolean;              // 默认 true
      vectorWeight: number;          // 默认 0.7
      textWeight: number;            // 默认 0.3
      candidateMultiplier: number;   // 默认 4
      mmr: { enabled: boolean; lambda: number };                    // 默认关闭, lambda=0.7
      temporalDecay: { enabled: boolean; halfLifeDays: number };    // 默认关闭, 30天
    };
  };

  // 缓存配置
  cache: { enabled: boolean; maxEntries?: number };
}
```

配置合并优先级：Agent 级别覆盖 > 全局默认值

---

## 十三、关键源文件索引

| 文件 | 职责 |
|------|------|
| `src/memory/manager.ts` | MemoryIndexManager 主类，search/readFile/status/sync/close |
| `src/memory/manager-sync-ops.ts` | 文件同步、监听、全量/增量索引、安全重建 |
| `src/memory/manager-embedding-ops.ts` | Embedding 生成、缓存、批量处理、重试 |
| `src/memory/manager-search.ts` | 向量搜索 (searchVector)、关键词搜索 (searchKeyword) |
| `src/memory/hybrid.ts` | 混合评分合并、BM25 rank 转 score、FTS 查询构建 |
| `src/memory/mmr.ts` | MMR 去重算法（Jaccard 相似度 + 贪心选择） |
| `src/memory/temporal-decay.ts` | 时间衰减（指数衰减，半衰期模型） |
| `src/memory/query-expansion.ts` | 多语言关键词提取（7种语言停用词 + 分词） |
| `src/memory/embeddings.ts` | 6种 Embedding Provider 初始化、auto 选择、降级 |
| `src/memory/memory-schema.ts` | SQLite 建表语句（6张表） |
| `src/memory/memory-tool.ts` | Agent 工具定义（memory_search, memory_get） |
| `src/memory/internal.ts` | 工具函数（文件列举、hash、分块、cosine 相似度） |
| `src/memory/session-files.ts` | Session JSONL 解析、脱敏、内容提取 |
| `src/memory/sqlite-vec.ts` | sqlite-vec 扩展加载 |
| `src/memory/search-manager.ts` | 后端路由工厂（QMD / Builtin / Fallback） |
| `src/agents/memory-search.ts` | 配置类型定义、默认值、配置合并逻辑 |
| `src/config/types.memory.ts` | 顶层 memory 配置类型 |

---

## 十四、设计特点总结

| 特点 | 说明 |
|------|------|
| 文件即真相 | Markdown 文件是权威来源，数据库只是可重建的索引 |
| 被动索引 | 不提供写入 API，只监听文件变化自动索引 |
| 混合检索 | 向量(0.7) + 关键词(0.3) 双路搜索，互相兜底 |
| 多级降级 | Provider → Fallback Provider → FTS-only；sqlite-vec → JS cosine |
| 安全重建 | 全量重建使用临时库 + 原子交换，不会损坏现有数据 |
| 缓存友好 | Embedding 按内容 hash 缓存，文件没变就不重算 |
| 压缩前抢救 | Context compaction 前自动 flush 重要记忆到文件 |
| 多语言支持 | 关键词提取支持 7 种语言的停用词和分词策略 |
| 可观测 | CLI 可查状态、手动搜索、强制重建 |
