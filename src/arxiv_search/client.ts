/**
 * 检索请求：组件里唯一描述网络副作用的地方。
 *
 * 返回值是 Effect「描述」，不是正在跑的 Promise —— 执行只发生在入口。
 * 超时、限流退避都在这里收敛成组件的错误类型。
 */
import { Duration, Effect, ParseResult, pipe, Schedule, Schema } from "effect"
import {
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "@effect/platform"
import type { HttpClientError } from "@effect/platform"
import {
  HttpStatusError,
  InvalidParamsError,
  TransportError,
  type ArxivSearchError,
} from "./errors.js"
import { parseFeed } from "./feed.js"
import {
  resolveParams,
  SearchParams,
  toApiParams,
  type ResolvedParams,
} from "./params.js"
import type { FeedPage } from "./paper.js"

export interface Config {
  readonly baseUrl: string
  readonly timeout: Duration.DurationInput
  /** arXiv 要求带上能识别来源的 UA。 */
  readonly userAgent: string
  readonly retry: {
    readonly times: number
    readonly base: Duration.DurationInput
    readonly factor: number
  }
}

export const defaultConfig: Config = {
  /** https + export 子域，避免 301 往返（301 也会计入限流）。 */
  baseUrl: "https://export.arxiv.org/api/query",
  timeout: Duration.seconds(30),
  userAgent: "agent-component/0.0.0 (+arxiv_search)",
  retry: {
    times: 3,
    /** arXiv 官方建议请求间隔 >= 3s，退避起点就取这个值。 */
    base: Duration.seconds(3),
    factor: 2,
  },
}

/** 重试策略：只对「可能自己好」的错误重试，参数错误重试没有意义。 */
const isRetryable = (error: ArxivSearchError): boolean =>
  error._tag === "TransportError" ||
  (error._tag === "HttpStatusError" &&
    (error.status === 429 || error.status >= 500))

const retrySchedule = (
  retry: Config["retry"],
): Schedule.Schedule<Duration.Duration, ArxivSearchError, never> =>
  Schedule.jittered(Schedule.exponential(retry.base, retry.factor))

const retryOptions = (
  retry: Config["retry"],
): Effect.Retry.Options<ArxivSearchError> => ({
  schedule: retrySchedule(retry),
  times: retry.times,
  while: isRetryable,
})

/** 平台错误 / 超时 → 组件错误。 */
const toHttpError = (
  error: HttpClientError.HttpClientError | TransportError,
): TransportError | HttpStatusError =>
  error._tag === "ResponseError"
    ? new HttpStatusError({
        url: error.request.url,
        status: error.response.status,
      })
    : error._tag === "RequestError"
      ? new TransportError({ url: error.request.url, detail: error.reason })
      : error

const decodeParams = (
  input: unknown,
): Effect.Effect<ResolvedParams, InvalidParamsError> =>
  pipe(
    /** 参数可能来自 LLM，多余的字段（比如把 keywords 写成 keyword）一律拒绝。 */
    Schema.decodeUnknown(SearchParams, { onExcessProperty: "error" })(input),
    Effect.mapError(
      (error) =>
        new InvalidParamsError({
          detail: ParseResult.TreeFormatter.formatErrorSync(error),
        }),
    ),
    Effect.map(resolveParams),
  )

const buildRequest = (config: Config, params: ResolvedParams) =>
  HttpClientRequest.get(config.baseUrl, {
    urlParams: toApiParams(params),
    headers: { "user-agent": config.userAgent },
  })

const fetchFeed = (config: Config, params: ResolvedParams) => {
  const request = buildRequest(config, params)
  const timeoutError = () =>
    new TransportError({ url: request.url, detail: "请求超时" })

  return pipe(
    HttpClient.execute(request),
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap((response) => response.text),
    Effect.timeoutFail({ duration: config.timeout, onTimeout: timeoutError }),
    Effect.mapError(toHttpError),
    /** 解析错误在这里才进错误通道，和上面的 HTTP 错误分开处理。 */
    Effect.flatMap(parseFeed),
  )
}

/**
 * 检索 arXiv。
 *
 * - `input` 收 unknown：参数来自自然语言 / LLM，必须在边界上校验；
 * - 返回 Effect，需要 `HttpClient`，入口用 `FetchHttpClient.layer` 提供；
 * - 不做跨请求限速：连续调用请在调用方串行并留足间隔（后续「爬虫池」负责）。
 */
export const arxivSearch = (
  input: unknown,
  config: Config = defaultConfig,
): Effect.Effect<FeedPage, ArxivSearchError, HttpClient.HttpClient> =>
  pipe(
    decodeParams(input),
    Effect.flatMap((params) => fetchFeed(config, params)),
    Effect.retry(retryOptions(config.retry)),
  )
