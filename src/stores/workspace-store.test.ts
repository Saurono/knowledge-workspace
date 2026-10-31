import { beforeEach, describe, expect, it, vi } from "vitest"
const adapter = vi.hoisted(() => ({ load: vi.fn(), execute: vi.fn(), update: vi.fn() }))
vi.mock("@/app/workspace", () => ({
  emptyWorkspaceData: () => ({ version: 1, domains: [], resourceDomains: {}, memories: [] }),
  loadWorkspaceData: adapter.load,
  executeWorkspaceCommand: adapter.execute,
  updateWorkspaceData: adapter.update,
}))
import { useWorkspaceStore } from "./workspace-store"
const snapshot = (name: string) => ({
  version: 1,
  domains: [{ id: name, name }],
  resourceDomains: {},
  memories: [],
})
beforeEach(() => {
  vi.resetAllMocks()
  useWorkspaceStore.getState().reset()
  adapter.load.mockResolvedValue(snapshot("current"))
})
describe("workspace module projection", () => {
  it("does not apply an old save after switching away and back to the same project", async () => {
    await useWorkspaceStore.getState().load("/one")
    let finish!: (value: unknown) => void
    adapter.execute.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const pending = useWorkspaceStore.getState().perform("/one", { type: "memory.remove", id: "m" })
    await useWorkspaceStore.getState().load("/two")
    await useWorkspaceStore.getState().load("/one")
    finish(snapshot("stale"))
    expect(await pending).toBe(false)
    expect(useWorkspaceStore.getState().data.domains[0].name).toBe("current")
    expect(useWorkspaceStore.getState().saving).toBe(false)
  })
  it("rejects duplicate saves while a module command is pending", async () => {
    await useWorkspaceStore.getState().load("/one")
    let finish!: (value: unknown) => void
    adapter.execute.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const command = { type: "memory.remove" as const, id: "m" }
    const pending = useWorkspaceStore.getState().perform("/one", command)
    expect(await useWorkspaceStore.getState().perform("/one", command)).toBe(false)
    expect(adapter.execute).toHaveBeenCalledTimes(1)
    finish(snapshot("saved"))
    expect(await pending).toBe(true)
  })
  it("keeps the current data when persistence fails and allows retry after reload", async () => {
    await useWorkspaceStore.getState().load("/one")
    adapter.execute.mockRejectedValue(new Error("disk full"))
    expect(
      await useWorkspaceStore.getState().perform("/one", { type: "memory.remove", id: "m" }),
    ).toBe(false)
    expect(useWorkspaceStore.getState().data.domains[0].name).toBe("current")
    expect(useWorkspaceStore.getState().error).toContain("disk full")
    await useWorkspaceStore.getState().load("/one")
    expect(useWorkspaceStore.getState().error).toBeNull()
  })
})
