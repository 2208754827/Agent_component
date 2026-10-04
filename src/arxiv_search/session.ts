/**
 * 每个会话独有的排队、冷却时间和有界成功缓存；没有模块级可变状态。
 * 锁覆盖一次缓存未命中的全部尝试，重试不会绕过串行调度。
 */
import { Clock, Duration, Effect, Ref } from "effect"
import type { ResolvedConfig } from "./config.js"
import type { FeedPage } from "./paper.js"

const REQUEST_GAP_MS = 3_000
const MAX_SLEEP_NANOS = 86_400_000_000_000n

/** 单调时钟不受系统校时影响；HTTP-date 会另用墙上时钟换算为时长。 */
const nowNanos = Clock.currentTimeNanos
const toNanos = (millis: number): bigint => BigInt(Math.ceil(millis)) * 1_000_000n

interface CachedPage {
  readonly page: FeedPage
  readonly expiresAt: bigint
}

/** Retry-After 支持整数秒或 HTTP-date，忽略无效值。 */
export const retryAfterMillis = (header: string | undefined, now: number): number | undefined => {
  if (header === undefined) return undefined
  const value = header.trim()
  const millis = /^\d+$/u.test(value)
    ? Number(value) * 1_000
    : /^[A-Za-z]{3,9}[, ]/u.test(value)
      ? Date.parse(value) - now
      : NaN
  return Number.isFinite(millis) ? Math.max(0, millis) : undefined
}

export const makeSession = (config: ResolvedConfig["cache"]) =>
  Effect.gen(function* () {
    const semaphore = yield* Effect.makeSemaphore(1)
    const nextAllowedAt = yield* Ref.make(0n)
    const cache = yield* Ref.make<ReadonlyMap<string, CachedPage>>(new Map())

    const postpone = (millis: number) => Effect.gen(function* () {
      const deadline = (yield* nowNanos) + toNanos(millis)
      yield* Ref.update(nextAllowedAt, (previous) => previous > deadline ? previous : deadline)
    })

    const waitForTurn = Effect.gen(function* () {
      while (true) {
        const remaining = (yield* Ref.get(nextAllowedAt)) - (yield* nowNanos)
        if (remaining <= 0n) return
        // Node 的定时器有上限；很长的 Retry-After 分段等待，且始终可以取消。
        yield* Effect.sleep(Duration.nanos(remaining < MAX_SLEEP_NANOS ? remaining : MAX_SLEEP_NANOS))
      }
    })

    const getCached = (key: string) => Effect.gen(function* () {
      const now = yield* nowNanos
      return yield* Ref.modify(cache, (entries) => {
        const entry = entries.get(key)
        if (entry === undefined) return [undefined, entries] as const
        const updated = new Map(entries)
        updated.delete(key)
        if (entry.expiresAt <= now) return [undefined, updated] as const
        updated.set(key, entry) // 命中移到末尾；容量满时逐出最久未访问的页。
        return [entry.page, updated] as const
      })
    })

    const putCached = (key: string, page: FeedPage) => Effect.gen(function* () {
      if (config.capacity === 0) return
      const now = yield* nowNanos
      yield* Ref.update(cache, (entries) => {
        const updated = new Map([...entries].filter(([, entry]) => entry.expiresAt > now))
        updated.delete(key)
        updated.set(key, { page, expiresAt: now + toNanos(config.timeToLive) })
        while (updated.size > config.capacity) {
          const oldest = updated.keys().next().value
          if (oldest === undefined) break
          updated.delete(oldest)
        }
        return updated
      })
    })

    const attempt = <A, E, R>(request: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
      Effect.zipRight(waitForTurn, request.pipe(Effect.ensuring(postpone(REQUEST_GAP_MS))))

    return { serial: semaphore.withPermits(1), attempt, postpone, getCached, putCached }
  })
