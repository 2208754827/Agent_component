/**
 * 组件的错误类型：全部是 Schema.TaggedError，
 * 好处是 —— 可被 @effect/platform 的错误通道复用，也能直接序列化成 JSON 日志。
 */
import { Schema } from "effect"

/** 入参不合法：keywords 为空、maxResults 超上限、sortBy 不认识等。 */
export class InvalidParamsError extends Schema.TaggedError<InvalidParamsError>()(
  "InvalidParamsError",
  {
    detail: Schema.String,
  },
) {}

/** 传输层失败：DNS / 连接断开 / 超时 / URL 非法。 */
export class TransportError extends Schema.TaggedError<TransportError>()(
  "TransportError",
  {
    url: Schema.String,
    detail: Schema.String,
  },
) {}

/** 服务端返回非 2xx（429 限流、503 维护等）。 */
export class HttpStatusError extends Schema.TaggedError<HttpStatusError>()(
  "HttpStatusError",
  {
    url: Schema.String,
    status: Schema.Number,
  },
) {}

/** 响应不是合法 XML。 */
export class FeedParseError extends Schema.TaggedError<FeedParseError>()(
  "FeedParseError",
  {
    detail: Schema.String,
  },
) {}

/** XML 合法，但字段结构不符合 arXiv Atom 约定（接口改版或脏数据）。 */
export class FeedDecodeError extends Schema.TaggedError<FeedDecodeError>()(
  "FeedDecodeError",
  {
    detail: Schema.String,
  },
) {}

/** 组件对外暴露的全部错误。 */
export type ArxivSearchError =
  | InvalidParamsError
  | TransportError
  | HttpStatusError
  | FeedParseError
  | FeedDecodeError
