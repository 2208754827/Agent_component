/** 离线策略测试：虚拟时钟推进真实 Effect 工作流，不等待真实网络或退避。 */
import { describe, expect, it } from "vitest"
import {
  Clock,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Option,
  TestClock,
  TestContext,
} from "effect"
import { HttpClient, HttpClientResponse, UrlParams } from "@effect/platform"
import { arxivSearch } from "../index.js"
import { twoPaperFeed } from "./fixtures.js"

interface Reply {
  readonly status?: number
  readonly headers?: Readonly<Record<string, string>>
  readonly bodyDelayMillis?: number
}

/**
 * 记录实际发出时间；连接从 execute 开始，到 request scope abort 才计为释放。
 * responder 可保持请求悬挂，用于检验互斥、超时和中断。
 */
const recordClient = (
  responder: (attempt: number) => Effect.Effect<Reply> = () => Effect.succeed({}),
) => {
  const starts: Array<{ readonly at: number; readonly query: string }> = []
  let active = 0
  let maxActive = 0
  let aborted = 0
  const client = HttpClient.make((request, _url, signal) =>
    Effect.gen(function* () {
      const attempt = starts.length
      const params = UrlParams.toRecord(request.urlParams)
      starts.push({
        at: yield* Clock.currentTimeMillis,
        query: String(params["search_query"]),
      })
      active += 1
      maxActive = Math.max(maxActive, active)
      signal.addEventListener(
        "abort",
        () => {
          active -= 1
          aborted += 1
        },
        { once: true },
      )
      const reply = yield* responder(attempt)
      const response = HttpClientResponse.fromWeb(
        request,
        new Response(twoPaperFeed, {
          status: reply.status ?? 200,
          headers: reply.headers,
        }),
      )
      const bodyDelayMillis = reply.bodyDelayMillis
      if (bodyDelayMillis === undefined) return response
      return new Proxy(response, {
        get(target, property, receiver) {
          return property === "text"
            ? Effect.zipRight(Effect.sleep(bodyDelayMillis), target.text)
            : Reflect.get(target, property, receiver)
        },
      })
    }),
  )
  return {
    client,
    starts,
    get active() {
      return active
    },
    get maxActive() {
      return maxActive
    },
    get aborted() {
      return aborted
    },
  }
}

const run = <A, E>(
  effect: Effect.Effect<A, E, HttpClient.HttpClient>,
  client: HttpClient.HttpClient,
) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provideService(HttpClient.HttpClient, client),
      Effect.provide(TestContext.TestContext),
    ),
  )

const request = (keyword = "alpha") => ({ keywords: [keyword] })

