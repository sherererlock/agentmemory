**整体流程**
- 可以把它理解成一条闭环：`代理行为` -> `采集` -> `压缩/建模` -> `索引/存储` -> `检索` -> `把相关记忆返回给代理`。核心说明在 [README](file:///e:/workspace/GitRepository/agentmemory/README.md#L589-L669)。<mccoremem id="03g4h6s9il5foc5ofrrmec9e9" />
- 运行时入口在 [index.ts](file:///e:/workspace/GitRepository/agentmemory/src/index.ts#L129-L327)，这里把 provider、KV、索引、搜索、REST、MCP、viewer 全都装起来。<mccoremem id="03g4h6s9il5foc5ofrrmec9e9" />

**架构视角**
- `采集层`：通过 `SessionStart`、`UserPromptSubmit`、`PreToolUse`、`PostToolUse`、`Stop` 等 hooks 观察代理做了什么，对应说明见 [README](file:///e:/workspace/GitRepository/agentmemory/README.md#L627-L640)。
- `处理层`：采集到的 observation 会先做去重、隐私过滤，再压缩成结构化信息，例如 facts、concepts、narrative。[README](file:///e:/workspace/GitRepository/agentmemory/README.md#L593-L605)
- `记忆层`：数据进入四层记忆模型，分别是 `Working`、`Episodic`、`Semantic`、`Procedural`，用于区分原始记录、会话摘要、知识事实和流程经验。[README](file:///e:/workspace/GitRepository/agentmemory/README.md#L614-L626)
- `检索层`：查询时走 BM25、向量检索、知识图谱三路召回，再做 RRF 融合，避免只靠关键词命中。[README](file:///e:/workspace/GitRepository/agentmemory/README.md#L661-L689)
- `接口层`：同一套记忆通过 MCP、REST API、viewer 暴露给不同代理使用，不跟单一宿主绑定。[README](file:///e:/workspace/GitRepository/agentmemory/README.md#L692-L817)

**一次完整会话**
- 第一步，代理开始工作时，`SessionStart` hook 记录项目路径、会话 ID，并可加载项目画像与相关记忆。[README](file:///e:/workspace/GitRepository/agentmemory/README.md#L607-L612)
- 第二步，用户发 prompt、代理调工具、读文件、改代码时，hooks 持续把这些行为记成 observation。[README](file:///e:/workspace/GitRepository/agentmemory/README.md#L627-L640)
- 第三步，`PostToolUse` 后系统会做去重、脱敏、压缩、embedding、建立 BM25/向量索引。[README](file:///e:/workspace/GitRepository/agentmemory/README.md#L593-L600)
- 第四步，会话结束时，`Stop` 或 `SessionEnd` 会把这一轮工作总结成更高层的会话记忆，并可抽知识图谱、反思槽位等。[README](file:///e:/workspace/GitRepository/agentmemory/README.md#L602-L606)
- 第五步，下次你再问相近问题时，系统通过 `memory_smart_search` / `context` 等能力，把最相关的旧记忆找出来，再按 token budget 注入给代理。[tools-registry.ts](file:///e:/workspace/GitRepository/agentmemory/src/mcp/tools-registry.ts#L11-L209) 和 [index.ts](file:///e:/workspace/GitRepository/agentmemory/src/index.ts#L310-L324)

**代码里对应什么**
- `StateKV` 是状态存储入口，说明这个库把记忆当作长期状态，而不是临时 prompt。[index.ts](file:///e:/workspace/GitRepository/agentmemory/src/index.ts#L174-L183)
- `VectorIndex`、`HybridSearch` 负责语义检索和混合召回。[index.ts](file:///e:/workspace/GitRepository/agentmemory/src/index.ts#L179-L183) 和 [index.ts](file:///e:/workspace/GitRepository/agentmemory/src/index.ts#L310-L324)
- `registerObserveFunction`、`registerCompressFunction`、`registerContextFunction`、`registerSummarizeFunction`、`registerSmartSearchFunction` 这几个注册点基本就对应“记下来、整理好、找回来、喂回去”的主链路。[index.ts](file:///e:/workspace/GitRepository/agentmemory/src/index.ts#L190-L205) 和 [index.ts](file:///e:/workspace/GitRepository/agentmemory/src/index.ts#L322-L329)
- `registerApiTriggers` 和 `registerMcpEndpoints` 说明它把内部能力包装成对外服务，任何支持 MCP 或 HTTP 的代理都能接入。[index.ts](file:///e:/workspace/GitRepository/agentmemory/src/index.ts#L326-L329)

**一句更直白的话**
- 它不是“给代理放一份更长的说明文档”，而是做了一个后台记忆系统：自动记录代理干过什么，把历史经验整理成可检索知识，并在下一次任务开始时只拿最相关的部分回来。

- 如果你想，我可以下一步继续把这套流程画成一张更直观的 ASCII 数据流图。