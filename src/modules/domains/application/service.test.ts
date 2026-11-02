import { describe, expect, it } from "vitest"
import { createDomainService, type DomainRepository } from "./service"
import { removeDomainTag, type DomainState } from "../domain/model"

describe("domain assignment service", () => {
  it("sets canonical assignments in one update and preserves unrelated and legacy records", async () => {
    let state: DomainState & { extension?: string } = {
      domains: [{ id: "a", name: "A" }, { id: "b", name: "B" }],
      resourceDomains: {
        "raw/sources/original.pdf": ["a"],
        "wiki/other.md": ["b", "deleted-domain"],
      },
      extension: "keep",
    }
    const originalState = state
    const originalSnapshot = structuredClone(state)
    let updates = 0
    const repository: DomainRepository = {
      read: async () => state,
      update: async (_path, change) => {
        updates++
        state = change(state) as typeof state
        return state
      },
    }
    const service = createDomainService(repository)
    const emptyAssignment: string[] = []
    await service.setResourceDomains("project", "raw/documents/source-id", emptyAssignment, ["raw/sources/original.pdf"])
    expect(updates).toBe(1)
    expect(emptyAssignment).toEqual([])
    expect(originalState).toEqual(originalSnapshot)
    expect(state.resourceDomains["raw/documents/source-id"]).toEqual([])
    expect(state.resourceDomains["raw/sources/original.pdf"]).toEqual(["a"])
    expect(state.resourceDomains["wiki/other.md"]).toEqual(["b", "deleted-domain"])
    expect(state.extension).toBe("keep")
    await service.setResourceDomains("project", "raw/documents/source-id", ["a", "a"])
    expect(updates).toBe(2)
    expect(state.resourceDomains["raw/documents/source-id"]).toEqual(["a"])
    const beforeRejectedWrite = structuredClone(state)
    await expect(service.setResourceDomains("project", "wiki/other.md", ["unknown"])).rejects.toMatchObject({ code: "invalid_argument" })
    expect(state).toEqual(beforeRejectedWrite)
    await expect(service.setResourceDomains("project", undefined as unknown as string, [])).rejects.toMatchObject({ code: "invalid_argument" })
    expect(state).toEqual(beforeRejectedWrite)
    expect(updates).toBe(4)
  })

  it("removes a domain from live assignments while leaving unknown legacy IDs irrelevant", () => {
    const original: DomainState = {
      domains: [{ id: "a", name: "A" }],
      resourceDomains: { "wiki/a.md": ["a", "stale"] },
    }
    const cleaned = removeDomainTag(original, "a")
    expect(cleaned.domains).toEqual([])
    expect(cleaned.resourceDomains["wiki/a.md"]).toEqual(["stale"])
  })
})