describe("arxivSearch / 共享请求策略", () => {
  it("并发查询只保留一个活动连接，响应完成后再等 3 秒", async () => {
    const recorded = recordClient(() =>
      Effect.sleep("1 second").pipe(Effect.as({})),
    )
    await run(
      Effect.gen(function* () {
        const search = yield* arxivSearch({ retry: { times: 0 } })
        const all = yield* Effect.fork(
          Effect.all(["a", "b", "c"].map((key) => search(request(key))), {
            concurrency: "unbounded",
          }),
        )
        yield* TestClock.adjust(0)
        expect(recorded.starts.map(({ at }) => at)).toEqual([0])
        expect(recorded.active).toBe(1)
        yield* TestClock.adjust("1 second")
        expect(recorded.active).toBe(0)
        yield* TestClock.adjust(2999)
        expect(recorded.starts).toHaveLength(1)
        yield* TestClock.adjust(1)
        expect(recorded.starts.map(({ at }) => at)).toEqual([0, 4000])
        yield* TestClock.adjust("5 seconds")
        yield* Fiber.join(all)
        expect(recorded.starts.map(({ at }) => at)).toEqual([0, 4000, 8000])
        expect(recorded.maxActive).toBe(1)
        expect(recorded.active).toBe(0)
        expect(recorded.aborted).toBe(3)
      }),
      recorded.client,
    )
  })

  it("首次重试至少等待 3 秒，并释放失败响应的连接", async () => {
    const recorded = recordClient((attempt) =>
      Effect.succeed({ status: attempt === 0 ? 429 : 200 }),
    )
    await run(
      Effect.gen(function* () {
        const search = yield* arxivSearch({ retry: { times: 1 } })
        const result = yield* Effect.fork(search(request()))
        yield* TestClock.adjust(0)
        expect(recorded.aborted).toBe(1)
        yield* TestClock.adjust(2999)
        expect(recorded.starts).toHaveLength(1)
        yield* TestClock.adjust(1001)
        yield* Fiber.join(result)
        expect(recorded.starts).toHaveLength(2)
        expect(recorded.starts[1]?.at).toBeGreaterThanOrEqual(3000)
        expect(recorded.maxActive).toBe(1)
        expect(recorded.aborted).toBe(2)
      }),
      recorded.client,
    )
  })

  it("极大指数倍率的 3 次重试都在 60 秒内推进，不会溢出为永久等待", async () => {
    const recorded = recordClient((attempt) =>
      Effect.succeed({ status: attempt < 3 ? 503 : 200 }),
    )
    await run(
      Effect.gen(function* () {
        const search = yield* arxivSearch({
          retry: { times: 3, factor: 1e308 },
        })
        const result = yield* Effect.fork(search(request()))
        yield* TestClock.adjust(0)
        expect(recorded.starts).toHaveLength(1)
        for (let retry = 1; retry <= 3; retry += 1) {
          yield* TestClock.adjust("60 seconds")
          expect(recorded.starts).toHaveLength(retry + 1)
        }
        yield* Fiber.join(result)
        for (let index = 1; index < recorded.starts.length; index += 1) {
          const gap = recorded.starts[index]!.at - recorded.starts[index - 1]!.at
          expect(gap).toBeGreaterThanOrEqual(3000)
          expect(gap).toBeLessThanOrEqual(60_000)
        }
        expect(recorded.maxActive).toBe(1)
        expect(recorded.active).toBe(0)
      }),
      recorded.client,
    )
  })

  it("retry.base 为 1 毫秒也不能绕过固定的 3 秒请求间隔", async () => {
    const recorded = recordClient((attempt) =>
      Effect.succeed({ status: attempt === 0 ? 503 : 200 }),
    )
    await run(
      Effect.gen(function* () {
        const search = yield* arxivSearch({ retry: { times: 1, base: 1 } })
        const result = yield* Effect.fork(search(request()))
        yield* TestClock.adjust(2999)
        expect(recorded.starts).toHaveLength(1)
        yield* TestClock.adjust(1)
        yield* Fiber.join(result)
        expect(recorded.starts.map(({ at }) => at)).toEqual([0, 3000])
      }),
      recorded.client,
    )
  })

  it("收到响应头后，读取响应体期间仍持有连接和许可", async () => {
    const recorded = recordClient((attempt) =>
      Effect.succeed(attempt === 0 ? { bodyDelayMillis: 2000 } : {}),
    )
    await run(
      Effect.gen(function* () {
        const search = yield* arxivSearch({ retry: { times: 0 } })
        const first = yield* Effect.fork(search(request("body")))
        yield* TestClock.adjust(0)
        const second = yield* Effect.fork(search(request("next")))
        yield* TestClock.adjust(1999)
        expect(recorded.starts).toHaveLength(1)
        expect(recorded.active).toBe(1)
        yield* TestClock.adjust(1)
        yield* Fiber.join(first)
        expect(recorded.active).toBe(0)
        yield* TestClock.adjust(2999)
        expect(recorded.starts).toHaveLength(1)
        yield* TestClock.adjust(1)
        yield* Fiber.join(second)
        expect(recorded.starts.map(({ at }) => at)).toEqual([0, 5000])
        expect(recorded.maxActive).toBe(1)
      }),
      recorded.client,
    )
  })

  const epoch = Date.parse("2026-09-30T00:00:00Z")
  it.each([
    { format: "秒数", status: 429, value: "12" },
    {
      format: "HTTP-date",
      status: 503,
      value: new Date(epoch + 12_000).toUTCString(),
    },
  ])("放弃重试后，其他查询仍遵守 $format Retry-After", async ({ status, value }) => {
    const recorded = recordClient((attempt) =>
      Effect.succeed(
        attempt === 0
          ? { status, headers: { "retry-after": value } }
          : {},
      ),
    )
    await run(
      Effect.gen(function* () {
        yield* TestClock.setTime(epoch)
        const search = yield* arxivSearch({ retry: { times: 0 } })
        const failure = yield* Effect.exit(search(request("limited")))
        expect(Exit.isFailure(failure)).toBe(true)
        expect(recorded.aborted).toBe(1)
        const next = yield* Effect.fork(search(request("other")))
        yield* TestClock.adjust(11_999)
        expect(recorded.starts).toHaveLength(1)
        yield* TestClock.adjust(1)
        yield* Fiber.join(next)
        expect(recorded.starts.map(({ at }) => at)).toEqual([epoch, epoch + 12_000])
      }),
      recorded.client,
    )
  })

  it("30 天 Retry-After 分段等待，下一查询到期限才发出", async () => {
    const delayMillis = 30 * 24 * 60 * 60 * 1000
    const recorded = recordClient((attempt) =>
      Effect.succeed(
        attempt === 0
          ? { status: 429, headers: { "retry-after": String(delayMillis / 1000) } }
          : {},
      ),
    )
    await run(
      Effect.gen(function* () {
        const search = yield* arxivSearch({ retry: { times: 0 } })
        expect(Exit.isFailure(yield* Effect.exit(search(request("limited"))))).toBe(true)
        const next = yield* Effect.fork(search(request("other")))
        yield* TestClock.adjust(0)
        const timers = Array.from(yield* TestClock.sleeps())
        expect(timers.length).toBeGreaterThan(0)
        // 30 天超过 Node 定时器上限，不能安排一个会溢出的单次 sleep。
        expect(timers.every((deadline) => deadline <= 2_147_483_647)).toBe(true)
        yield* TestClock.adjust(delayMillis - 1)
        expect(recorded.starts).toHaveLength(1)
        yield* TestClock.adjust(1)
        yield* Fiber.join(next)
        expect(recorded.starts.map(({ at }) => at)).toEqual([0, delayMillis])
        expect(recorded.active).toBe(0)
      }),
      recorded.client,
    )
  })

  it("排队和限速不计入单次请求超时", async () => {
    const recorded = recordClient((attempt) =>
      attempt === 0 ? Effect.never : Effect.succeed({}),
    )
    await run(
      Effect.gen(function* () {
        const search = yield* arxivSearch({
          timeout: "1 second",
          retry: { times: 0 },
        })
        const first = yield* Effect.fork(Effect.exit(search(request("timeout"))))
        yield* TestClock.adjust(0)
        const second = yield* Effect.fork(search(request("queued")))
        yield* TestClock.adjust("4 seconds")
        expect(Exit.isFailure(yield* Fiber.join(first))).toBe(true)
        yield* Fiber.join(second)
        expect(recorded.starts.map(({ at }) => at)).toEqual([0, 4000])
        expect(recorded.maxActive).toBe(1)
        expect(recorded.active).toBe(0)
      }),
      recorded.client,
    )
  })

  it("取消排队查询后，其他查询仍能取得许可", async () => {
    await run(
      Effect.gen(function* () {
        const release = yield* Deferred.make<void>()
        const recorded = recordClient((attempt) =>
          attempt === 0
            ? Deferred.await(release).pipe(Effect.as({}))
            : Effect.succeed({}),
        )
        const search = yield* arxivSearch({ retry: { times: 0 } }).pipe(
          Effect.provideService(HttpClient.HttpClient, recorded.client),
        )
        const first = yield* Effect.fork(search(request("first")))
        yield* TestClock.adjust(0)
        const queued = yield* Effect.fork(search(request("cancelled")))
        yield* TestClock.adjust(0)
        expect(Exit.isInterrupted(yield* Fiber.interrupt(queued))).toBe(true)
        yield* Deferred.succeed(release, undefined)
        yield* TestClock.adjust(0)
        yield* Fiber.join(first)
        const next = yield* Effect.fork(search(request("next")))
        yield* TestClock.adjust(2999)
        expect(recorded.starts).toHaveLength(1)
        yield* TestClock.adjust(1)
        yield* Fiber.join(next)
        expect(recorded.starts.map(({ query }) => query)).toEqual([
          '(all:"first")',
          '(all:"next")',
        ])
        expect(recorded.active).toBe(0)
      }),
      recordClient().client,
    )
  })

  it("取消活动请求会释放连接和锁，下一次请求仍等待 3 秒", async () => {
    const recorded = recordClient((attempt) =>
      attempt === 0 ? Effect.never : Effect.succeed({}),
    )
    await run(
      Effect.gen(function* () {
        const search = yield* arxivSearch({ retry: { times: 0 } })
        const first = yield* Effect.fork(search(request()))
        yield* TestClock.adjust(0)
        expect(recorded.active).toBe(1)
        expect(Exit.isInterrupted(yield* Fiber.interrupt(first))).toBe(true)
        expect(recorded.active).toBe(0)
        expect(recorded.aborted).toBe(1)
        const next = yield* Effect.fork(search(request()))
        yield* TestClock.adjust(2999)
        expect(recorded.starts).toHaveLength(1)
        yield* TestClock.adjust(1)
        yield* Fiber.join(next)
        expect(recorded.starts.map(({ at }) => at)).toEqual([0, 3000])
        expect(recorded.maxActive).toBe(1)
        expect(recorded.active).toBe(0)
      }),
      recorded.client,
    )
  })
})

