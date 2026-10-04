# 架构文件
> AI,朕通知你一件事情
> 按组件工作内容，这个组件又调用了本程序的其他哪些，组件又被本仓库哪些地方的代码第哦啊用。
## arxiv_search

### 工作内容

把一组检索参数送到 arXiv 官方 Atom API（`GET https://export.arxiv.org/api/query`），
把响应标准化成论文实体列表（`FeedPage`）。

不负责：关键词生成、结果筛选、下载 PDF；不用网页爬虫 / 浏览器自动化。
入口先创建一个检索会话，后续查询共享该会话的 HTTP 客户端、串行调度、冷却时间和成功结果缓存。

### 组件调用了什么（组件之外的）

| 类别 | 名称 | 用途 |
| --- | --- | --- |
| 第三方包 | `effect` | Schema 校验、Effect 管道、Ref 会话状态、Semaphore 串行许可、Clock、Scope 和 Schedule 退避 |
| 第三方包 | `@effect/platform` | `HttpClient` / `HttpClientRequest` / `HttpClientResponse`；使用 `withScope` 释放每次请求 |
| 第三方包 | `fast-xml-parser` | 解析 Atom XML（只解析，不做校验） |
| 其它组件 | 无 | 本仓库目前只有 `arxiv_search` 一个组件，它谁也不调 |
| 运行环境 | `HttpClient` | 由调用方在创建会话时注入并被工厂捕获；入口用 `FetchHttpClient.layer` |

### 组件被调用的函数及文件

| 调用方文件 | 调用的函数 | 调用形式 | 说明 |
| --- | --- | --- | --- |
| `src/index.ts` | `arxivSearch` | `const search = yield* arxivSearch()`，随后 `yield* search(request)` | 在同一程序内注入 `FetchHttpClient.layer`，只创建一次会话，再由 `Effect.runPromiseExit` 执行程序 |
| `src/arxiv_search/__tests__/client.test.ts` | `arxivSearch` | 创建配置过的会话，再调用 `search(input)` | 注入假 `HttpClient`，验证正常与失败链路，不联网 |
| `src/arxiv_search/__tests__/policy.test.ts` | `arxivSearch` | 并发或连续复用同一个 `search` | 假客户端配合虚拟时钟，验证调度、缓存、重试、超时、取消和资源释放 |
| 其他 `src/arxiv_search/__tests__/*.test.ts` | 公共出口或组件内部函数 | 配置、参数、解析及 Fetch 边界检查 | 全量测试通过 `npm test` 执行，不发外部请求 |

组件唯一的函数导出及其返回函数的签名：

```ts
arxivSearch(config?: Config): Effect<Search, InvalidParamsError, HttpClient>

type Search = (input: unknown) => Effect<FeedPage, ArxivSearchError>
```

调用方必须遵守的约定：

- 工厂需要 `HttpClient`，执行后得到的 `search(input)` 不再要求 HTTP 环境。两者返回的都是惰性 Effect，入口负责执行。
- **工厂只执行一次，将得到的 `search` 交给所有检索任务。** 每次执行工厂都会创建独立状态，重复创建会话不能共享限速和缓存。
- `Config` 的所有字段均可选，嵌套字段也可局部覆盖；默认值和合法性检查由 `config.ts` 统一处理。工厂配置不合法时返回 `InvalidParamsError`。
- 自定义 `HttpClient` 每次 `execute` 必须只发一次请求，不得内置重试或自动重定向；底层资源的生命周期须覆盖所有查询。默认 Fetch 路径关闭自动重定向。
- 不同会话、进程、机器不共享状态；多个 Agent 或实例应通过单个持有会话的检索服务统一调度。

### 会话内部的请求与缓存策略

