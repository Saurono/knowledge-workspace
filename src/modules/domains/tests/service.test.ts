import { describe, expect, it } from "vitest"
import { createDomainService, type DomainRepository, type DomainState } from "../application"
function repo(): DomainRepository {
  let data: DomainState = { domains: [], resourceDomains: {} }
  return {
    read: async () => structuredClone(data),
    update: async (_path, change) => {
      data = change(structuredClone(data))
      return structuredClone(data)
    },
  }
}
describe("domain service", () => {
  it("rejects duplicate names and toggles multiple assignments independently", async () => {
    const service = createDomainService(repo())
    await service.add("/p", { id: "a", name: " Research " })
    await service.add("/p", { id: "b", name: "Writing" })
    await expect(service.add("/p", { id: "c", name: "research" })).rejects.toThrow("already exists")
    await service.toggle("/p", "wiki/a.md", "a")
    await service.toggle("/p", "wiki/a.md", "b")
    await service.toggle("/p", "wiki/a.md", "a")
    expect((await service.list("/p")).resourceDomains["wiki/a.md"]).toEqual(["b"])
  })
  it("handles resource names that coincide with prototype properties", async () => {
    const service = createDomainService(repo())
    await service.add("/p", { id: "a", name: "A" })
    await service.toggle("/p", "constructor", "a")
    expect((await service.list("/p")).resourceDomains.constructor).toEqual(["a"])
  })
})
