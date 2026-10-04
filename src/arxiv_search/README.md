# arxiv_search

**功能：把一组检索参数送到 arXiv 官方 API，把响应标准化成论文实体列表。**
先创建一个检索会话，再通过会话的 `search(input)` 查询，得到 `FeedPage`（论文实体数组 + 翻页元信息）。
同一个会话负责串行请求、请求间隔、重试和成功结果缓存；失败时输出带标签的错误。
不生成关键词、不做筛选、不下载全文；不复用网页爬虫或浏览器自动化。

## 对外 API

**一个组件只暴露一个函数。**

```ts
arxivSearch(config?: Config): Effect<Search, InvalidParamsError, HttpClient>

type Search = (input: unknown) => Effect<FeedPage, ArxivSearchError>
```

| 项 | 说明 |
| --- | --- |
| `arxivSearch(config?)` | 返回创建会话的惰性 Effect；执行时校验配置、捕获 `HttpClient` 并创建会话状态 |
| `search(input)` | `input` 是 `unknown`，在边界校验；返回查询的惰性 Effect，不再要求提供 `HttpClient` 环境 |
| `config` | 所有字段均可选，嵌套字段可局部覆盖；缺省值定义在组件内部的 `config.ts` |
| 执行 | 两层返回值都是 Effect 描述，不是 Promise；入口负责执行 |
| HTTP 依赖 | 工厂需要 `HttpClient`，入口使用 `FetchHttpClient.layer` 注入 |

- `index.ts` 只导出 `arxivSearch` 这一个函数值；`Search`、`FeedPage`、`Paper`、`Config` 和错误类型均为 `export type`，编译后擦除。
- 组件内部文件之间的 export 只是模块间协作与单测取用，
  **不是组件出口**，外部不要绕过 `index.ts` 去 import。
- **整个应用只执行一次工厂，再把同一个 `search` 交给所有检索任务。** 每次执行工厂 Effect 都会创建独立会话，逐请求创建会话会失去共享限速和缓存。

```ts
// 入口示例（src/index.ts）。
import { Cause, Effect, Exit } from "effect"
import { FetchHttpClient } from "@effect/platform"
import { arxivSearch } from "./arxiv_search/index.js"

const program = Effect.gen(function* () {
  const search = yield* arxivSearch({ retry: { times: 2 } })
  // 后续 Agent 任务复用这个 search，会话负责调度所有查询。
  return yield* search({ keywords: ["diffusion policy"], maxResults: 5 })
}).pipe(
  Effect.provide(FetchHttpClient.layer),
)

const exit = await Effect.runPromiseExit(program)
if (Exit.isFailure(exit)) console.error(Cause.pretty(exit.cause))
```

工厂捕获的是调用方提供的 HTTP 客户端；如果自定义客户端持有需要释放的资源，其生命周期必须覆盖所有 `search` 调用。上例将工厂与查询放在同一个依赖提供范围内。

## 会话配置

时长接受 Effect 的 `DurationInput`，例如毫秒数 `30_000` 或 `"30 seconds"`。以下是 `defaultConfig` 的默认行为；该常量不是组件的公共导出。

| 字段 | 默认值 | 约束 / 用途 |
| --- | --- | --- |
| `baseUrl` | `https://export.arxiv.org/api/query` | 无内嵌用户名或密码的 HTTP(S) URL |
| `userAgent` | `agent-component/0.0.0 (+arxiv_search)` | 非空且符合 HTTP 请求头格式 |
| `timeout` | `30_000`（30 秒） | 正且有限，最多 `2^31 - 1` 毫秒；每次网络尝试单独计时 |
| `retry.times` | `3` | 非负安全整数；初次请求之外的最大重试次数，`0` 表示不重试 |
| `retry.base` | `3_000`（3 秒） | 正且有限，不超过 60 秒；本地指数退避的起点 |
| `retry.factor` | `2` | 有限且不小于 `1`；指数退避倍率 |
| `cache.timeToLive` | `86_400_000`（24 小时） | 正且有限；从成功取得并解析结果时起算，命中不延长 TTL |
| `cache.capacity` | `128` | 非负安全整数；最多缓存多少页，`0` 禁用缓存 |

