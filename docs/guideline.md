结论

- 这是一个给 AI 编码代理补上“跨会话长期记忆”能力的库。它要解决的核心问题是：代理每次新会话都会“失忆”，用户不得不反复解释项目架构、历史决策、偏好和已踩过的坑。这个定位在 README 和 Why agentmemory 里写得很直接。
它解决什么问题

- 解决“会话结束即丢上下文”：普通 CLAUDE.md /规则文件是静态便签，容量有限、容易过时，而编码代理真正需要的是可持续积累、可检索、可演化的记忆。 README
- 解决“重复解释成本高”：第二次让代理做相关任务时，不该再从零讲认证方案、关键文件、测试覆盖、技术选型这些背景。 README
- 解决“多代理不共享上下文”：Claude Code、Cursor、Gemini CLI、Codex 等如果各自维护一份记忆，会割裂；这个库想把它们都挂到同一个记忆后端上。 README
- 解决“上下文窗口贵且有限”：不是把所有历史全塞回 prompt，而是只取当前任务相关的 top-K 记忆，减少 token 消耗。 README
它如何解决

- 自动采集：通过一组 hook 在 SessionStart 、 UserPromptSubmit 、 PreToolUse 、 PostToolUse 、 Stop 等时机捕获代理行为，而不是靠用户手工记笔记。 README ；对应的 hook 脚本目录也能看到完整生命周期覆盖： src/hooks/ 。 api.ts 之外，项目结构里有 session-start.ts 、 post-tool-use.ts 、 stop.ts 等文件。
- 记忆压缩与结构化：原始 observation 不直接原样堆积，而是先去重、隐私过滤，再压缩成结构化事实、概念和叙述，形成更适合检索的记忆。 README
- 多层记忆模型：它把记忆分成 Working / Episodic / Semantic / Procedural 四层，分别保存原始观察、会话摘要、知识事实和工作流程，并带有衰减、强化、淘汰、冲突处理机制。 README
- 混合检索：不是只做关键词搜索，而是把 BM25、向量检索和知识图谱三路结果融合，再按 token budget 裁剪，把最相关上下文返回给代理。 README
- 多入口提供能力：同一套记忆能力通过 MCP、REST API、viewer 暴露给不同宿主代理使用。 README 和 API
从代码看它的实现骨架

- src/index.ts 会注册大量 mem::* 函数，包括观察、压缩、搜索、上下文生成、总结、关系图、团队共享等，再把 REST 触发器和 MCP 端点一起挂上。 index.ts
- 同一个启动入口里会构建 HybridSearch ，把 BM25、向量索引、embedding provider 和图权重合并起来，然后注册成 memory_smart_search 背后的搜索函数。 index.ts
- 对外接口层面，REST 触发器在 registerApiTriggers() 里统一注册；这说明它不是某个编辑器私有插件，而是一个独立的记忆服务。 api.ts
- MCP 工具注册表里能看到核心能力的形状，比如 memory_recall 、 memory_save 、 memory_file_history 、 memory_smart_search 、 memory_profile 等，这正是“记住、查回、复用”的最小闭环。 tools-registry.ts
一句话概括

- 它本质上是在代理和项目之间加了一个“可持续积累、可检索、跨工具共享”的长期记忆层：自动记录过去发生了什么，整理成知识，再在下次任务开始时把相关记忆喂回去。
- 如果你愿意，我下一步可以继续按“架构视角”给你画一张这个库的数据流图，或者按“实际使用视角”说明一次完整会话是怎么被记住再被召回的。