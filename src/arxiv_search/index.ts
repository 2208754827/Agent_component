/**
 * 组件：arxiv_search 的唯一出口。
 *
 * 规则：**一个组件只暴露一个函数** —— `arxivSearch`。
 * 其余导出全是 `export type`，编译后会被完全擦除，
 * 所以本组件在运行时只有 `arxivSearch` 一个导出值。
 *
 * 组件内部文件（client / feed / params / paper / errors）之间的 export 属于
 * 模块间协作与单测取用，**不是组件出口**；外部不要绕过本文件去 import 它们。
 */
export { arxivSearch } from "./client.js"

export type { Config, Search } from "./client.js"
export type { Author, FeedPage, Paper } from "./paper.js"
export type { SearchParams } from "./params.js"
export type {
  ArxivSearchError,
  FeedDecodeError,
  FeedParseError,
  HttpStatusError,
  InvalidParamsError,
  TransportError,
} from "./errors.js"