例如 `arxivSearch({ retry: { times: 0 }, cache: { capacity: 32 } })` 只覆盖这两个值，仍保留默认的退避参数和 24 小时 TTL。配置不合法时，工厂返回 `InvalidParamsError`，不会创建网络请求。

## 输入字段

`input` 的字段（Schema 定义在 `params.ts` 的 `SearchParams`）。**除 `keywords` 外全部可缺省。**

| 字段 | 类型 | 必填 | 缺省 | 说明 |
| --- | --- | --- | --- | --- |
| `keywords` | `string[]` | 是 | — | 检索词。每个词变成一个短语检索项 `all:"词"`，词之间是 **OR** |
| `categories` | `string[]` | 否 | `[]` | arXiv 分类，如 `cs.RO`、`cs.LG`。多个之间是 **OR** |
| `submittedFrom` | `string`，`YYYY-MM-DD` | 否 | 无下界 | 投稿时间下界，含当天 00:00 |
| `submittedTo` | `string`，`YYYY-MM-DD` | 否 | 无上界 | 投稿时间上界，含当天 23:59 |
| `sortBy` | `"relevance"` / `"lastUpdatedDate"` / `"submittedDate"` | 否 | `relevance` | 排序字段 |
| `sortOrder` | `"ascending"` / `"descending"` | 否 | `descending` | 排序方向 |
| `maxResults` | `int`，`1..2000` | 否 | `20` | 本次最多取回条数；组件按官方分页说明限制单页大小 |
| `start` | `int`，`>= 0` | 否 | `0` | 翻页起点；补全默认值后必须满足 `start + maxResults <= 30000` |

分页窗口包括本页。例如 `start: 28000, maxResults: 2000` 合法，`start: 29999, maxResults: 2` 被拒绝；省略 `maxResults` 时仍按默认 `20` 校验，因此 `start: 29981` 也被拒绝。

### 会被拒绝的输入

校验失败一律报 `InvalidParamsError`，**并且一条请求都不会发出**。

| 情况 | 例子 |
| --- | --- |
| `keywords` 缺失 / 空数组 / 元素只有空白 | `{}`、`{keywords: []}`、`{keywords: ["  "]}` |
| 数值越界或非整数 | `maxResults: 0`、`maxResults: 2001`、`start: -1` |
| 当前页超过 30000 条结果窗口 | `{start: 29999, maxResults: 2}`、`{start: 29981}` |
| 日期格式不对 | `submittedFrom: "2024-1-1"`（必须补零）、`"2024-01-01T10:00:00Z"`（不接受带时间） |
| 日期不存在 | `"2024-13-45"`、`"2024-02-30"`、`"2023-02-29"` |
| 枚举值不认识 | `sortBy: "nope"` |
| **多出未知字段** | `{keyword: "a"}`（把 `keywords` 写错）→ 拒绝，不静默忽略 |
| `input` 不是对象 | `null`、`"keywords=a"` |

> 日期为什么是字符串而不是 `Date`：`Schema.DateFromString` 实测**不校验**内容
> （`"2024-13-45"` 会解出 Invalid Date），而 `"2024-1-1"` 还会按本机时区解释。
> 这里改成严格的 `YYYY-MM-DD` 字符串，时区无关，拼 `submittedDate` 区间时只去横杠。

### 输入怎么变成 arXiv 查询式

```ts
{
  keywords: ["diffusion policy", "robot manipulation"],
  categories: ["cs.RO"],
  submittedFrom: "2024-01-01",
  submittedTo: "2024-03-31",
  maxResults: 5,
  sortBy: "submittedDate",
}
```

展开成 API 请求：

| 查询参数 | 值 |
| --- | --- |
| `search_query` | `(all:"diffusion policy" OR all:"robot manipulation") AND (cat:cs.RO) AND submittedDate:[202401010000 TO 202403312359]` |
| `start` | `0` |
| `max_results` | `5` |
| `sortBy` | `submittedDate` |
| `sortOrder` | `descending` |

规律：

- 关键词之间 OR，整体加括号（防 OR 与 AND 抢优先级）；词里的双引号会被剔除。
- 分类之间 OR，整体加括号；多个条件之间 AND。
- 时间区间的上界取当天 `2359`、下界取当天 `0000`；
  只给单边时另一边补极值（下界 `000101010000`、上界 `999912312359`），arXiv 不接受开区间。

## 输出字段

