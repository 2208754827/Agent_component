/** XML -> 实体的纯解析单测（用夹具，不联网）。 */
import { describe, expect, it } from "vitest"
import { Effect } from "effect"
import { parseFeed } from "../feed.js"
import type { Paper } from "../paper.js"
import {
  emptyFeed,
  missingTitleFeed,
  notAtomDocument,
  twoPaperFeed,
} from "./fixtures.js"

const parse = (xml: string) => Effect.runPromise(parseFeed(xml))

/** 取失败通道里的错误对象。 */
const parseFailure = (xml: string) =>
  Effect.runPromise(Effect.flip(parseFeed(xml)))

/** 取数组第一项，顺手把 noUncheckedIndexedAccess 挡掉。 */
const first = <A>(items: readonly A[]): A => {
  const [head] = items
  if (head === undefined) throw new Error("期望至少有一条数据")
  return head
}

describe("parseFeed / 结果页", () => {
  it("读回翻页元信息与条目数", async () => {
    const page = await parse(twoPaperFeed)
    expect(page.totalResults).toBe(1187)
    expect(page.startIndex).toBe(0)
    expect(page.itemsPerPage).toBe(2)
    expect(page.papers).toHaveLength(2)
  })

  it("零结果也是正常响应", async () => {
    const page = await parse(emptyFeed)
    expect(page.totalResults).toBe(0)
    expect(page.papers).toEqual([])
  })
})

describe("parseFeed / 单条论文字段", () => {
  it("arxivId 去掉 URL 前缀并拆出版本号", async () => {
    const paper: Paper = first((await parse(twoPaperFeed)).papers)
    expect(paper.arxivId).toBe("2409.00001")
    expect(paper.version).toBe("2")
  })

  it("标题与摘要里的换行、连续空白压成单空格", async () => {
    const paper = first((await parse(twoPaperFeed)).papers)
    expect(paper.title).toBe("Diffusion Policy for Robot Manipulation")
    expect(paper.abstract).toBe("We propose a method. It runs on CPU only.")
  })

  it("作者按顺序取回，affiliation 缺省就是 undefined", async () => {
    const paper = first((await parse(twoPaperFeed)).papers)
    expect(paper.authors).toEqual([
      { name: "Alice Zhang", affiliation: "Tsinghua University" },
      { name: "Bob Li", affiliation: undefined },
    ])
  })

  it("分类、主分类与 arxiv: 前缀字段都取到", async () => {
    const paper = first((await parse(twoPaperFeed)).papers)
    expect(paper.categories).toEqual(["cs.RO", "cs.LG"])
    expect(paper.primaryCategory).toBe("cs.RO")
    expect(paper.comment).toBe("Accepted at CoRL 2024")
    expect(paper.journalRef).toBe("NeurIPS 2024")
    expect(paper.doi).toBe("10.1000/xyz")
  })

  it("abs 链接取 alternate，pdf 链接取 application/pdf", async () => {
    const paper = first((await parse(twoPaperFeed)).papers)
    expect(paper.absUrl).toBe("http://arxiv.org/abs/2409.00001v2")
    expect(paper.pdfUrl).toBe("http://arxiv.org/pdf/2409.00001v2")
  })

  it("published / updated 原样保留 arXiv 的 ISO 串", async () => {
    const paper = first((await parse(twoPaperFeed)).papers)
    expect(paper.published).toBe("2024-09-01T10:00:00Z")
    expect(paper.updated).toBe("2024-09-03T01:02:03Z")
  })

  it("单作者也建数组；没有 pdf link 时 pdfUrl 为 undefined", async () => {
    const paper = first((await parse(twoPaperFeed)).papers.slice(1))
    expect(paper.authors).toHaveLength(1)
    expect(paper.pdfUrl).toBeUndefined()
  })
})

describe("parseFeed / 失败路径", () => {
  it("响应不是 Atom（没有 feed 根节点）-> FeedParseError", async () => {
    const error = await parseFailure(notAtomDocument)
    expect(error._tag).toBe("FeedParseError")
  })

  it("XML 结构对不上（entry 缺 title）-> FeedDecodeError", async () => {
    const error = await parseFailure(missingTitleFeed)
    expect(error._tag).toBe("FeedDecodeError")
  })
})
