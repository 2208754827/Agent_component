/**
 * 数据模型：论文实体与结果页。Schema 既是运行时校验器，也是 TS 类型来源。
 */
import { Schema } from "effect"

/** 作者。`arxiv:affiliation` 常缺省，所以是可选的。 */
export const Author = Schema.Struct({
  name: Schema.String,
  affiliation: Schema.optional(Schema.String),
})
export type Author = Schema.Schema.Type<typeof Author>

/**
 * 标准化论文实体。
 *
 * 时间统一保留 arXiv 返回的 ISO 字符串（不转 Date），
 * 避免时区语义在管道里被反复解释。
 */
export const Paper = Schema.Struct({
  /** 不带版本号的 arXiv ID，如 `2409.00001`。 */
  arxivId: Schema.String,
  /** 版本号，如 `1`。 */
  version: Schema.optional(Schema.String),
  title: Schema.String,
  abstract: Schema.String,
  authors: Schema.Array(Author),
  primaryCategory: Schema.optional(Schema.String),
  categories: Schema.Array(Schema.String),
  published: Schema.String,
  updated: Schema.String,
  comment: Schema.optional(Schema.String),
  journalRef: Schema.optional(Schema.String),
  doi: Schema.optional(Schema.String),
  absUrl: Schema.String,
  pdfUrl: Schema.optional(Schema.String),
})
export type Paper = Schema.Schema.Type<typeof Paper>

/** 一次查询的结果页：条目 + 翻页元信息。 */
export const FeedPage = Schema.Struct({
  /** arXiv 命中的总数（可远大于本次拉回的数量）。 */
  totalResults: Schema.Number,
  startIndex: Schema.Number,
  itemsPerPage: Schema.Number,
  papers: Schema.Array(Paper),
})
export type FeedPage = Schema.Schema.Type<typeof FeedPage>
