import { describe, expect, it } from "vitest"
import { appendDomainFilterQuery, domainFilterFromInput, domainFilterFromQuery } from "./domain-query"

describe("shared domain filter query contract", () => {
  it("parses repeated query IDs and round-trips through the typed SDK builder", () => {
    const filter = domainFilterFromQuery(new URLSearchParams("domainId=b&domainId=a&domainId=b&domainMatch=all&unclassified=0"))
    expect(filter).toEqual({ domainIds: ["b", "a", "b"], match: "all", unclassified: false })
    const query = appendDomainFilterQuery("?limit=20&cursor=abc", filter)
    const params = new URLSearchParams(query.slice(1))
    expect(domainFilterFromQuery(params)).toEqual({ domainIds: ["a", "b"], match: "all", unclassified: false })
    expect(params.get("limit")).toBe("20")
    expect(params.get("cursor")).toBe("abc")
    expect(appendDomainFilterQuery("?limit=2")).toBe("?limit=2")
  })

  it("rejects malformed flags, empty IDs, repeated singleton fields, and mixed unclassified queries", () => {
    for (const query of ["domainId=", "domainMatch=any&domainMatch=all", "domainMatch=some", "unclassified=1&unclassified=0", "unclassified=true", "domainId=a&unclassified=1"])
      expect(() => domainFilterFromQuery(new URLSearchParams(query))).toThrow()
    expect(() => domainFilterFromInput({ domainIds: ["a"], match: "all", unclassified: true })).toThrow()
    expect(domainFilterFromInput(undefined)).toBeUndefined()
  })
})