输出是 `FeedPage`（Schema 定义在 `paper.ts`）。

### `FeedPage`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `totalResults` | `number` | arXiv 命中的总数，可远大于本次取回条数。读不到时是 `0` |
| `startIndex` | `number` | 本次结果的起点（arXiv 的 `opensearch:startIndex`） |
| `itemsPerPage` | `number` | 本次返回条数（arXiv 的 `opensearch:itemsPerPage`） |
| `papers` | `Paper[]` | 论文实体列表。**零结果是空数组，不是错误** |

### `Paper`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `arxivId` | `string` | 不带版本号、不带 URL 的 arXiv ID，如 `2409.00001` |
| `version` | `string \| undefined` | 版本号，如 `"2"`；取不到时是 undefined |
| `title` | `string` | 标题。换行与连续空白压成单空格 |
| `abstract` | `string` | 摘要。同上 |
| `authors` | `Author[]` | 按 arXiv 返回顺序 |
| `primaryCategory` | `string \| undefined` | 主分类，如 `cs.RO`（来自 `arxiv:primary_category`） |
| `categories` | `string[]` | 全部分类，可空数组 |
| `published` | `string` | 首次提交时间，**保留 arXiv 原样的 ISO 串**，如 `2024-09-01T10:00:00Z` |
| `updated` | `string` | 最后更新时间，同上 |
| `comment` | `string \| undefined` | `arxiv:comment`，作者备注（常写会议接收情况） |
| `journalRef` | `string \| undefined` | `arxiv:journal_ref`，期刊引用信息 |
| `doi` | `string \| undefined` | `arxiv:doi` |
| `absUrl` | `string` | abs 详情页链接；取 `link rel="alternate"`，退化时用 `<id>` |
| `pdfUrl` | `string \| undefined` | PDF 链接，取 `link type="application/pdf"` |

时间字段为什么是字符串：组件不解释时区，原样透传 arXiv 的 ISO 串，解释权留给下游。

### `Author`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `name` | `string` | 姓名 |
| `affiliation` | `string \| undefined` | 单位，arXiv 多数论文不提供该字段 |

### 输出样例

```jsonc
{
  "totalResults": 1187,
  "startIndex": 0,
  "itemsPerPage": 2,
  "papers": [
    {
      "arxivId": "2409.00001",
      "version": "2",
      "title": "Diffusion Policy for Robot Manipulation",
      "abstract": "We propose a method. It runs on CPU only.",
      "authors": [
        { "name": "Alice Zhang", "affiliation": "Tsinghua University" },
        { "name": "Bob Li" }
      ],
      "primaryCategory": "cs.RO",
      "categories": ["cs.RO", "cs.LG"],
      "published": "2024-09-01T10:00:00Z",
      "updated": "2024-09-03T01:02:03Z",
      "comment": "Accepted at CoRL 2024",
      "journalRef": "NeurIPS 2024",
      "doi": "10.1000/xyz",
      "absUrl": "http://arxiv.org/abs/2409.00001v2",
      "pdfUrl": "http://arxiv.org/pdf/2409.00001v2"
    }
  ]
}
```

> 可选字段取不到时是 `undefined`（上面的 `Bob Li` 没有 `affiliation`）；
> JSON 序列化后该键会消失。

## 错误输出

失败时错误是带 `_tag` 的对象，用 `Effect.catchTag` 或 `Cause.pretty` 处理。

| 错误 | `_tag` | 触发条件 | 会重试 |
| --- | --- | --- | --- |
| 参数不合法 | `InvalidParamsError` | 查询参数或会话配置不合法 | 否 |
| 传输失败 | `TransportError` | DNS / 断连 / 超时 / 读取响应体失败 | 是 |
| 状态码非 2xx | `HttpStatusError` | 带 `status`；`429` 与 `5xx` 重试，`3xx` 等其它状态不重试 | 部分 |
| 响应不是 XML | `FeedParseError` | 无法解析，或没有 `<feed>` 根节点 | 否 |
| 结构对不上 | `FeedDecodeError` | XML 合法但字段不符合约定（接口改版 / 脏数据） | 否 |

## 请求调度、重试与取消

