/**
 * 组件主函数的契约测试：喂假 HttpClient，不联网。
 *
 * 验的是「输入 -> 请求 -> 输出」整条装配是否正确，尤其是
 * 参数有没有真的拼进 URL、错误有没有按约定分类。
 */
import { beforeEach, describe, expect, it } from "vitest"
import { Effect, Layer } from "effect"
import { HttpClient, HttpClientResponse, UrlParams } from "@effect/platform"
import type { HttpClientRequest } from "@effect/platform"
import { arxivSearch, defaultConfig } from "../client.js"
import { emptyFeed, missingTitleFeed, twoPaperFeed } from "./fixtures.js"

/** 测试配置：关掉重试，失败用例不用空等退避。 */
const testConfig = {
  ...defaultConfig,
  retry: { ...defaultConfig.retry, times: 0 },
}

/** 记录每次「发出」的请求，用来断言 URL 参数。 */
const requests: Array<HttpClientRequest.HttpClientRequest> = []

/** 假 HttpClient：不联网，直接吐固定响应。 */
const fakeHttpClient = (body: string, status = 200) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) => {
      requests.push(request)
      return Effect.succeed(
        HttpClientResponse.fromWeb(request, new Response(body, { status })),
      )
    }),
  )

const run = (input: unknown, body: string, status = 200) =>
  Effect.runPromise(
    Effect.provide(
      Effect.flatMap(arxivSearch(testConfig), (search) => search(input)),
      fakeHttpClient(body, status),
    ),
  )

/** 取失败通道的错误对象。 */
const runFailure = (input: unknown, body: string, status = 200) =>
  Effect.runPromise(
    Effect.flip(
      Effect.provide(
        Effect.flatMap(arxivSearch(testConfig), (search) => search(input)),
        fakeHttpClient(body, status),
      ),
    ),
  )

const first = <A>(items: readonly A[]): A => {
  const [head] = items
  if (head === undefined) throw new Error("期望至少有一条数据")
  return head
}

beforeEach(() => {
  requests.length = 0
})

describe("arxivSearch / 正常链路", () => {
  it("输入参数 -> 标准化结果页", async () => {
    const page = await run({ keywords: ["diffusion policy"] }, twoPaperFeed)
    expect(page.totalResults).toBe(1187)
    expect(page.papers).toHaveLength(2)
    expect(first(page.papers).arxivId).toBe("2409.00001")
  })

  it("零结果返回空数组，而不是报错", async () => {
    const page = await run({ keywords: ["nothing matches"] }, emptyFeed)
    expect(page.papers).toEqual([])
    expect(page.totalResults).toBe(0)
  })

  it("参数真的被拼进了请求的查询串", async () => {
    await run(
      {
        keywords: ["diffusion policy"],
        categories: ["cs.RO"],
        maxResults: 5,
        start: 10,
        sortBy: "submittedDate",
      },
      twoPaperFeed,
    )
    const record = UrlParams.toRecord(first(requests).urlParams)
    expect(record["search_query"]).toBe(
      '(all:"diffusion policy") AND (cat:cs.RO)',
    )
    expect(record["max_results"]).toBe("5")
    expect(record["start"]).toBe("10")
    expect(record["sortBy"]).toBe("submittedDate")
  })
})

describe("arxivSearch / 失败链路", () => {
  it("参数不合法 -> InvalidParamsError，且一个请求都不发", async () => {
    const error = await runFailure({ keywords: [] }, twoPaperFeed)
    expect(error._tag).toBe("InvalidParamsError")
    expect(requests).toHaveLength(0)
  })

  it("多余字段被拒绝（LLM 常把 keywords 写成 keyword）", async () => {
    const error = await runFailure({ keyword: "a" }, twoPaperFeed)
    expect(error._tag).toBe("InvalidParamsError")
    expect(requests).toHaveLength(0)
  })

  it("429 限流 -> HttpStatusError(429)", async () => {
    const error = await runFailure(
      { keywords: ["a"] },
      "too many requests",
      429,
    )
    expect(error).toMatchObject({ _tag: "HttpStatusError", status: 429 })
  })

  it("500 服务端错误 -> HttpStatusError(500)", async () => {
    const error = await runFailure({ keywords: ["a"] }, "boom", 500)
    expect(error).toMatchObject({ _tag: "HttpStatusError", status: 500 })
  })

  it("响应结构对不上 -> FeedDecodeError", async () => {
    const error = await runFailure({ keywords: ["a"] }, missingTitleFeed)
    expect(error._tag).toBe("FeedDecodeError")
  })
})
