# 架构文件
> AI,朕通知你一件事情
> 按组件工作内容，这个组件又调用了本程序的其他哪些，组件又被本仓库哪些地方的代码第哦啊用。
## arxiv_search

### 工作内容

把一组检索参数送到 arXiv 官方 Atom API（`GET https://export.arxiv.org/api/query`），
把响应标准化成论文实体列表（`FeedPage`）。

不负责：关键词生成、结果筛选、下载 PDF；不用网页爬虫 / 浏览器自动化。

### 组件调用了什么（组件之外的）

| 类别 | 名称 | 用途 |
| --- | --- | --- |
| 第三方包 | `effect` | Schema 校验、Effect 管道、错误类型、Schedule 退避 |
| 第三方包 | `@effect/platform` | `HttpClient` / `HttpClientRequest` / `HttpClientResponse` |
| 第三方包 | `fast-xml-parser` | 解析 Atom XML（只解析，不做校验） |
| 其它组件 | 无 | 本仓库目前只有 `arxiv_search` 一个组件，它谁也不调 |
| 运行环境 | `HttpClient` | 由调用方注入，组件自己不创建（入口用 `FetchHttpClient.layer`） |

### 组件被调用的函数及文件

| 调用方文件 | 调用的函数 | 调用形式 | 说明 |
| --- | --- | --- | --- |
| `src/index.ts` | `arxivSearch` | `arxivSearch(request)` | 用 `Effect.provide(FetchHttpClient.layer)` 注入依赖，再用 `Effect.runPromiseExit` 执行 |
| `src/arxiv_search/__tests__/client.test.ts` | `arxivSearch` | `arxivSearch(input, testConfig)` | 喂假 `HttpClient`（`HttpClient.make`），不联网 |

被调用的函数只有一个，签名：

```ts
arxivSearch(input: unknown, config?: Config): Effect<FeedPage, ArxivSearchError, HttpClient>
```

调用方必须遵守的约定：

- 提供环境里的 `HttpClient`；不提供则 Effect 跑不起来。
- 拿到的是 **Effect 描述**，不执行；执行是调用方的事（只有入口做）。
- 组件不做跨请求限速，连续调用要调用方自己串行并留间隔（arXiv 官方建议 1 req / 3s）。

### 附：组件内部构成（同一个组件的文件，不算跨组件调用）

`arxiv_search` 这一个组件由 6 个文件组成，下面全是**组件内部**的分工：

| 文件 | 职责 |
| --- | --- |
| `index.ts` | 出口：只导出 `arxivSearch` 一个函数值，其余 `export type` |
| `client.ts` | 装配：参数校验 -> 请求 -> 重试 -> 解析（唯一描述网络副作用的地方） |
| `params.ts` | 入参 Schema + 缺省值 + `search_query` 构造（纯函数） |
| `feed.ts` | Atom XML -> 实体（纯函数）：形状提取 + Schema 校验 |
| `paper.ts` | 数据模型：`Paper` / `Author` / `FeedPage` |
| `errors.ts` | 错误类型：5 个 `Schema.TaggedError` + `ArxivSearchError` |

内部依赖方向（都在组件内）：

- `client.ts` -> `params.ts` / `feed.ts` / `errors.ts` / `paper.ts`（最后一个是仅类型）
- `feed.ts` -> `errors.ts` / `paper.ts`
- `params.ts` / `paper.ts` / `errors.ts` -> 只依赖 `effect`，不依赖组件内任何文件
- `index.ts` -> 只从 `client.ts` 转手导出函数，从另外三个文件取类型再导出
