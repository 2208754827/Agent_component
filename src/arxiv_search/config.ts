/** 会话配置：调用方只填需要覆盖的值，创建会话时一次性校验。 */
import { Duration, Effect } from "effect"
import { InvalidParamsError } from "./errors.js"

export interface Config {
  readonly baseUrl?: string
  readonly timeout?: Duration.DurationInput
  readonly userAgent?: string
  readonly retry?: {
    readonly times?: number
    readonly base?: Duration.DurationInput
    readonly factor?: number
  }
  readonly cache?: {
    /** 成功结果的保留时间，默认 24 小时。 */
    readonly timeToLive?: Duration.DurationInput
    /** 最大缓存页数；0 表示关闭缓存。 */
    readonly capacity?: number
  }
}

export const defaultConfig = {
  baseUrl: "https://export.arxiv.org/api/query",
  timeout: 30_000,
  userAgent: "agent-component/0.0.0 (+arxiv_search)",
  retry: { times: 3, base: 3_000, factor: 2 },
  cache: { timeToLive: 86_400_000, capacity: 128 },
} as const

/** 本地退避最多一分钟；服务器 Retry-After 可要求更久。 */
export const MAX_RETRY_DELAY_MS = 60_000
const MAX_TIMER_MS = 2 ** 31 - 1

export interface ResolvedConfig {
  readonly baseUrl: string
  readonly timeout: number
  readonly userAgent: string
  readonly retry: { readonly times: number; readonly base: number; readonly factor: number }
  readonly cache: { readonly timeToLive: number; readonly capacity: number }
}

const durationMillis = (value: Duration.DurationInput, name: string): number => {
  const millis = Duration.toMillis(Duration.decode(value))
  if (!Number.isFinite(millis) || millis <= 0) {
    throw new Error(name + " 必须是有限的正时长")
  }
  return millis
}

export const resolveConfig = (config: Config): Effect.Effect<ResolvedConfig, InvalidParamsError> =>
  Effect.try({
    try: () => {
      const times = config.retry?.times ?? defaultConfig.retry.times
      const factor = config.retry?.factor ?? defaultConfig.retry.factor
      const capacity = config.cache?.capacity ?? defaultConfig.cache.capacity
      if (!Number.isSafeInteger(times) || times < 0) throw new Error("retry.times 必须是非负整数")
      if (!Number.isFinite(factor) || factor < 1) throw new Error("retry.factor 必须是 >= 1 的有限数")
      if (!Number.isSafeInteger(capacity) || capacity < 0) throw new Error("cache.capacity 必须是非负整数")
      const baseUrl = new URL(config.baseUrl ?? defaultConfig.baseUrl)
      if (!["http:", "https:"].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password) {
        throw new Error("baseUrl 必须是没有内嵌凭据的 HTTP(S) URL")
      }
      const userAgent = new Headers({ "user-agent": config.userAgent ?? defaultConfig.userAgent }).get("user-agent")
      if (!userAgent) throw new Error("userAgent 不能为空")
      const timeout = durationMillis(config.timeout ?? defaultConfig.timeout, "timeout")
      const base = durationMillis(config.retry?.base ?? defaultConfig.retry.base, "retry.base")
      if (timeout > MAX_TIMER_MS) throw new Error("timeout 超过定时器支持的上限")
      if (base > MAX_RETRY_DELAY_MS) throw new Error("retry.base 不能超过 60 秒")
      return {
        baseUrl: baseUrl.toString(),
        userAgent,
        timeout,
        retry: {
          times,
          factor,
          base,
        },
        cache: {
          capacity,
          timeToLive: durationMillis(config.cache?.timeToLive ?? defaultConfig.cache.timeToLive, "cache.timeToLive"),
        },
      }
    },
    catch: (cause) => new InvalidParamsError({ detail: "会话配置不合法：" + String(cause) }),
  })