1. 校验查询参数并补全默认值。单页 `maxResults` 为 `1..2000`，默认 `20`；`start` 默认 `0`，必须满足 `start + maxResults <= 30000`。使用实际 API 参数构造缓存键。
2. 先在锁外查成功缓存，命中返回副本；未命中时取得会话唯一的串行许可，再查一次缓存，复用排队期间取得的相同结果。
3. 等待共享冷却截止时间后发出 HTTP 请求。每次尝试使用独立 scope，读取响应体或发生失败、超时、取消后都会关闭 scope；完整 scope 关闭后至少再等 3 秒，下一次尝试才能发出。锁覆盖该查询的全部重试。
4. 传输失败、`429` 和 `5xx` 可以重试；默认最多重试 3 次，指数退避从 3 秒起、倍率 2，仅向上加入 `1..1.2` 倍 jitter，本地退避封顶 60 秒。重试仍通过同一调度入口。
5. `429` / `503` 的 `Retry-After` 支持整数秒和 HTTP-date，会延长整个会话的冷却时间；即使当前查询不再重试，后续其他查询也遵守该截止时间。服务器要求可超过本地退避上限，长等待会分段且可以取消。
6. 网络尝试默认单独 30 秒超时，包含发送与读取响应体；排队、冷却和退避不占网络超时。取消活动请求会释放 scope 和许可，取消排队请求不会阻塞后续任务。
7. 成功解析后缓存结果；失败不缓存。默认 TTL 为 24 小时、容量 128 页，命中更新 LRU 顺序但不延长 TTL；`capacity: 0` 关闭缓存。缓存命中无需排队或发请求，返回副本以隔离调用方修改。

缓存只在内存中，过期、驱逐或重启后会重新请求，需要跨重启复用时由检索服务持久化保存。组件没有模块级可变调度状态，所有锁、冷却和缓存都属于执行工厂时创建的会话。

官方依据：[API 使用条款的限速要求](https://info.arxiv.org/help/api/tou.html#rate-limits)、[API 手册的分页说明](https://info.arxiv.org/help/api/user-manual.html#3112-start-and-max_results-paging)、[查询结果更新时间与缓存说明](https://info.arxiv.org/help/api/user-manual.html#3311-title-id-link-and-updated)。完整参数、返回字段和配置见 `src/arxiv_search/README.md`。

### 附：组件内部构成（同一个组件的文件，不算跨组件调用）

下面全是**组件内部**的分工：

| 文件 | 职责 |
| --- | --- |
| `index.ts` | 出口：只导出 `arxivSearch` 一个函数值，其余 `export type` |
| `client.ts` | 工厂：捕获 HTTP 依赖、创建会话，装配参数校验 -> 缓存 -> 请求 -> 重试 -> 解析 |
| `config.ts` | 配置模型、嵌套默认值合并、URL / 请求头 / 数值与时长校验 |
| `session.ts` | 每个会话独有的串行许可、共享冷却和有界 LRU 成功缓存，解析 `Retry-After` |
| `params.ts` | 入参 Schema + 缺省值 + `search_query` 构造（纯函数） |
| `feed.ts` | Atom XML -> 实体（纯函数）：形状提取 + Schema 校验 |
| `paper.ts` | 数据模型：`Paper` / `Author` / `FeedPage` |
| `errors.ts` | 错误类型：5 个 `Schema.TaggedError` + `ArxivSearchError` |

内部依赖方向（都在组件内）：

- `client.ts` -> `config.ts` / `session.ts` / `params.ts` / `feed.ts` / `errors.ts` / `paper.ts`（最后一个是仅类型）
- `config.ts` -> `errors.ts`
- `session.ts` -> `config.ts` / `paper.ts`（均为仅类型依赖）
- `feed.ts` -> `errors.ts` / `paper.ts`
- `params.ts` / `paper.ts` / `errors.ts` -> 只依赖 `effect`，不依赖组件内任何文件
- `index.ts` -> 只从 `client.ts` 转手导出 `arxivSearch`；从 `client.ts` / `paper.ts` / `params.ts` / `errors.ts` 取类型再导出
