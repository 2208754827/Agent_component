/**
 * 入口。
 *
 * 约定：纯函数写在各自的组件文件里（一个组件 = 一个导出函数），
 * 副作用（网络请求、读写文件、console 输出）只允许出现在入口这一层。
 * 组件返回的是 Effect 描述，真正跑起来的动作在这里。
 */
import { Cause, Effect, Exit, pipe } from "effect"
import { FetchHttpClient } from "@effect/platform"
import { arxivSearch } from "./arxiv_search/index.js"

/** 阶段一先用写死的需求验证检索链路。 */
const request = {
  keywords: ["diffusion policy", "robot manipulation"],
  categories: ["cs.RO"],
  submittedFrom: "2024-01-01",
  maxResults: 5,
  sortBy: "submittedDate",
}

const program = pipe(
  Effect.gen(function* () {
    // 整个应用只创建一次会话，后续 Agent 任务共享这个 search。
    const search = yield* arxivSearch()
    return yield* search(request)
  }),
  Effect.provide(FetchHttpClient.layer),
)

const exit = await Effect.runPromiseExit(program)

if (Exit.isFailure(exit)) {
  console.error(Cause.pretty(exit.cause))
  process.exitCode = 1
} else {
  const { papers, totalResults } = exit.value
  console.log(`命中 ${totalResults} 条，本次取回 ${papers.length} 条`)
  for (const paper of papers) {
    const authors = paper.authors.map((author) => author.name).join(", ")
    console.log(`- ${paper.arxivId} v${paper.version ?? "?"}  ${paper.title}`)
    console.log(`  作者: ${authors}`)
    console.log(`  链接: ${paper.absUrl}`)
  }
}
