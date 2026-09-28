/**
 * 组件：arxiv_search 对外的唯一出口。
 *
 * 外部只允许从本文件导入；组件内部文件（client / feed / params / paper / errors）
 * 属于实现细节，改它们不该影响调用方。
 */
export { arxivSearch, defaultConfig } from "./client.js"
export type { Config } from "./client.js"
export { Author, FeedPage, Paper } from "./paper.js"
export {
  defaults,
  MAX_RESULTS_LIMIT,
  resolveParams,
  SearchParams,
  SortBy,
  SortOrder,
  toApiParams,
  toSearchQuery,
} from "./params.js"
export { parseFeed } from "./feed.js"
export {
  FeedDecodeError,
  FeedParseError,
  HttpStatusError,
  InvalidParamsError,
  TransportError,
} from "./errors.js"
export type { ArxivSearchError } from "./errors.js"
