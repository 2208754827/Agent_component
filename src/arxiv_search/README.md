# arxiv_search

arXiv 官方开放 Atom API 的检索封装。输入检索参数，输出标准化论文实体列表。
**不使用网页爬虫 / 浏览器自动化。**

## 对外 API

只用 `index.ts` 出口，外部不要 import 组件内部文件。

```ts
arxivSearch(input: unknown, config?: Config): Effect<FeedPage, ArxivSearchError, HttpClient>
```

- `input` 收 `unknown`：参数由自然语言 / LLM 生成，必须在边界上校验，校验失败报 `InvalidParamsError`。
- 返回的是 Effect **描述**（惰性、无副作用），执行只发生在入口。
- 需要 `HttpClient`：入口用 `FetchHttpClient.layer` 提供。

```ts
const program = pipe(
  arxivSearch(request),
  Effect.provide(FetchHttpClient.layer),
)

const exit = await Effect.runPromiseExit(program)
if (Exit.isFailure(exit)) console.error(Cause.pretty(exit.cause))
```

## 输入

`SearchParams`（`params.ts`）—— 除 `keywords` 外全部可缺省：

| 字段 | 类型 | 缺省 | 说明 |
| --- | --- | --- | --- |
| `keywords` | `NonEmptyArray<string>` | 必填 | 短语检索，多个之间 OR |
| `categories` | `string[]` | `[]` | 如 `cs.RO`，多个之间 OR |
| `submittedFrom` | `Date`（ISO 字符串入） | 无下界 | 含当天 00:00，UTC |
| `submittedTo` | `Date`（ISO 字符串入） | 无上界 | 含当天 23:59，UTC |
| `sortBy` | `relevance` / `lastUpdatedDate` / `submittedDate` | `relevance` | |
| `sortOrder` | `ascending` / `descending` | `descending` | |
| `maxResults` | `1..2000` | `20` | |
| `start` | `>= 0` | `0` | 翻页起点 |

## 输出

`FeedPage`（`paper.ts`）：`totalResults` / `startIndex` / `itemsPerPage` / `papers[]`。

`Paper` 字段：`arxivId`（不带版本号）、`version`、`title`、`abstract`、`authors[]`
（`name` + `affiliation`）、`primaryCategory`、`categories[]`、`published`、`updated`、
`comment`、`journalRef`、`doi`、`absUrl`、`pdfUrl`。
时间保留 arXiv 返回的 ISO 字符串，不转 `Date`，避免时区被反复解释。

## 错误

| 错误 | 触发条件 | 会重试 |
| --- | --- | --- |
| `InvalidParamsError` | 参数 Schema 校验失败 | 否 |
| `TransportError` | DNS / 断连 / 超时 / URL 非法 | 是 |
| `HttpStatusError` | 非 2xx，`429` 与 `5xx` | 是 |
| `FeedParseError` | 响应不是合法 XML，或没有 `<feed>` 根节点 | 否 |
| `FeedDecodeError` | XML 合法但字段结构不符合约定 | 否 |

重试策略：指数退避，起点 3s（arXiv 官方建议的请求间隔）、倍率 2、带 jitter、最多 3 次。
每次请求单独 30s 超时。

## 目录

```
src/arxiv_search/
├── index.ts    # 对外出口
├── client.ts   # arxivSearch：拼请求 + 重试 + 超时（唯一描述网络副作用的地方）
├── params.ts   # 入参 Schema + 缺省值 + search_query 构造（纯）
├── feed.ts     # Atom XML -> 实体（纯）：形状提取 + Schema 校验
├── paper.ts    # 数据模型：Paper / Author / FeedPage
└── errors.ts   # 错误类型（Schema.TaggedError）
```

## 运行

```
npm run dev          # 入口跑一次真实检索
npm run typecheck
```

## 待办

- [ ] 跨请求限速：本组件不做全局限速，连续调用需调用方串行并留间隔（「爬虫池」阶段负责）。
- [ ] 单元测试：补 `feed.ts` / `params.ts` 的样例 XML fixture。
- [ ] `id_list` 直查模式（按 arXiv ID 批量取元数据，作者画像阶段会用）。
