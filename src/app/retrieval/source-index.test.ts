import { createHash } from "node:crypto"
import { mkdtemp, mkdir, readFile as nodeReadFile, rm, writeFile as nodeWriteFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ root: "", secondFailures: 0, commitCalls: [] as string[], manifests: new Map<string, unknown>(), outputPaths: ["wiki/page-a.md", "wiki/page-b.md"] }))
const digest = (input: string) => createHash("sha256").update(input).digest("hex")
const sourceRevision = "a".repeat(64)
const config = { enabled: true, endpoint: "http://localhost/v1/embeddings", apiKey: "secret", model: "embed-a", extraHeaders: { "X-Provider": "demo" } }

vi.mock("@/app/document-records/repository", () => ({
  loadIngestRecords: async () => ({
    version: 1, projectRootPath: state.root, vaultPath: null,
    sources: { [join(state.root, "raw", "sources", "source.pdf")]: { id: "source-1", originalPath: null, receivedAt: "2026-11-08T00:00:00.000Z", ingestedAt: "2026-11-08T00:01:00.000Z", contentRevision: sourceRevision } },
    pages: {},
    receipts: { "source-1-revision": {
      schemaVersion: 1, id: "source-1-revision", taskId: "task", sourceId: "source-1", sourcePath: join(state.root, "raw", "sources", "source.pdf"), originalPath: null,
      sourceRevision, sourceIngestedAt: "2026-11-08T00:01:00.000Z", revisionIngestedAt: "2026-11-08T00:02:00.000Z",
      wikiResults: state.outputPaths.map(path => ({ path, wikiCreatedAt: null })), recordedAt: "2026-11-08T00:02:00.000Z",
      status: "content_ingested", indexStatus: "unknown", delivery: "not_connected", error: null,
    } },
  }),
}))
vi.mock("@/commands/fs", async () => {
  const fs = await import("node:fs/promises")
  const crypto = await import("node:crypto")
  return {
    createDirectory: async (path: string) => fs.mkdir(path, { recursive: true }),
    fileExists: async (path: string) => { try { await fs.stat(path); return true } catch { return false } },
    hashFileSha256: async (path: string) => crypto.createHash("sha256").update(await fs.readFile(path)).digest("hex"),
    readFile: async (path: string) => fs.readFile(path, "utf8"),
    writeFileAtomic: async (path: string, contents: string) => { const temp = `${path}.tmp`; await fs.writeFile(temp, contents); await fs.rename(temp, path) },
  }
})
vi.mock("./verified-index", async () => {
  const crypto = await import("node:crypto")
  const hash = (value: string) => crypto.createHash("sha256").update(value).digest("hex")
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value
  const fingerprint = (value: Record<string, unknown>) => `sha256:${hash(JSON.stringify(canonical(value)))}`
  const port = {
    commitPage: async (input: { projectPath: string; relativePath: string; config: typeof config }) => {
      state.commitCalls.push(input.relativePath)
      if (input.relativePath === "wiki/page-b.md" && state.secondFailures-- > 0) throw new Error("simulated provider outage")
      const content = await nodeReadFile(resolve(input.projectPath, input.relativePath), "utf8")
      const pageId = input.relativePath.slice(5, -3)
      const manifestHash = hash(`${input.relativePath}:${content}:${state.commitCalls.length}`)
      const evidence = {
        projectPath: input.projectPath, pageId, contentRevision: `sha256:${hash(content)}`, configFingerprint: fingerprint({ ...input.config, apiKey: undefined }),
        manifestRef: `page-commit-manifests/${manifestHash}.json`, expectedChunkCount: 1,
        chunkKeys: [`${pageId}#0`], chunkDigest: `sha256:${hash(content)}`, status: "committed" as const,
      }
      state.manifests.set(input.relativePath, evidence)
      return evidence
    },
    verifyPage: async (input: { relativePath: string; expected: { manifestRef: string; contentRevision: string } }) => {
      const current = state.manifests.get(input.relativePath) as typeof input.expected | undefined
      const content = await nodeReadFile(resolve(state.root, input.relativePath), "utf8")
      return current?.manifestRef === input.expected.manifestRef && input.expected.contentRevision === `sha256:${hash(content)}`
        ? { status: "verified" as const, manifestRef: current.manifestRef }
        : { status: "corrupt" as const }
    },
  }
  return { verifiedPageIndexPort: port }
})

import { useWikiStore } from "@/stores/wiki-store"
import { indexCompiledSource, readCompiledSourceIndex, retryCompiledSourceIndex } from "./source-index"

