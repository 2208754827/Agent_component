/** 参数与查询式构造的纯函数单测（不联网、纯同步）。 */
import { describe, expect, it } from "vitest"
import { Either, Schema } from "effect"
import {
  resolveParams,
  SearchParams,
  toApiParams,
  toSearchQuery,
  type SearchParams as SearchParamsType,
} from "../params.js"

const decode = (input: unknown): SearchParamsType => {
  const decoded = Schema.decodeUnknownEither(SearchParams)(input)
  if (Either.isLeft(decoded)) {
    throw new Error(`夹具参数本该合法: ${JSON.stringify(input)}`)
  }
  return decoded.right
}

const decodeFails = (input: unknown): boolean =>
  Either.isLeft(Schema.decodeUnknownEither(SearchParams)(input))

/** 一步到位：原始输入 -> 最终查询式。 */
const query = (input: unknown): string =>
  toSearchQuery(resolveParams(decode(input)))

describe("toSearchQuery", () => {
  it("多个关键词之间 OR，整体加括号", () => {
    expect(query({ keywords: ["a b", "c d"] })).toBe(
      '(all:"a b" OR all:"c d")',
    )
  })

  it("多个分类之间 OR，整体加括号", () => {
    expect(query({ keywords: ["a"], categories: ["cs.RO", "cs.LG"] })).toBe(
      '(all:"a") AND (cat:cs.RO OR cat:cs.LG)',
    )
  })

  it("时间区间用 YYYYMMDDHHMM，上界补到当天 23:59", () => {
    expect(
      query({
        keywords: ["a"],
        submittedFrom: "2024-01-01",
        submittedTo: "2024-03-31",
      }),
    ).toBe('(all:"a") AND submittedDate:[202401010000 TO 202403312359]')
  })

  it("只给下界时，上界补最大范围", () => {
    expect(query({ keywords: ["a"], submittedFrom: "2024-01-01" })).toBe(
      '(all:"a") AND submittedDate:[202401010000 TO 999912312359]',
    )
  })

  it("只给上界时，下界补最小范围", () => {
    expect(query({ keywords: ["a"], submittedTo: "2024-03-31" })).toBe(
      '(all:"a") AND submittedDate:[000101010000 TO 202403312359]',
    )
  })

  it("没有分类和时间时，不出现多余的 AND", () => {
    expect(query({ keywords: ["a"] })).toBe('(all:"a")')
  })

  it("关键词里的双引号被剔除，避免破坏查询式", () => {
    expect(query({ keywords: ['robot "manipulation"'] })).toBe(
      '(all:"robot manipulation")',
    )
  })

  it("中文关键词原样保留", () => {
    expect(query({ keywords: ["四足机器人 强化学习"] })).toBe(
      '(all:"四足机器人 强化学习")',
    )
  })
})

describe("resolveParams 缺省值", () => {
  it("只给 keywords 时补全其余字段", () => {
    expect(resolveParams(decode({ keywords: ["a"] }))).toEqual({
      keywords: ["a"],
      categories: [],
      submittedFrom: undefined,
      submittedTo: undefined,
      sortBy: "relevance",
      sortOrder: "descending",
      maxResults: 20,
      start: 0,
    })
  })

  it("给了值就用给的值", () => {
    const params = resolveParams(
      decode({
        keywords: ["a"],
        sortBy: "submittedDate",
        sortOrder: "ascending",
        maxResults: 5,
        start: 10,
      }),
    )
    expect(params.sortBy).toBe("submittedDate")
    expect(params.sortOrder).toBe("ascending")
    expect(params.maxResults).toBe(5)
    expect(params.start).toBe(10)
  })
})

describe("toApiParams", () => {
  it("打包成 arXiv 的查询字符串参数", () => {
    const params = resolveParams(
      decode({
        keywords: ["a"],
        maxResults: 5,
        start: 10,
        sortBy: "submittedDate",
        sortOrder: "ascending",
      }),
    )
    expect(toApiParams(params)).toEqual({
      search_query: '(all:"a")',
      start: "10",
      max_results: "5",
      sortBy: "submittedDate",
      sortOrder: "ascending",
    })
  })
})

describe("SearchParams 校验", () => {
  it("keywords 必填", () => {
    expect(decodeFails({})).toBe(true)
  })

  it("keywords 不能是空数组", () => {
    expect(decodeFails({ keywords: [] })).toBe(true)
  })

  it("keywords 里不能只有空白", () => {
    expect(decodeFails({ keywords: ["   "] })).toBe(true)
  })

  it("maxResults 下界是 1", () => {
    expect(decodeFails({ keywords: ["a"], maxResults: 0 })).toBe(true)
  })

  it("maxResults 上界是 2000", () => {
    expect(decodeFails({ keywords: ["a"], maxResults: 2001 })).toBe(true)
  })

  it("start 不能为负", () => {
    expect(decodeFails({ keywords: ["a"], start: -1 })).toBe(true)
  })

  it("日期必须是真实存在的日期", () => {
    expect(decodeFails({ keywords: ["a"], submittedFrom: "2024-13-45" })).toBe(
      true,
    )
    expect(decodeFails({ keywords: ["a"], submittedFrom: "2024-02-30" })).toBe(
      true,
    )
    expect(decodeFails({ keywords: ["a"], submittedFrom: "not-a-date" })).toBe(
      true,
    )
  })

  it("闰年 2 月 29 通过，平年不通过", () => {
    expect(decodeFails({ keywords: ["a"], submittedFrom: "2024-02-29" })).toBe(
      false,
    )
    expect(decodeFails({ keywords: ["a"], submittedFrom: "2023-02-29" })).toBe(
      true,
    )
  })

  it("日期必须补零（2024-1-1 不通过）", () => {
    expect(decodeFails({ keywords: ["a"], submittedFrom: "2024-1-1" })).toBe(
      true,
    )
  })

  it("日期不接受带时间的 ISO 串", () => {
    expect(
      decodeFails({ keywords: ["a"], submittedFrom: "2024-01-01T10:00:00Z" }),
    ).toBe(true)
  })

  it("sortBy 只接受 arXiv 支持的三个值", () => {
    expect(decodeFails({ keywords: ["a"], sortBy: "nope" })).toBe(true)
  })

  it("非对象直接拒绝", () => {
    expect(decodeFails(null)).toBe(true)
    expect(decodeFails("keywords=a")).toBe(true)
  })
})
