import { describe, expect, it, vi } from "vitest"
import { createRemoteWorkspace } from "./remote-workspace"
import type { SharedWorkspace } from "@/modules/service-api/application"
import type { ResourceRecord } from "@/modules/service-api/domain"

const record = (data: SharedWorkspace, revision: number): ResourceRecord<SharedWorkspace> => ({
  projectId: "project", kind: "workspace", key: "workspace", data, revision,
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
})
const initial: SharedWorkspace = { version: 1, domains: [{ id: "research", name: "Research" }], resourceDomains: {}, memories: [] }

describe("remote workspace domain writes", () => {
  it("commits canonical resource assignment in one conditional workspace write", async () => {
    const saved = record({ ...initial, resourceDomains: { "raw/documents/source-1": ["research"] } }, 2)
    const api = {
      workspace: vi.fn(async () => ({ data: record(initial, 1) })),
      saveWorkspace: vi.fn(async (_id: string, data: SharedWorkspace) => ({ data: record(data, 2) })),
    }
    const remote = createRemoteWorkspace(api as never, "project")
    await remote.load()
    await remote.setResourceDomains("raw/documents/source-1", ["research"])
    expect(api.saveWorkspace).toHaveBeenCalledTimes(1)
    expect(api.saveWorkspace).toHaveBeenCalledWith("project", saved.data, 1)
    expect(remote.snapshot().data.resourceDomains).toEqual(saved.data.resourceDomains)
  })

  it("leaves the loaded snapshot unchanged after a CAS conflict", async () => {
    const api = {
      workspace: vi.fn(async () => ({ data: record(initial, 1) })),
      saveWorkspace: vi.fn(async () => { throw new Error("conflict") }),
    }
    const remote = createRemoteWorkspace(api as never, "project")
    await remote.load()
    await expect(remote.setResourceDomains("wiki/page.md", ["research"])).rejects.toThrow("conflict")
    expect(remote.snapshot().revision).toBe(1)
    expect(remote.snapshot().data.resourceDomains).toEqual({})
  })
})
