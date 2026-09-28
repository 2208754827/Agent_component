# arxiv_search

**功能：把一组检索参数送到 arXiv 官方 API，把响应标准化成论文实体列表。**
输入是检索参数，输出是 `FeedPage`（论文实体数组 + 翻页元信息），失败时输出带标签的错误。
不生成关键词、不做筛选、不下载全文；不复用网页爬虫或浏览器自动化。

## 对外 API

**一个组件只暴露一个函数。**

```ts
arxivSearch(input: unknown, config?: Config): Effect<FeedPage, ArxivSearchError, HttpClient>
```

| 项 | 说明 |
| --- | --- |
| 参数 1 `input` | `unknown`。参数可能来自自然语言 / LLM，所以收 unknown，在边界上校验 |
| 参数 2 `config` | 可选。不传用 `defaultConfig`（改超时 / 重试 / baseUrl 时才传） |
| 返回 | Effect **描述**（惰性），不是 Promise；执行只发生在入口 |
| 依赖 | `HttpClient`，入口用 `FetchHttpClient.layer` 提供 |
| 副作用 | 只有一次 HTTP GET（另有超时、退避 sleep） |

- `index.ts` 只导出这一个函数值；其余导出都是 `export type`（`FeedPage` / `Paper` / `Config` / 错误类型），编译后擦除。
  实测运行时导出：`Object.keys(组件) === ["arxivSearch"]`。
- 组件内部文件（`client` / `feed` / `params` / `paper` / `errors`）之间的 export 只是模块间协作与单测取用，
  **不是组件出口**，外部不要绕过 `index.ts` 去 import。

```ts
const program = pipe(
  arxivSearch(request),
  Effect.provide(FetchHttpClient.layer),
)

const exit = await Effect.runPromiseExit(program)
if (Exit.isFailure(exit)) console.error(Cause.pretty(exit.cause))
```

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
| `maxResults` | `int`，`1..2000` | 否 | `20` | 本次取回条数（arXiv 官方上限 2000） |
| `start` | `int`，`>= 0` | 否 | `0` | 翻页起点，对应 arXiv 的 `start` |

### 会被拒绝的输入

校验失败一律报 `InvalidParamsError`，**并且一条请求都不会发出**。

| 情况 | 例子 |
| --- | --- |
| `keywords` 缺失 / 空数组 / 元素只有空白 | `{}`、`{keywords: []}`、`{keywords: ["  "]}` |
| 数值越界或非整数 | `maxResults: 0`、`maxResults: 2001`、`start: -1` |
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
| 参数不合法 | `InvalidParamsError` | 上面「会被拒绝的输入」任意一条 | 否 |
| 传输失败 | `TransportError` | DNS / 断连 / 超时 / URL 非法 | 是 |
| 状态码非 2xx | `HttpStatusError` | 带 `status`；`429` 与 `5xx` 重试，其它不重试 | 部分 |
| 响应不是 XML | `FeedParseError` | 无法解析，或没有 `<feed>` 根节点 | 否 |
| 结构对不上 | `FeedDecodeError` | XML 合法但字段不符合约定（接口改版 / 脏数据） | 否 |

重试策略：指数退避，起点 3s（arXiv 官方建议的请求间隔）、倍率 2、带 jitter、最多 3 次。
每次请求单独 30s 超时。**不做跨请求限速**：连续调用要调用方自己串行并留间隔。

## 目录

```
src/arxiv_search/
├── index.ts       # 对外出口（只导出 arxivSearch）
├── client.ts      # arxivSearch：装配参数 -> 请求 -> 重试 -> 解析
├── params.ts      # 入参 Schema + 缺省值 + search_query 构造（纯）
├── feed.ts        # Atom XML -> 实体（纯）：形状提取 + Schema 校验
├── paper.ts       # 数据模型：Paper / Author / FeedPage
├── errors.ts      # 错误类型（Schema.TaggedError）
└── __tests__/     # Vitest：夹具 + 4 个用例文件
```

## 运行

```
npm run test       # 44 项单测，全部离线（假 HttpClient）
npm run typecheck
npm run dev        # 入口跑一次真实检索
```

单测怎么做到离线：`client.test.ts` 用 `HttpClient.make` 造一个假 client 直接吐夹具响应，
所以「参数 -> 请求 -> 输出」整条装配都能验证，只有真发网络这一步被替换。
