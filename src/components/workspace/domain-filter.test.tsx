import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { DomainFilter } from "./domain-filter"

describe("DomainFilter", () => {
  it("renders controlled domain, unclassified, match, and clear controls accessibly", () => {
    const onChange = vi.fn()
    const html = renderToStaticMarkup(createElement(DomainFilter, {
      domains: [{ id: "research", name: "研究" }, { id: "finance", name: "财务" }],
      value: { domainIds: ["research"], match: "all", unclassified: false },
      onChange,
    }))

    expect(html).toContain("按领域筛选")
    expect(html).toContain('aria-label="领域匹配方式"')
    expect(html).toContain("未分类")
    expect(html).toContain("任一领域")
    expect(html).toContain("全部领域")
    expect(html).toContain("清除筛选")
    expect(html).toMatch(/type="checkbox" checked=""[^>]*\/>研究/)
    expect(html).toMatch(/value="all" selected=""/)
    expect(onChange).not.toHaveBeenCalled()
  })

  it("keeps clear available when there are no domains", () => {
    const html = renderToStaticMarkup(createElement(DomainFilter, {
      domains: [],
      value: { domainIds: [], match: "any", unclassified: true },
      onChange: vi.fn(),
    }))
    expect(html).toContain("未分类")
    expect(html).not.toContain("disabled")
  })
})
