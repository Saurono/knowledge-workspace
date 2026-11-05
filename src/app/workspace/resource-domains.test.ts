import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  files: new Set<string>(),
  catalog: {} as Record<string, { id: string; originalPath: string; receivedAt: string | null; ingestedAt: string | null }>,
  workspace: { version: 1, domains: [{ id: "research", name: "Research" }], resourceDomains: {} as Record<string, string[]>, memories: [] as unknown[] },
  register: vi.fn(),
}))

vi.mock("@/commands/fs", () => ({ fileExists: async (path: string) => state.files.has(path) }))
vi.mock("@/app/document-records/documents", () => ({ documents: {
  list: async () => state.catalog,
  registerImportedSource: state.register,
} }))
vi.mock("./json-repository", () => ({
  loadWorkspaceData: async () => structuredClone(state.workspace),
  updateWorkspaceData: async (_path: string, change: (data: typeof state.workspace) => typeof state.workspace) => {
    state.workspace = change(structuredClone(state.workspace))
    return structuredClone(state.workspace)
  },
}))

import { resolveLocalDomainResource } from "./resource-domains"
import { executeWorkspaceCommand } from "./services"

beforeEach(() => {
  state.files.clear()
  state.files.add("/p/wiki/page.md")
  state.files.add("/p/raw/sources/source.pdf")
  state.catalog = {}
  state.workspace = { version: 1, domains: [{ id: "research", name: "Research" }], resourceDomains: {}, memories: [] }
  state.register.mockReset().mockImplementation(async (_root: string, path: string, originalPath: string) => {
    state.catalog[path] = { id: "source-123", originalPath, receivedAt: "now", ingestedAt: null }
  })
})

describe("local domain resource adapter", () => {
  it("resolves Wiki paths and never allocates identities during a read", async () => {
    expect(await resolveLocalDomainResource("/p", { kind: "wiki", path: "wiki/page.md" })).toEqual({ canonicalKey: "wiki/page.md", legacyKeys: [] })
    expect(await resolveLocalDomainResource("/p", { kind: "document", path: "raw/sources/source.pdf" })).toBeNull()
    expect(state.register).not.toHaveBeenCalled()
    expect(await resolveLocalDomainResource("/p", { kind: "wiki", path: "wiki/missing.md" })).toBeNull()
  })

  it("explicit assignment registers only an existing source and writes one canonical mapping", async () => {
    await executeWorkspaceCommand("/p", {
      type: "domain.set",
      resource: { kind: "document", path: "raw/sources/source.pdf" },
      domainIds: ["research", "research"],
    })
    expect(state.register).toHaveBeenCalledTimes(1)
    expect(state.workspace.resourceDomains["raw/documents/source-123"]).toEqual(["research"])
    expect(state.workspace.resourceDomains).not.toHaveProperty("raw/sources/source.pdf")
    await expect(executeWorkspaceCommand("/p", {
      type: "domain.set", resource: { kind: "document", path: "raw/sources/missing.pdf" }, domainIds: [],
    })).rejects.toMatchObject({ code: "not_found" })
    expect(state.register).toHaveBeenCalledTimes(1)
  })

  it("rejects traversal and retains old toggle behavior", async () => {
    await expect(resolveLocalDomainResource("/p", { kind: "document", path: "raw/sources/../secret.pdf" })).rejects.toMatchObject({ code: "invalid_argument" })
    await executeWorkspaceCommand("/p", { type: "domain.toggle", resourcePath: "wiki/page.md", domainId: "research" })
    expect(state.workspace.resourceDomains["wiki/page.md"]).toEqual(["research"])
  })
})
