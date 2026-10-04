import { describe, expect, it } from "vitest"
import { Effect } from "effect"
import { FetchHttpClient, HttpClient, HttpClientResponse } from "@effect/platform"
import { arxivSearch, type Config } from "../index.js"
import { twoPaperFeed } from "./fixtures.js"

describe("arxivSearch / 创建会话", () => {
  it.each<Config>([
    { baseUrl: "not a URL" },
    { baseUrl: "file:///tmp/feed.xml" },
    { baseUrl: "https://user:password@example.org/api" },
    { userAgent: "bad\r\nheader" },
    { userAgent: "   " },
    { timeout: "30 days" },
    { timeout: "0 seconds" },
    { retry: { base: "30 days" } },
    { retry: { times: -1 } },
    { retry: { factor: Infinity } },
    { cache: { capacity: -1 } },
    { cache: { timeToLive: "0 seconds" } },
  ])("配置错误在创建时返回 InvalidParamsError，不发请求：%j", async (config) => {
    let calls = 0
    const client = HttpClient.make((request) => {
      calls += 1
      return Effect.succeed(HttpClientResponse.fromWeb(request, new Response(twoPaperFeed)))
    })
    const error = await Effect.runPromise(
      Effect.flip(arxivSearch(config)).pipe(Effect.provideService(HttpClient.HttpClient, client)),
    )
    expect(error._tag).toBe("InvalidParamsError")
    expect(calls).toBe(0)
  })

  it("工厂和 search 都是惰性的；只在执行查询时调用注入的客户端", async () => {
    let calls = 0
    const client = HttpClient.make((request) => {
      calls += 1
      return Effect.succeed(HttpClientResponse.fromWeb(request, new Response(twoPaperFeed)))
    })
    const factory = arxivSearch({ retry: { times: 0 } })
    expect(calls).toBe(0)
    const search = await Effect.runPromise(factory.pipe(Effect.provideService(HttpClient.HttpClient, client)))
    const query = search({ keywords: ["a"] })
    expect(calls).toBe(0)
    await Effect.runPromise(query)
    expect(calls).toBe(1)
  })

  it("默认 Fetch 不自动重定向，3xx 被返回为状态码错误", async () => {
    const redirects: Array<RequestInit["redirect"]> = []
    const cacheOptions: Array<RequestInit["cache"]> = []
    const signals: Array<AbortSignal | null | undefined> = []
    const fakeFetch: typeof fetch = async (_input, init) => {
      redirects.push(init?.redirect)
      cacheOptions.push(init?.cache)
      signals.push(init?.signal)
      return new Response(null, { status: 302, headers: { location: "https://example.org/next" } })
    }
    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const search = yield* arxivSearch()
        return yield* Effect.flip(search({ keywords: ["a"] }))
      }).pipe(
        Effect.provide(FetchHttpClient.layer),
        Effect.provideService(FetchHttpClient.Fetch, fakeFetch),
        Effect.provideService(FetchHttpClient.RequestInit, { redirect: "follow", cache: "no-store" }),
      ),
    )
    expect(error).toMatchObject({ _tag: "HttpStatusError", status: 302 })
    expect(redirects).toEqual(["manual"])
    expect(cacheOptions).toEqual(["no-store"])
    expect(signals[0]?.aborted).toBe(true)
  })
})
