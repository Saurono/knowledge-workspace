import { beforeEach, describe, expect, it, vi } from "vitest"
const state = vi.hoisted(() => ({ files: new Set<string>(), catalog: {} as Record<string, {
  id: string; originalPath: string; receivedAt: string | null; ingestedAt: string | null
}> }))
vi.mock("@/commands/fs", () => ({ fileExists: vi.fn(async (path: string) => state.files.has(path)) }))
vi.mock("@/app/document-records/documents", () => ({ documents: {
  list: vi.fn(async () => state.catalog), registerImportedSource: vi.fn(),
} }))
import { resolveLocalDomainResource } from "./resource-domains"
describe("local document domain resource paths", () => {
  beforeEach(() => {
    state.files = new Set(["/p/raw/sources/a.pdf"])
    state.catalog = { "/p/raw/sources/a.pdf": { id: "source-a", originalPath: "/p/raw/sources/a.pdf", receivedAt: "2026-01-01T00:00:00.000Z", ingestedAt: null } }
  })
  it("resolves a POSIX absolute source path to its stable canonical key", async () => {
    await expect(resolveLocalDomainResource("/p", { kind: "document", path: "/p/raw/sources/a.pdf" }))
      .resolves.toEqual({ canonicalKey: "raw/documents/source-a", legacyKeys: ["raw/sources/a.pdf"] })
  })
  it.each(["/other/raw/sources/a.pdf", "/p/raw/sources/../private/a.pdf", "/P/raw/sources/a.pdf"])(
    "rejects out-of-project, traversal or POSIX case mismatch %s", async (path) => {
      await expect(resolveLocalDomainResource("/p", { kind: "document", path })).rejects.toMatchObject({ code: "invalid_argument" })
    },
  )
})
