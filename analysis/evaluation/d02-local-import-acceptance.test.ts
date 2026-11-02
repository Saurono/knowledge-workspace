import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  files: new Map<string, string>(),
  directories: new Set<string>(),
  failCopies: new Set<string>(),
  failCatalogWrite: false,
  copies: [] as Array<{ source: string; destination: string }>,
  wikiWrites: [] as string[],
}))
const commands = vi.hoisted(() => ({
  copyFile: vi.fn(), createDirectory: vi.fn(), deleteFile: vi.fn(), fileExists: vi.fn(),
  getFileSize: vi.fn(), listDirectory: vi.fn(), readFile: vi.fn(), writeFile: vi.fn(), writeFileAtomic: vi.fn(),
  preprocessSourceFiles: vi.fn(), enqueueBatch: vi.fn(), addActivity: vi.fn(),
}))

vi.mock("@/commands/fs", async () => {
  const actual = await vi.importActual<typeof import("@/commands/fs")>("@/commands/fs")
  return { ...actual, ...commands }
})
vi.mock("@/lib/ingest-queue", () => ({ enqueueBatch: commands.enqueueBatch }))
vi.mock("@/lib/source-preprocess", () => ({ preprocessSourceFiles: commands.preprocessSourceFiles }))
vi.mock("@/lib/ingest-cache", () => ({ moveIngestCacheEntry: vi.fn(async () => undefined), removeFromIngestCache: vi.fn(async () => undefined) }))
vi.mock("@/lib/parsed-source-output", () => ({ moveParsedMarkdown: vi.fn(async () => undefined), removeParsedMarkdown: vi.fn(async () => undefined) }))
vi.mock("@/lib/embedding", () => ({ removePageEmbedding: vi.fn(async () => undefined), wikiPageIdFromPath: vi.fn((path: string) => path) }))
vi.mock("@/stores/activity-store", () => ({ useActivityStore: { getState: () => ({ addItem: commands.addActivity }) } }))

import { documents, loadIngestRecords, recordSuccessfulIngest, registerImportedSource } from "@/lib/ingest-receipts"
import { importSourceFiles, importSourceFolder, migrateSourcePath } from "@/lib/source-lifecycle"
import { parseSources } from "@/lib/sources-merge"
import { sourceSummarySlugFromIdentity } from "@/modules/documents/domain"
import type { FileNode, WikiProject } from "@/types/wiki"
import type { LlmConfig, SourceWatchConfig } from "@/stores/wiki-store"

const project: WikiProject = { id: "d02-local-project", name: "D02 local fixture", path: "/test/project" }
const llm: LlmConfig = { provider: "openai", apiKey: "synthetic", model: "fixture", ollamaUrl: "", customEndpoint: "", maxContextSize: 128_000 }
const watch: SourceWatchConfig = { enabled: true, autoIngest: true, persistExtractedMarkdown: false, parsingConcurrency: 1, ingestConcurrency: 1, includeExtensions: ["md"], excludeExtensions: [], excludeDirs: [], excludeGlobs: [], maxFileSizeMb: 100 }
const norm = (path: string) => path.replace(/\\/g, "/").replace(/\/$/, "")

function seed(path: string, content: string) {
  const target = norm(path)
  state.files.set(target, content)
  let parent = target.slice(0, target.lastIndexOf("/"))
  while (parent) {
    state.directories.add(parent)
    const next = parent.slice(0, parent.lastIndexOf("/"))
    if (next === parent) break
    parent = next
  }
}

function tree(path: string): FileNode[] {
  const root = norm(path), names = new Set<string>()
  for (const file of state.files.keys()) if (file.startsWith(`${root}/`)) names.add(file.slice(root.length + 1).split("/")[0])
  for (const dir of state.directories) if (dir.startsWith(`${root}/`)) names.add(dir.slice(root.length + 1).split("/")[0])
  return [...names].sort().map(name => {
    const child = `${root}/${name}`
    const is_dir = state.directories.has(child)
    return { name, path: child, is_dir, ...(is_dir ? { children: tree(child) } : {}) } as FileNode
  })
}