- **同一会话最多一个活动 HTTP 请求。** 缓存未命中的查询先取得串行许可；该许可覆盖所有网络尝试和重试。
- 每次尝试都有独立 HTTP scope。成功时读完响应体再关闭，失败、超时或取消时也会关闭；**完整 scope 关闭后至少再等 3 秒**，下一次网络请求才能开始。首次调用、重试和后续不同查询走同一个调度入口。
- 默认本地重试以 3 秒为起点、倍率 2，仅向上加入 `1..1.2` 倍 jitter，最终本地退避最多 60 秒。配置退避小于 3 秒也不能绕过会话的请求间隔。
- `429` / `503` 响应中的 `Retry-After` 支持整数秒和 HTTP-date。它会延长整个会话的冷却截止时间，即使该次查询不再重试，后续其它查询也会等待。服务器要求的冷却可超过本地退避的 60 秒上限；较长冷却分段等待，保持可取消。
- 网络超时默认 30 秒，涵盖发出请求和读取响应体；排队、冷却和退避等待不计入网络超时。取消等待中的查询会释放或退出许可队列；取消活动请求会关闭 HTTP scope 并保留后续 3 秒间隔。
- 默认 Fetch 客户端关闭自动重定向，将 `3xx` 交给状态码错误处理，避免隐式请求绕过调度。**自定义 `HttpClient` 必须保证每次 `execute` 只发一次请求，且没有内部重试或自动重定向。**

## 成功结果缓存与会话边界

缓存键是补全默认值后实际发送的 API 参数，包括查询式、起点、页大小和排序。因此省略默认参数与显式提供同样默认参数可以共用缓存，不同分页分别缓存。这里只按实际 API 参数判定相同请求，不做查询式的语义等价化。

查询先在锁外查缓存，命中直接返回结果副本，不受其它网络请求或冷却阻塞。未命中则排队，在锁内再次查缓存；前一个相同请求成功后，排队中的相同请求就会复用该结果。成功页默认保留 24 小时、最多 128 页，容量满时按 LRU 淘汰最久未访问的页；失败不缓存。返回值会复制，调用方修改结果不会污染缓存。

缓存只在内存中保存。TTL 到期、容量驱逐、关闭缓存或进程重启后，相同查询会再次请求。**不同会话、进程和机器不共享锁、冷却或缓存**；多个 Agent 应把请求交给同一个持有会话的检索服务统一调度，需要跨重启复用结果时由服务持久化保存。

## 官方依据

- [API 使用条款：Rate limits](https://info.arxiv.org/help/api/tou.html#rate-limits)：请求间隔和单连接要求。组件在完整 HTTP scope 关闭后再等待至少 3 秒。
- [API 手册：start 和 max_results 分页](https://info.arxiv.org/help/api/user-manual.html#3112-start-and-max_results-paging)：组件据此采用每页最多 2000 条、`start + maxResults <= 30000` 的检索窗口。
- [API 手册：查询结果与更新时间](https://info.arxiv.org/help/api/user-manual.html#3311-title-id-link-and-updated)：相同查询结果的更新时间及缓存建议。组件提供默认 24 小时的有界内存缓存；它不提供持久化存储。

## 目录

```
src/arxiv_search/
├── index.ts       # 对外出口（只导出 arxivSearch）
├── client.ts      # 会话工厂、依赖捕获、请求 -> 重试 -> 解析 -> 缓存
├── config.ts      # 会话配置、嵌套默认值合并与校验
├── session.ts     # 会话内串行许可、冷却截止时间与 LRU 成功缓存
├── params.ts      # 入参 Schema + 缺省值 + search_query 构造（纯）
├── feed.ts        # Atom XML -> 实体（纯）：形状提取 + Schema 校验
├── paper.ts       # 数据模型：Paper / Author / FeedPage
├── errors.ts      # 错误类型（Schema.TaggedError）
└── __tests__/     # Vitest：参数、解析、出口、配置、HTTP 与会话策略测试
```

## 运行

```
npm test           # 全量离线单测
npm run typecheck
npm run dev        # 入口跑一次真实检索
```

`client.test.ts` 注入假 `HttpClient`，验证参数、请求和输出的完整装配。`policy.test.ts` 使用虚拟时钟验证并发、间隔、Retry-After、超时、取消、缓存和资源释放；测试无需实际等待 3 秒或访问 arXiv。其他边界测试同样注入假的客户端或 Fetch 实现，不产生外部请求。
