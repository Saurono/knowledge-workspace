import { describe, expect, it } from "vitest"
import { canonicalDomainResourceKey, effectiveDomainIds, filterMatches } from "./classification"
import type { DomainState } from "./model"

const state: DomainState = {
  domains: [{ id: "a", name: "A" }, { id: "b", name: "B" }],
  resourceDomains: {
    "wiki/page.md": ["a", "removed"],
    "raw/sources/old.pdf": ["b"],
    "raw/sources/also-old.pdf": ["a", "b"],
    "wiki/empty.md": [],
    "wiki/invalid.md": ["removed"],
  },
}

describe("domain classification rules", () => {
  it("normalizes resource keys and rejects traversal or absolute paths", () => {
    expect(canonicalDomainResourceKey("wiki", "wiki/guides/page.md")).toBe("wiki/guides/page.md")
    // Percent escapes are literal path characters here; the domain layer never decodes them.
    expect(canonicalDomainResourceKey("wiki", "wiki/%2e%2e/topic.md")).toBe("wiki/%2e%2e/topic.md")
    expect(canonicalDomainResourceKey("document", "source-123")).toBe("raw/documents/source-123")
    for (const key of ["../wiki/a.md", "wiki/../secret.md", "/wiki/a.md", "C:\\wiki\\a.md", "wiki/a\0.md", "wiki/a\n.md", "wiki/a\u007f.md"])
      expect(() => canonicalDomainResourceKey("wiki", key)).toThrow()
    for (const id of ["", "../x", "a/b", "a\\b", "a\0b", "source:id", "source?id", "source\"id", "a".repeat(129)])
      expect(() => canonicalDomainResourceKey("document", id)).toThrow()
  })

  it("uses canonical own property first, including an explicit empty assignment", () => {
    expect(effectiveDomainIds(state, "wiki/page.md")).toEqual(["a"])
    expect(effectiveDomainIds(state, "wiki/new.md", ["raw/sources/old.pdf"])).toEqual(["b"])
    expect(effectiveDomainIds(state, "wiki/empty.md", ["raw/sources/old.pdf"])).toEqual([])
    expect(effectiveDomainIds(state, "wiki/invalid.md")).toEqual([])
  })

  it("supports ANY, ALL, unrestricted, and unclassified filters", () => {
    expect(filterMatches(state, "wiki/page.md", { domainIds: ["a", "b"], match: "any", unclassified: false })).toBe(true)
    expect(filterMatches(state, "wiki/legacy.md", { domainIds: ["a", "b"], match: "all", unclassified: false }, ["raw/sources/also-old.pdf"])).toBe(true)
    expect(filterMatches(state, "wiki/legacy.md", { domainIds: ["b", "a", "a"], match: "all", unclassified: false }, ["raw/sources/also-old.pdf"])).toBe(true)
    expect(filterMatches(state, "wiki/page.md", { domainIds: ["b"], match: "all", unclassified: false })).toBe(false)
    expect(filterMatches(state, "wiki/invalid.md", { domainIds: [], match: "any", unclassified: true })).toBe(true)
    expect(filterMatches(state, "wiki/empty.md", { domainIds: [], match: "any", unclassified: true })).toBe(true)
    expect(filterMatches(state, "wiki/page.md", { domainIds: [], match: "any", unclassified: false })).toBe(true)
  })

  it("rejects unknown domain queries and mixing unclassified with domain IDs", () => {
    expect(() => filterMatches(state, "wiki/page.md", { domainIds: ["missing"], match: "any", unclassified: false })).toThrow(/Unknown domain/)
    expect(() => filterMatches(state, "wiki/page.md", { domainIds: ["a"], match: "all", unclassified: true })).toThrow(/cannot be combined/)
  })
})