describe("arxivSearch / 成功结果缓存", () => {
  it("等价输入并发只发送一次请求，显式默认值与省略默认值共用缓存", async () => {
    const recorded = recordClient(() =>
      Effect.sleep("1 second").pipe(Effect.as({})),
    )
    await run(
      Effect.gen(function* () {
        const search = yield* arxivSearch({ retry: { times: 0 } })
        const all = yield* Effect.fork(
          Effect.all(
            [
              search(request()),
              search({
                ...request(),
                categories: [],
                maxResults: 20,
                start: 0,
                sortBy: "relevance",
                sortOrder: "descending",
              }),
              search(request()),
            ],
            { concurrency: "unbounded" },
          ),
        )
        yield* TestClock.adjust("1 second")
        const pages = yield* Fiber.join(all)
        expect(pages).toHaveLength(3)
        expect(pages[0]).toEqual(pages[1])
        expect(recorded.starts).toHaveLength(1)
      }),
      recorded.client,
    )
  })

  it("不同分页参数分别请求和缓存", async () => {
    const recorded = recordClient()
    await run(
      Effect.gen(function* () {
        const search = yield* arxivSearch({ retry: { times: 0 } })
        yield* search(request())
        const second = yield* Effect.fork(search({ ...request(), start: 20 }))
        yield* TestClock.adjust("3 seconds")
        yield* Fiber.join(second)
        yield* search(request())
        yield* search({ ...request(), start: 20 })
        expect(recorded.starts).toHaveLength(2)
      }),
      recorded.client,
    )
  })

  it("默认 24 小时 TTL 从响应成功完成时起算，到期后重新请求", async () => {
    const recorded = recordClient((attempt) =>
      attempt === 0
        ? Effect.sleep("5 seconds").pipe(Effect.as({}))
        : Effect.succeed({}),
    )
    await run(
      Effect.gen(function* () {
        const search = yield* arxivSearch({ retry: { times: 0 } })
        const first = yield* Effect.fork(search(request()))
        yield* TestClock.adjust("5 seconds")
        yield* Fiber.join(first)
        yield* TestClock.adjust(86_400_000 - 1)
        yield* search(request())
        expect(recorded.starts).toHaveLength(1)
        yield* TestClock.adjust(1)
        yield* search(request())
        expect(recorded.starts.map(({ at }) => at)).toEqual([0, 86_405_000])
      }),
      recorded.client,
    )
  })

  it("容量达到上限时驱逐旧查询", async () => {
    const recorded = recordClient()
    await run(
      Effect.gen(function* () {
        const search = yield* arxivSearch({
          retry: { times: 0 },
          cache: { capacity: 1 },
        })
        yield* search(request("a"))
        const second = yield* Effect.fork(search(request("b")))
        yield* TestClock.adjust("3 seconds")
        yield* Fiber.join(second)
        const evicted = yield* Effect.fork(search(request("a")))
        yield* TestClock.adjust("3 seconds")
        yield* Fiber.join(evicted)
        expect(recorded.starts.map(({ query }) => query)).toEqual([
          '(all:"a")',
          '(all:"b")',
          '(all:"a")',
        ])
      }),
      recorded.client,
    )
  })

  it("失败结果不缓存，下一次同样查询可以恢复成功", async () => {
    const recorded = recordClient((attempt) =>
      Effect.succeed({ status: attempt === 0 ? 500 : 200 }),
    )
    await run(
      Effect.gen(function* () {
        const search = yield* arxivSearch({ retry: { times: 0 } })
        expect(Exit.isFailure(yield* Effect.exit(search(request())))).toBe(true)
        const recovered = yield* Effect.fork(search(request()))
        yield* TestClock.adjust("3 seconds")
        yield* Fiber.join(recovered)
        yield* search(request())
        expect(recorded.starts).toHaveLength(2)
      }),
      recorded.client,
    )
  })

  it("缓存命中不被其他正在执行的查询阻塞", async () => {
    const recorded = recordClient((attempt) =>
      attempt === 1 ? Effect.never : Effect.succeed({}),
    )
    await run(
      Effect.gen(function* () {
        const search = yield* arxivSearch({ retry: { times: 0 } })
        yield* search(request("cached"))
        const active = yield* Effect.fork(search(request("slow")))
        yield* TestClock.adjust("3 seconds")
        const hit = yield* Effect.fork(search(request("cached")))
        yield* TestClock.adjust(0)
        const result = yield* Fiber.poll(hit)
        expect(Option.isSome(result) && Exit.isSuccess(result.value)).toBe(true)
        yield* Fiber.interrupt(active)
        expect(recorded.starts).toHaveLength(2)
        expect(recorded.active).toBe(0)
      }),
      recorded.client,
    )
  })
})
