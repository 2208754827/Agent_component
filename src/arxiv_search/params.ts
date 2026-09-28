/**
 * 检索参数：入参 Schema、缺省值、arXiv 查询式构造。
 * 全部是纯函数，不碰网络。
 */
import { Schema } from "effect"

/** arXiv 支持的排序字段。 */
export const SortBy = Schema.Literal(
  "relevance",
  "lastUpdatedDate",
  "submittedDate",
)

/** 排序方向。 */
export const SortOrder = Schema.Literal("ascending", "descending")

/** arXiv 单次请求的结果数上限。 */
export const MAX_RESULTS_LIMIT = 2000

/** Agent / 用户传入的检索参数。除 keywords 外都可缺省。 */
export const SearchParams = Schema.Struct({
  keywords: Schema.NonEmptyArray(Schema.NonEmptyTrimmedString),
  /** arXiv 分类，如 `cs.RO`、`cs.LG`；多个之间是 OR。 */
  categories: Schema.optional(Schema.Array(Schema.NonEmptyTrimmedString)),
  /** 投稿时间下界（含当天 00:00）。 */
  submittedFrom: Schema.optional(Schema.DateFromString),
  /** 投稿时间上界（含当天 23:59）。 */
  submittedTo: Schema.optional(Schema.DateFromString),
  sortBy: Schema.optional(SortBy),
  sortOrder: Schema.optional(SortOrder),
  maxResults: Schema.optional(
    Schema.Int.pipe(Schema.between(1, MAX_RESULTS_LIMIT)),
  ),
  /** 翻页起点，从 0 开始。 */
  start: Schema.optional(Schema.Int.pipe(Schema.nonNegative())),
})
export type SearchParams = Schema.Schema.Type<typeof SearchParams>

/** 补全缺省值之后的参数，管道下游只看这个类型。 */
export interface ResolvedParams {
  readonly keywords: readonly string[]
  readonly categories: readonly string[]
  readonly submittedFrom: Date | undefined
  readonly submittedTo: Date | undefined
  readonly sortBy: Schema.Schema.Type<typeof SortBy>
  readonly sortOrder: Schema.Schema.Type<typeof SortOrder>
  readonly maxResults: number
  readonly start: number
}

/** 缺省值集中放这里，改行为不用翻函数体。 */
export const defaults = {
  sortBy: "relevance",
  sortOrder: "descending",
  maxResults: 20,
  start: 0,
} as const

export const resolveParams = (params: SearchParams): ResolvedParams => ({
  keywords: params.keywords,
  categories: params.categories ?? [],
  submittedFrom: params.submittedFrom,
  submittedTo: params.submittedTo,
  sortBy: params.sortBy ?? defaults.sortBy,
  sortOrder: params.sortOrder ?? defaults.sortOrder,
  maxResults: params.maxResults ?? defaults.maxResults,
  start: params.start ?? defaults.start,
})

const pad = (value: number): string => String(value).padStart(2, "0")

/** Date → arXiv 的 `YYYYMMDDHHMM`（固定 UTC 解释，避免本机时区漂移）。 */
const stamp = (date: Date, time: string): string =>
  `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${time}`

const OPEN_START = "000101010000"
const OPEN_END = "999912312359"

/** 只给单边时，另一边用最大范围补齐——arXiv 的区间语法不接受开区间。 */
const submittedRange = (
  from: Date | undefined,
  to: Date | undefined,
): string | undefined => {
  if (from === undefined && to === undefined) return undefined
  const lower = from === undefined ? OPEN_START : stamp(from, "0000")
  const upper = to === undefined ? OPEN_END : stamp(to, "2359")
  return `submittedDate:[${lower} TO ${upper}]`
}

/** 短语检索：加引号并去掉会破坏查询式的双引号。 */
const keywordTerm = (keyword: string): string =>
  `all:"${keyword.replaceAll('"', "")}"`

/** 分类条件：多个分类之间 OR，整体加括号，避免与 AND 抢优先级。 */
const categoriesTerm = (categories: readonly string[]): string | undefined => {
  if (categories.length === 0) return undefined
  const terms = categories.map((category) => `cat:${category}`)
  return `(${terms.join(" OR ")})`
}

/** 组装 arXiv 的 `search_query` 表达式。 */
export const toSearchQuery = (params: ResolvedParams): string => {
  const keywordTermGroup = `(${params.keywords.map(keywordTerm).join(" OR ")})`
  const terms = [
    keywordTermGroup,
    categoriesTerm(params.categories),
    submittedRange(params.submittedFrom, params.submittedTo),
  ]
  return terms.filter((term) => term !== undefined).join(" AND ")
}

/** 组装 API 查询字符串。 */
export const toApiParams = (
  params: ResolvedParams,
): Readonly<Record<string, string>> => ({
  search_query: toSearchQuery(params),
  start: String(params.start),
  max_results: String(params.maxResults),
  sortBy: params.sortBy,
  sortOrder: params.sortOrder,
})
