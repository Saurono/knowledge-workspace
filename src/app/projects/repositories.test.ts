import { beforeEach, describe, expect, it, vi } from "vitest"
const state = vi.hoisted(() => ({
  files: new Map<string, string>(),
  store: new Map<string, unknown>(),
  write: vi.fn(),
  set: vi.fn(),
}))
vi.mock("@/commands/fs", () => ({
  readFile: async (path: string) => {
    if (!state.files.has(path)) throw new Error("ENOENT")
    return state.files.get(path)
  },
  writeFileAtomic: state.write,
}))
vi.mock("@tauri-apps/plugin-store", () => ({
  load: async () => ({
    get: async (key: string) => structuredClone(state.store.get(key)),
    set: state.set,
    delete: async (key: string) => {
      state.store.delete(key)
    },
  }),
}))
import {
  localProjectIdentities,
  localProjectRegistry,
  localProjectPreferences,
} from "./repositories"
import { createProjectService } from "@/modules/projects/application"
let created = 0
const service = createProjectService({
  identities: localProjectIdentities,
  registry: localProjectRegistry,
  preferences: localProjectPreferences,
  normalizePath: (path) => path.replace(/\\/g, "/"),
  now: () => 1234,
  createId: () => `identity-${++created}`,
})
beforeEach(() => {
  state.files.clear()
  state.store.clear()
  vi.resetAllMocks()
  created = 0
  state.write.mockImplementation(async (path: string, content: string) => {
    state.files.set(path, content)
  })
  state.set.mockImplementation(async (key: string, value: unknown) => {
    state.store.set(key, structuredClone(value))
  })
})
describe("local project repository contracts", () => {
  it("serializes concurrent identity creation and persists exactly one ID", async () => {
    const [a, b] = await Promise.all([service.ensureProjectId("/p"), service.ensureProjectId("/p")])
    expect(a).toBe(b)
    expect(created).toBe(1)
    expect(state.write).toHaveBeenCalledTimes(1)
    expect(JSON.parse(state.files.get("/p/.llm-wiki/project.json")!)).toEqual({
      id: a,
      createdAt: 1234,
    })
  })
  it("does not return an ephemeral new ID when persistence fails, and can retry", async () => {
    state.write.mockRejectedValueOnce(new Error("read-only"))
    await expect(service.ensureProjectId("/p")).rejects.toThrow("read-only")
    expect(await service.ensureProjectId("/p")).toBe("identity-2")
    expect(await service.ensureProjectId("/p")).toBe("identity-2")
  })
  it("preserves identity after a folder move and resolves the latest path", async () => {
    const id = await service.ensureProjectId("/old")
    await service.upsertProjectInfo(id, "/old", "Project")
    state.files.set("/new/.llm-wiki/project.json", state.files.get("/old/.llm-wiki/project.json")!)
    expect(await service.ensureProjectId("/new")).toBe(id)
    await service.upsertProjectInfo(id, "/new", "Renamed")
    expect(await service.getProjectPathById(id)).toBe("/new")
    expect(await service.getProjectIdByPath("/old")).toBeNull()
    expect(created).toBe(1)
  })
  it("does not lose concurrent registry entries", async () => {
    await Promise.all([
      service.upsertProjectInfo("a", "/a", "A"),
      service.upsertProjectInfo("b", "/b", "B"),
    ])
    expect(Object.keys(await service.loadRegistry()).sort()).toEqual(["a", "b"])
    expect(await service.getProjectPathById("constructor")).toBeNull()
  })
  it("recovers the registry write chain after a failed update", async () => {
    state.set.mockRejectedValueOnce(new Error("offline"))
    await expect(service.upsertProjectInfo("a", "/a", "A")).rejects.toThrow("offline")
    await service.upsertProjectInfo("b", "/b", "B")
    expect(await service.getProjectPathById("b")).toBe("/b")
  })
  it("keeps recent/last project consistent across switches and removal", async () => {
    await Promise.all([
      service.saveLastProject({ id: "a", name: "A", path: "/a" }),
      service.saveLastProject({ id: "b", name: "B", path: "/b" }),
    ])
    expect((await service.getLastProject())?.id).toBe("b")
    expect((await service.getRecentProjects()).map((p) => p.id)).toEqual(["b", "a"])
    await service.removeFromRecentProjects("/b")
    expect(await service.getLastProject()).toBeNull()
    expect((await service.getRecentProjects()).map((p) => p.id)).toEqual(["a"])
  })
  it("normalizes Windows path aliases and caps recent projects", async () => {
    await service.addToRecentProjects({ id: "p", name: "P", path: "C:\\p" })
    await service.addToRecentProjects({ id: "p", name: "Renamed", path: "C:/p" })
    expect(await service.getRecentProjects()).toEqual([{ id: "p", name: "Renamed", path: "C:/p" }])
    for (let i = 0; i < 12; i++)
      await service.addToRecentProjects({ id: `p${i}`, name: "P", path: `/p${i}` })
    expect(await service.getRecentProjects()).toHaveLength(10)
  })
})
