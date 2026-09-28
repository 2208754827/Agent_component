/**
 * Atom XML → 标准化实体。纯函数，不碰网络。
 *
 * 分两步走：
 *   1. 形状提取 —— 按 arXiv Atom 的真实字段把 XML 摊平成普通对象；
 *   2. Schema 校验 —— 用 `FeedPage` 严格过一遍，字段缺失就地失败。
 * 这样接口改版时报的是 FeedDecodeError，而不是让 undefined 流进下游。
 */
import { Effect, ParseResult, pipe, Schema } from "effect"
import { XMLParser } from "fast-xml-parser"
import { FeedDecodeError, FeedParseError } from "./errors.js"
import { FeedPage } from "./paper.js"

/** fast-xml-parser 解析出来的原始对象（形状不可信，逐字段取值）。 */
type Xml = Record<string, unknown>

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  /** 一律不自动转数字，避免 arXiv ID / 标题被「聪明地」改型。 */
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
})

const asRecord = (value: unknown): Xml | undefined =>
  typeof value === "object" && value !== null ? (value as Xml) : undefined

/** fast-xml-parser 只在同名标签重复时才建数组，这里统一成数组。 */
const asList = (value: unknown): readonly unknown[] => {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value : [value]
}

const asText = (value: unknown): string | undefined => {
  if (typeof value === "string") return value
  const text = asRecord(value)?.["#text"]
  return typeof text === "string" ? text : undefined
}

/** 摘要/标题里的换行与连续空白压成单空格。 */
const asCleanText = (value: unknown): string | undefined =>
  asText(value)?.replace(/\s+/gu, " ").trim()

const asAttr = (node: Xml | undefined, name: string): string | undefined => {
  const value = node?.[`@_${name}`]
  return typeof value === "string" ? value : undefined
}

const asInt = (value: unknown): number => {
  const parsed = Number.parseInt(asText(value) ?? "", 10)
  return Number.isFinite(parsed) ? parsed : 0
}

const isDefined = <A>(value: A | undefined): value is A => value !== undefined

interface AtomLink {
  readonly rel: string | undefined
  readonly type: string | undefined
  readonly href: string | undefined
}

const toLinks = (entry: Xml): readonly AtomLink[] =>
  asList(entry["link"])
    .map((raw) => asRecord(raw) ?? {})
    .map((link) => ({
      rel: asAttr(link, "rel"),
      type: asAttr(link, "type"),
      href: asAttr(link, "href"),
    }))

const hrefOf = (
  links: readonly AtomLink[],
  match: (link: AtomLink) => boolean,
): string | undefined => links.find(match)?.href

/** `http://arxiv.org/abs/2409.00001v2` → `2409.00001v2`。 */
const lastSegment = (raw: string): string => raw.slice(raw.lastIndexOf("/") + 1)

/** `2409.00001v2` → { arxivId: `2409.00001`, version: `2` }。 */
const splitVersion = (
  raw: string,
): { arxivId: string; version: string | undefined } => {
  const matched = /^(?<id>.+)v(?<version>\d+)$/u.exec(lastSegment(raw))
  const id = matched?.groups?.["id"]
  const version = matched?.groups?.["version"]
  return id === undefined ? { arxivId: raw, version: undefined } : { arxivId: id, version }
}

const toAuthor = (raw: unknown): unknown => {
  const author = asRecord(raw) ?? {}
  return {
    name: asCleanText(author["name"]),
    affiliation: asCleanText(author["arxiv:affiliation"]),
  }
}

/** 单条 `<entry>` → 待校验的普通对象。 */
const toPaper = (raw: unknown): unknown => {
  const entry = asRecord(raw) ?? {}
  const idUrl = asText(entry["id"])
  const { arxivId, version } = splitVersion(idUrl ?? "")
  const links = toLinks(entry)
  const primaryCategory = asRecord(entry["arxiv:primary_category"])

  return {
    arxivId,
    version,
    title: asCleanText(entry["title"]),
    abstract: asCleanText(entry["summary"]),
    authors: asList(entry["author"]).map(toAuthor),
    primaryCategory: asAttr(primaryCategory, "term"),
    categories: asList(entry["category"])
      .map((category) => asAttr(asRecord(category), "term"))
      .filter(isDefined),
    published: asText(entry["published"]),
    updated: asText(entry["updated"]),
    comment: asCleanText(entry["arxiv:comment"]),
    journalRef: asCleanText(entry["arxiv:journal_ref"]),
    doi: asText(entry["arxiv:doi"]),
    absUrl: hrefOf(links, (link) => link.rel === "alternate") ?? idUrl,
    pdfUrl: hrefOf(links, (link) => link.type === "application/pdf"),
  }
}

/** `<feed>` → 待校验的结果页对象。 */
const toFeedPageValue = (feed: Xml): unknown => ({
  totalResults: asInt(feed["opensearch:totalResults"]),
  startIndex: asInt(feed["opensearch:startIndex"]),
  itemsPerPage: asInt(feed["opensearch:itemsPerPage"]),
  papers: asList(feed["entry"]).map(toPaper),
})

/** XML 字符串 → `<feed>` 节点。解析失败或压根不是 Atom 都报 FeedParseError。 */
const parseXml = (xml: string): Effect.Effect<Xml, FeedParseError> =>
  pipe(
    Effect.try({
      try: () => parser.parse(xml) as unknown,
      catch: (cause) => new FeedParseError({ detail: String(cause) }),
    }),
    Effect.flatMap((parsed) => {
      const feed = asRecord(asRecord(parsed)?.["feed"])
      return feed === undefined
        ? Effect.fail(
            new FeedParseError({
              detail: "响应中没有 <feed> 根节点，可能不是 Atom 格式",
            }),
          )
        : Effect.succeed(feed)
    }),
  )

const decodeFeedPage = (
  value: unknown,
): Effect.Effect<FeedPage, FeedDecodeError> =>
  pipe(
    Schema.decodeUnknown(FeedPage)(value),
    Effect.mapError(
      (error) =>
        new FeedDecodeError({
          detail: ParseResult.TreeFormatter.formatErrorSync(error),
        }),
    ),
  )

/** 组件对外的解析入口。 */
export const parseFeed = (
  xml: string,
): Effect.Effect<FeedPage, FeedParseError | FeedDecodeError> =>
  pipe(
    parseXml(xml),
    Effect.map(toFeedPageValue),
    Effect.flatMap(decodeFeedPage),
  )