beforeEach(() => {
  state.files.clear(); state.directories.clear(); state.failCopies.clear(); state.failCatalogWrite = false
  state.copies.length = 0; state.wikiWrites.length = 0
  vi.clearAllMocks()
  commands.copyFile.mockImplementation(async (source: string, destination: string) => {
    state.copies.push({ source: norm(source), destination: norm(destination) })
    const normalizedSource = norm(source), normalizedDestination = norm(destination)
    if (state.failCopies.has(normalizedSource)) { state.failCopies.delete(normalizedSource); throw new Error("synthetic copy failure") }
    if (!state.files.has(normalizedSource)) throw new Error(`missing source ${normalizedSource}`)
    seed(normalizedDestination, state.files.get(normalizedSource)!)
  })
  commands.createDirectory.mockImplementation(async (path: string) => { state.directories.add(norm(path)) })
  commands.deleteFile.mockImplementation(async (path: string) => { state.files.delete(norm(path)) })
  commands.fileExists.mockImplementation(async (path: string) => state.files.has(norm(path)) || state.directories.has(norm(path)))
  commands.getFileSize.mockImplementation(async (path: string) => {
    const value = state.files.get(norm(path)); if (value === undefined) throw new Error("ENOENT"); return new TextEncoder().encode(value).length
  })
  commands.listDirectory.mockImplementation(async (path: string) => {
    const normalized = norm(path); if (!state.directories.has(normalized)) throw new Error(`ENOENT: ${normalized}`); return tree(normalized)
  })
  commands.readFile.mockImplementation(async (path: string) => {
    const value = state.files.get(norm(path)); if (value === undefined) throw new Error(`ENOENT: ${path}`); return value
  })
  commands.writeFile.mockImplementation(async (path: string, contents: string) => {
    const normalized = norm(path); state.wikiWrites.push(normalized); seed(normalized, contents)
  })
  commands.writeFileAtomic.mockImplementation(async (path: string, contents: string) => {
    const normalized = norm(path)
    if (state.failCatalogWrite && normalized.endsWith("/.llm-wiki/ingest-records.json")) throw new Error("synthetic catalog write failure")
    seed(normalized, contents)
  })
  commands.preprocessSourceFiles.mockResolvedValue(undefined)
  commands.enqueueBatch.mockResolvedValue(["synthetic-task"])
  commands.addActivity.mockImplementation(() => undefined)
})

afterEach(() => vi.clearAllMocks())

