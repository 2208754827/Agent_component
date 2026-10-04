/** 创建可共享的检索会话。所有网络和状态操作都是惰性的 Effect。 */
import { Clock, Duration, Effect, Option, ParseResult, pipe, Schedule, Schema } from "effect"
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "@effect/platform"
import type { HttpClientError } from "@effect/platform"
import { MAX_RETRY_DELAY_MS, resolveConfig, type Config } from "./config.js"
import {
  HttpStatusError,
  InvalidParamsError,
  TransportError,
  type ArxivSearchError,
} from "./errors.js"
import { parseFeed } from "./feed.js"
import { resolveParams, SearchParams, toApiParams } from "./params.js"
import type { FeedPage } from "./paper.js"
import { makeSession, retryAfterMillis } from "./session.js"

export { defaultConfig } from "./config.js"
export type { Config } from "./config.js"

/** 从同一个会话取得的函数共享连接、冷却时间与缓存。 */
export type Search = (input: unknown) => Effect.Effect<FeedPage, ArxivSearchError>

const isRetryable = (error: ArxivSearchError): boolean =>
  error._tag === "TransportError" ||
  (error._tag === "HttpStatusError" &&
    (error.status === 429 || (error.status >= 500 && error.status <= 599)))

/** 读取 body 的失败也属于传输失败，不能误报为 HttpStatusError(200)。 */
const toHttpError = (
  error: HttpClientError.HttpClientError | TransportError,
): TransportError | HttpStatusError => {
  if (error._tag === "TransportError") return error
  if (error._tag === "ResponseError" && error.reason === "StatusCode") {
    return new HttpStatusError({ url: error.request.url, status: error.response.status })
  }
  return new TransportError({ url: error.request.url, detail: error.message })
}

const decodeParams = (input: unknown) =>
  pipe(
    Schema.decodeUnknown(SearchParams, { onExcessProperty: "error" })(input),
    Effect.mapError((error) => new InvalidParamsError({
      detail: ParseResult.TreeFormatter.formatErrorSync(error),
    })),
    Effect.map(resolveParams),
  )

/**
 * 入口执行一次工厂，随后把 search 交给所有检索任务复用。
 * 不要逐请求创建会话；多进程/多机器需要通过同一检索服务统一调度。
 */
export const arxivSearch = (
  config: Config = {},
): Effect.Effect<Search, InvalidParamsError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const options = yield* resolveConfig(config)
    const client = HttpClient.withScope(yield* HttpClient.HttpClient)
    const fetchOptions = Option.getOrElse(
      yield* Effect.serviceOption(FetchHttpClient.RequestInit),
      (): RequestInit => ({}),
    )
    const session = yield* makeSession(options.cache)
    const schedule = Schedule.forever.pipe(
      // 先截断数值再交给 Schedule，指数溢出也不会变成无限等待。
      Schedule.addDelay((attempt) => Math.min(
        options.retry.base * options.retry.factor ** attempt,
        MAX_RETRY_DELAY_MS,
      )),
      Schedule.jitteredWith({ min: 1, max: 1.2 }),
      Schedule.modifyDelay((_, delay) => Duration.min(delay, Duration.millis(MAX_RETRY_DELAY_MS))),
    )

    const fetchPage = (apiParams: Readonly<Record<string, string>>) => {
      const request = HttpClientRequest.get(options.baseUrl, {
        urlParams: apiParams,
        headers: { "user-agent": options.userAgent },
      })
      const http = Effect.gen(function* () {
        const response = yield* client.execute(request)
        if (response.status === 429 || response.status === 503) {
          const delay = retryAfterMillis(
            response.headers["retry-after"],
            yield* Clock.currentTimeMillis,
          )
          if (delay !== undefined) yield* session.postpone(delay)
        }
        yield* HttpClientResponse.filterStatusOk(response)
        return yield* response.text
      }).pipe(
        // Fetch 默认自动跟随重定向会绕过请求间隔；将 3xx 交给普通状态码错误处理。
        Effect.provideService(FetchHttpClient.RequestInit, { ...fetchOptions, redirect: "manual" }),
        Effect.timeoutFail({
          duration: options.timeout,
          onTimeout: () => new TransportError({ url: request.url, detail: "请求超时" }),
        }),
        Effect.mapError(toHttpError),
      )
      return session.attempt(Effect.scoped(http)).pipe(
        Effect.flatMap(parseFeed),
        Effect.retry({ schedule, times: options.retry.times, while: isRetryable }),
      )
    }

    return (input: unknown) => Effect.gen(function* () {
      const params = yield* decodeParams(input)
      const apiParams = toApiParams(params)
      const key = JSON.stringify(apiParams)
      const cached = yield* session.getCached(key)
      if (cached !== undefined) return structuredClone(cached)
      return yield* session.serial(Effect.gen(function* () {
        // 等待期间前一个调用可能已取得相同页，重查即可合并并发重复请求。
        const shared = yield* session.getCached(key)
        if (shared !== undefined) return structuredClone(shared)
        const page = yield* fetchPage(apiParams)
        yield* session.putCached(key, page)
        return structuredClone(page)
      }))
    })
  })
