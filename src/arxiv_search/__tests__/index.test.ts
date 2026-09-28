/** 组件出口契约：一个组件只能有一个导出函数。 */
import { describe, expect, it } from "vitest"
import * as component from "../index.js"

describe("组件出口契约", () => {
  it("运行时只暴露一个导出", () => {
    expect(Object.keys(component)).toEqual(["arxivSearch"])
  })

  it("这个导出是函数", () => {
    expect(typeof component.arxivSearch).toBe("function")
  })
})