describe("compiled source index adapter over real files", () => {
  let root = ""
  beforeEach(async () => {
    vi.restoreAllMocks()
    root = await mkdtemp(join(tmpdir(), "kw-d05-index-"))
    state.root = root; state.secondFailures = 1; state.commitCalls = []; state.manifests.clear(); state.outputPaths = ["wiki/page-a.md", "wiki/page-b.md"]
    await mkdir(join(root, "raw", "sources"), { recursive: true }); await mkdir(join(root, "wiki"), { recursive: true })
    await nodeWriteFile(join(root, "raw", "sources", "source.pdf"), "original source bytes")
    await nodeWriteFile(join(root, "wiki", "page-a.md"), "compiled page alpha")
    await nodeWriteFile(join(root, "wiki", "page-b.md"), "compiled page beta")
    useWikiStore.setState({ embeddingConfig: config })
  })
  afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }) })

  it("persists valid evidence, reopens it, retries only the failed page, and preserves source times", async () => {
    const rawRevision = digest("original source bytes")
    const first = await indexCompiledSource({ projectPath: root, sourceId: "source-1", sourceRevision, rawSourceRevision: rawRevision, config, attemptToken: "attempt-1" })
    expect(first.status).toBe("failed")
    expect(first.record.pages.map(page => page.status)).toEqual(["verified", "failed"])
    expect(first.record.pages[0].evidence?.manifestRef).toMatch(/^page-commit-manifests\/[a-f0-9]{64}\.json$/)
    expect(first.record.pages[0].relativePath).toBe("wiki/page-a.md")
    expect(first.record.times.sourceIngestedAt).toBe("2026-11-08T00:01:00.000Z")
    const reopened = await readCompiledSourceIndex(root, "source-1")
    expect(reopened?.record.pages[0].evidence).toEqual(first.record.pages[0].evidence)
    const before = state.commitCalls.length
    const retried = await retryCompiledSourceIndex({ projectPath: root, sourceId: "source-1", config, attemptToken: "attempt-2" })
    expect(retried.status).toBe("succeeded")
    expect(state.commitCalls.slice(before)).toEqual(["wiki/page-b.md"])
    expect(retried.record.times).toEqual(first.record.times)
  })

  it("rejects a physical source change even when the catalog parsed revision is unchanged", async () => {
    state.secondFailures = 0
    const rawRevision = digest("original source bytes")
    state.manifests.clear()
    const { verifiedPageIndexPort } = await import("./verified-index")
    const commit = verifiedPageIndexPort.commitPage.bind(verifiedPageIndexPort)
    vi.spyOn(verifiedPageIndexPort, "commitPage").mockImplementation(async input => {
      const result = await commit(input)
      await nodeWriteFile(join(root, "raw", "sources", "source.pdf"), "changed physical bytes")
      return result
    })
    const result = await indexCompiledSource({ projectPath: root, sourceId: "source-1", sourceRevision, rawSourceRevision: rawRevision, config, attemptToken: "attempt-raw-change" })
    expect(result.status).toBe("blocked")
    expect(result.record.error?.code).toBe("snapshot_changed")
  })

  it("rejects unsafe output traversal and detects nested embedding configuration changes", async () => {
    state.outputPaths = ["wiki/../outside.md"]
    await expect(indexCompiledSource({ projectPath: root, sourceId: "source-1", sourceRevision, rawSourceRevision: digest("original source bytes"), config, attemptToken: "attempt-path" })).rejects.toThrow(/unsafe|outside/i)
    state.outputPaths = ["wiki/page-a.md"]
    const { verifiedPageIndexPort } = await import("./verified-index")
    const commit = verifiedPageIndexPort.commitPage.bind(verifiedPageIndexPort)
    vi.spyOn(verifiedPageIndexPort, "commitPage").mockImplementation(async input => {
      const result = await commit(input)
      useWikiStore.setState({ embeddingConfig: { ...config, extraHeaders: { "X-Provider": "changed" } } })
      return result
    })
    const result = await indexCompiledSource({ projectPath: root, sourceId: "source-1", sourceRevision, rawSourceRevision: digest("original source bytes"), config, attemptToken: "attempt-config" })
    expect(result.status).toBe("blocked")
    expect(result.record.error?.code).toBe("snapshot_changed")
  })

  it("rejects path traversal in public retry and read source IDs", async () => {
    await expect(readCompiledSourceIndex(root, "../outside")).rejects.toThrow(/source ID/i)
    await expect(retryCompiledSourceIndex({ projectPath: root, sourceId: "../outside", config, attemptToken: "attempt-path-traversal" })).rejects.toThrow(/source ID/i)
  })
})
