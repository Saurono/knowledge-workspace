import { mkdtemp, mkdir, rm, writeFile, access } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { emptyRecords } from "./repository"
import { createGeneratedWikiIngestService, type GeneratedWikiIngestPorts } from "./generated-wiki"

describe("generated Wiki ingestion entrypoint", () => {
  let projectPath = ""
  let records = emptyRecords()
  let activeProject: { id: string; path: string } | null = null
  let nextId = 0
  let enqueue: GeneratedWikiIngestPorts["enqueue"]
  let service: ReturnType<typeof createGeneratedWikiIngestService>
  const filePath = () => join(projectPath, "wiki", "queries", "saved-query.md")

  beforeEach(async () => {
    projectPath = await mkdtemp(join(tmpdir(), "kw-generated-wiki-"))
    await mkdir(join(projectPath, "wiki", "queries"), { recursive: true })
    await writeFile(filePath(), "# Saved query\n\nOriginal generated Wiki content.", "utf8")
    records = emptyRecords(); activeProject = { id: "project-1", path: projectPath }; nextId = 0
    enqueue = vi.fn(async (_projectId, _path, _folder, identity) => `task-${identity.sourceId}`)
    const ports: GeneratedWikiIngestPorts = {
      loadRecords: async () => records,
      saveRecords: async (_path, next) => { records = structuredClone(next) },
      withLock: async (_path, operation) => operation(),
      fileExists: async path => { try { await access(path); return true } catch { return false } },
      resolveProjectPath: async projectId => projectId === "project-1" ? projectPath : null,
      getActiveProject: () => activeProject,
      enqueue: (...args) => enqueue(...args),
      createId: () => `source-${++nextId}`,
      now: () => "2026-11-08T10:00:00.000Z",
    }
    service = createGeneratedWikiIngestService(ports)
  })

  afterEach(async () => { if (projectPath) await rm(projectPath, { recursive: true, force: true }) })

  it("registers the saved Wiki path without copying it to raw and preserves identity and first time on repeat", async () => {
    const first = await service.enqueueSavedQuery({ projectId: "project-1", projectPath, filePath: filePath() })
    const originalBody = await (await import("node:fs/promises")).readFile(filePath(), "utf8")
    const record = records.sources[filePath().replace(/\\/g, "/")]
    expect(record).toMatchObject({ id: first.sourceId, sourceKind: "generated-wiki", receivedAt: "2026-11-08T10:00:00.000Z", originalPath: null })
    expect(originalBody).toContain("Original generated Wiki content")
    expect(records.sources).not.toHaveProperty(join(projectPath, "raw", "sources", "saved-query.md").replace(/\\/g, "/"))
    expect(enqueue).toHaveBeenCalledWith("project-1", filePath().replace(/\\/g, "/"), "", { sourceId: first.sourceId })

    const second = await service.enqueueSavedQuery({ projectId: "project-1", projectPath, filePath: filePath() })
    expect(second.sourceId).toBe(first.sourceId)
    expect(records.sources[filePath().replace(/\\/g, "/")].receivedAt).toBe("2026-11-08T10:00:00.000Z")
    expect(enqueue).toHaveBeenCalledTimes(2)
  })

  it("rejects cross-project and traversal paths before queueing", async () => {
    await expect(service.enqueueSavedQuery({ projectId: "project-2", projectPath, filePath: filePath() })).rejects.toThrow(/no longer active/i)
    await expect(service.enqueueSavedQuery({ projectId: "project-1", projectPath, filePath: join(projectPath, "wiki", "queries", "..", "outside.md") })).rejects.toThrow(/inside project\/wiki\/queries/i)
    expect(enqueue).not.toHaveBeenCalled()
  })

  it("reports queue failure while keeping the saved page and registered source", async () => {
    enqueue = vi.fn(async () => { throw new Error("queue snapshot invalid") })
    await expect(service.enqueueSavedQuery({ projectId: "project-1", projectPath, filePath: filePath() })).rejects.toMatchObject({
      message: expect.stringMatching(/page was saved and its source record was kept/i),
      savedFilePath: filePath().replace(/\\/g, "/"),
    })
    await expect(access(filePath())).resolves.toBeUndefined()
    expect(Object.values(records.sources)[0]).toMatchObject({ sourceKind: "generated-wiki", id: "source-1" })
  })
})