describe("D02 real source catalog and local import orchestration", () => {
  it("serializes repeated and concurrent imports of one origin into one stable local source", async () => {
    seed("/external/manual/report.md", "same source payload")
    const run = () => importSourceFiles(project, ["/external/manual/report.md"], llm, watch)
    const results = await Promise.all([run(), run(), run()])
    const paths = results.flatMap(result => result.imported)
    const catalog = await documents.list(project.path)
    expect(paths).toHaveLength(3)
    expect(new Set(paths).size).toBe(1)
    expect(Object.keys(catalog)).toEqual([paths[0]])
    expect(new Set(Object.values(catalog).map(source => source.id)).size).toBe(1)
    expect(state.files.get(paths[0])).toBe("same source payload")
  })

  it("keeps same-named files from different origins in distinct destinations without overwriting", async () => {
    seed("/external/one/brief.md", "origin one")
    seed("/external/two/brief.md", "origin two")
    const first = await importSourceFiles(project, ["/external/one/brief.md"], llm, watch)
    const second = await importSourceFiles(project, ["/external/two/brief.md"], llm, watch)
    const [left, right] = [first.imported[0], second.imported[0]]
    const catalog = await documents.list(project.path)
    expect(left).not.toBe(right)
    expect(state.files.get(left)).toBe("origin one")
    expect(state.files.get(right)).toBe("origin two")
    expect(catalog[left].id).not.toBe(catalog[right].id)
    expect(catalog[left].originalPath).toBe("/external/one/brief.md")
    expect(catalog[right].originalPath).toBe("/external/two/brief.md")
  })

  it("does not collide when equal-named folders are imported concurrently from separate origins", async () => {
    seed("/external/red/collection/a.md", "red a")
    seed("/external/blue/collection/a.md", "blue a")
    const [red, blue] = await Promise.all([
      importSourceFolder(project, "/external/red/collection", llm, watch),
      importSourceFolder(project, "/external/blue/collection", llm, watch),
    ])
    const redPath = red.imported[0], bluePath = blue.imported[0]
    const catalog = await documents.list(project.path)
    expect(redPath).not.toBe(bluePath)
    expect(state.files.get(redPath)).toBe("red a")
    expect(state.files.get(bluePath)).toBe("blue a")
    expect(catalog[redPath].id).not.toBe(catalog[bluePath].id)
    expect(catalog[redPath].originalPath).toBe("/external/red/collection/a.md")
    expect(catalog[bluePath].originalPath).toBe("/external/blue/collection/a.md")
  })

  it("reuses the nested folder root when a later scan first sees nested content and then a new root file", async () => {
    seed("/external/research/collection/nested/first.md", "nested remains")
    const first = await importSourceFolder(project, "/external/research/collection", llm, watch)
    seed("/external/research/collection/added.md", "new root file")
    const second = await importSourceFolder(project, "/external/research/collection", llm, watch)
    expect(first.imported).toEqual(["/test/project/raw/sources/collection/nested/first.md"])
    expect(second.imported).toEqual([
      "/test/project/raw/sources/collection/added.md",
      "/test/project/raw/sources/collection/nested/first.md",
    ])
    expect(state.files.get("/test/project/raw/sources/collection/nested/first.md")).toBe("nested remains")
    expect(state.files.get("/test/project/raw/sources/collection/added.md")).toBe("new root file")
    expect(Object.keys(await documents.list(project.path))).toHaveLength(2)
  })

  it("retries a failed copy into its reserved catalog destination without dated duplicates", async () => {
    seed("/external/retry/guide.md", "retry payload")
    state.failCopies.add("/external/retry/guide.md")
    const failed = await importSourceFiles(project, ["/external/retry/guide.md"], llm, watch)
    expect(failed.imported).toEqual([])
    expect(failed.skipped[0]?.reason).toBe("copy-failed")
    const reserved = Object.keys(await documents.list(project.path))
    expect(reserved).toHaveLength(1)
    const retried = await importSourceFiles(project, ["/external/retry/guide.md"], llm, watch)
    expect(retried.imported).toEqual(reserved)
    expect(Object.keys(await documents.list(project.path))).toEqual(reserved)
    expect(state.files.get(reserved[0])).toBe("retry payload")
  })

  it("does not copy when catalog registration fails and preserves an occupied destination", async () => {
    seed("/test/project/raw/sources/protected.md", "keep original")
    seed("/external/incoming/protected.md", "incoming bytes")
    state.failCatalogWrite = true
    const result = await importSourceFiles(project, ["/external/incoming/protected.md"], llm, watch)
    expect(result.imported).toEqual([])
    expect(result.skipped[0]?.reason).toBe("copy-failed")
    expect(state.copies).toEqual([])
    expect(state.files.get("/test/project/raw/sources/protected.md")).toBe("keep original")
  })

  it("rejects a move over an independently ingested destination before writing Wiki files", async () => {
    const oldPath = `${project.path}/raw/sources/old-name.md`, destination = `${project.path}/raw/sources/new-name.md`
    seed(oldPath, "old source"); seed(destination, "destination source")
    await registerImportedSource(project.path, oldPath, "/external/original/old-name.md")
    await registerImportedSource(project.path, destination, "/external/original/new-name.md")
    await recordSuccessfulIngest({ projectPath: project.path, taskId: "history-task", sourcePath: destination, revision: "a".repeat(64), writtenPaths: ["/test/project/wiki/entities/target.md"], createdPages: {}, cacheHit: false })
    seed("/test/project/wiki/entities/target.md", "---\nsources: [\"old-name.md\"]\n---\n# Existing wiki page\n")
    const before = state.files.get("/test/project/wiki/entities/target.md")
    await expect(migrateSourcePath(project.path, "raw/sources/old-name.md", "raw/sources/new-name.md")).rejects.toThrow(/independently registered destination/)
    expect(state.wikiWrites).toEqual([])
    expect(state.files.get("/test/project/wiki/entities/target.md")).toBe(before)
    expect((await documents.list(project.path))[destination].ingestedAt).not.toBeNull()
    expect(Object.keys((await loadIngestRecords(project.path)).receipts)).toHaveLength(1)
  })

  it("keeps exactly one migrated summary copy if the provenance metadata write fails", async () => {
    const oldIdentity = "department/guide.md", oldPath = `${project.path}/raw/sources/${oldIdentity}`, newPath = `${project.path}/raw/sources/archive/guide.md`
    seed(oldPath, "source bytes")
    await registerImportedSource(project.path, oldPath, "/external/library/department/guide.md")
    const oldSummary = `${project.path}/wiki/sources/${sourceSummarySlugFromIdentity(oldIdentity)}.md`
    const newIdentity = "archive/guide.md", newSummary = `${project.path}/wiki/sources/${sourceSummarySlugFromIdentity(newIdentity)}.md`
    seed(oldSummary, `---\nsources: [\"${oldIdentity}\"]\n---\n# Guide summary\n`)
    state.failCatalogWrite = true
    await expect(migrateSourcePath(project.path, "raw/sources/department/guide.md", "raw/sources/archive/guide.md")).rejects.toThrow(/synthetic catalog write failure/)
    expect(state.files.has(oldSummary)).toBe(false)
    expect(parseSources(state.files.get(newSummary)!)).toEqual([newIdentity])
    const summaries = [...state.files.keys()].filter(path => path.startsWith(`${project.path}/wiki/sources/`) && path.endsWith(".md"))
    expect(summaries).toEqual([newSummary])
    expect((await documents.list(project.path))[oldPath]).toBeTruthy()
    expect((await documents.list(project.path))[newPath]).toBeUndefined()
  })
})
