import { mkdtemp, mkdir, readdir, readFile } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { createServer } from "node:http"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { writeFileRaw } from "@/test-helpers/fs-temp"
import { ingestScenarios } from "@/test-helpers/scenarios/ingest-scenarios"

const bridge = vi.hoisted(() => ({ nativeInvoke: null as null | ((command: string, args: Record<string, unknown>) => Promise<unknown>), vaultWrites: 0 }))
vi.mock("@/commands/fs", async () => {
  const { realFs } = await import("@/test-helpers/fs-temp")
  return {
    ...realFs,
    hashFileSha256: async (path: string) => await bridge.nativeInvoke!("hash_file_sha256", { path }) as string,
    writeVaultReceipt: async (vaultPath: string, fileName: string, contents: string) => {
      bridge.vaultWrites++
      return bridge.nativeInvoke!("write_vault_receipt", { vaultPath, fileName, contents })
    },
  }
})
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args: Record<string, unknown>) => {
    if (!bridge.nativeInvoke) throw new Error("Native Tauri CDP invoke is not connected")
    return bridge.nativeInvoke(command, args)
  },
}))
const llm = vi.hoisted(() => ({ responses: [] as string[], calls: 0 }))
vi.mock("@/lib/llm-client", () => ({
  streamChat: vi.fn(async (_config, _messages, callbacks) => {
    llm.calls++
    const response = llm.responses.shift() ?? ""
    callbacks.onToken(response)
    callbacks.onDone()
  }),
}))
vi.mock("@/lib/mineru", () => ({ parseWithMineruResult: vi.fn() }))

import { autoIngest } from "@/lib/ingest"
import { useWikiStore } from "@/stores/wiki-store"
import { configureObsidianVault } from "@/app/obsidian/service"
import { loadPhaseReceiptRecords } from "@/app/obsidian/phase-receipts"
import { phaseReceipts } from "@/app/obsidian/phase-receipts"
import { syncConfiguredPhaseReceipts } from "@/app/obsidian/auto-sync"
import { retryIngestionFeedback } from "@/app/ingestion/retry-feedback"
import { loadIngestRecords } from "@/app/document-records/repository"
import { readCompiledSourceIndex } from "@/app/retrieval/source-index"
import { ingestionIdempotencyKey } from "@/modules/ingestion/domain"

const cdpUrl = process.env.KW_NATIVE_CDP_URL
const required = process.env.KW_NATIVE_REQUIRED === "1"
let browser: { close(): Promise<void> } | undefined
let projectRoot: string | undefined
let vaultRoot: string | undefined
let provider: ReturnType<typeof createServer> | undefined
let embeddingCalls = 0

if (!cdpUrl && !required) console.warn("NOT RUN: D09 native pipeline test skipped; set KW_NATIVE_CDP_URL to a live isolated Tauri WebView CDP endpoint.")

describe("D09 native verified indexing pipeline", () => {
  beforeEach(() => {
    bridge.nativeInvoke = null
    bridge.vaultWrites = 0
    llm.responses = []
    llm.calls = 0
    embeddingCalls = 0
  })

  afterAll(async () => {
    if (provider) await new Promise<void>(resolve => provider!.close(() => resolve()))
    if (browser) await browser.close()
    // The isolated Tauri process may keep LanceDB handles open. Leave only these
    // test-owned temp roots for cleanup after that process exits.
    if (projectRoot || vaultRoot) console.log(`D09 temporary roots: project=${projectRoot}; vault=${vaultRoot}`)
  })

  if (required) {
    it("requires a native CDP endpoint when KW_NATIVE_REQUIRED=1", () => {
      expect(cdpUrl, "KW_NATIVE_REQUIRED=1 requires KW_NATIVE_CDP_URL").toBeTruthy()
    })
  }

  it.skipIf(!cdpUrl)("NOT RUN without KW_NATIVE_CDP_URL: autoIngest native index proof and Vault delivery", async () => {
    const playwrightName = process.env.PLAYWRIGHT_MODULE || "playwright-core"
    const { chromium } = await import(playwrightName)
    browser = await chromium.connectOverCDP(cdpUrl!)
    const pages = browser.contexts().flatMap(context => context.pages())
    let page
    for (const candidate of pages) {
      if (await candidate.evaluate(() => typeof window.__TAURI_INTERNALS__?.invoke === "function").catch(() => false)) { page = candidate; break }
    }
    if (!page) throw new Error("CDP connected but no Tauri WebView exposes __TAURI_INTERNALS__.invoke")
    bridge.nativeInvoke = (command, args) => page!.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args })

    const scenario = ingestScenarios.find(item => item.name === "basic-new-source")!
    const temp = await mkdtemp(path.join(os.tmpdir(), "kw-d09-pipeline-"))
    projectRoot = path.join(temp, "project").replace(/\\/g, "/")
    vaultRoot = path.join(temp, "vault").replace(/\\/g, "/")
    await mkdir(path.join(projectRoot, "wiki"), { recursive: true })
    await mkdir(path.join(projectRoot, "raw", "sources"), { recursive: true })
    await mkdir(path.join(vaultRoot, ".obsidian"), { recursive: true })
    for (const [relative, content] of Object.entries(scenario.initialWiki)) await writeFileRaw(path.join(projectRoot, relative), content)
    const sourcePath = path.join(projectRoot, scenario.source.path).replace(/\\/g, "/")
    await writeFileRaw(sourcePath, scenario.source.content)

    const embeddingProvider = createServer(async (request, response) => {
      for await (const _chunk of request) { /* consume deterministic request */ }
      embeddingCalls++
      response.writeHead(200, { "content-type": "application/json" })
      response.end(JSON.stringify({ data: [{ object: "embedding", index: 0, embedding: [1, 0, 0, 0] }] }))
    })
    provider = embeddingProvider
    await new Promise<void>(resolve => embeddingProvider.listen(0, "127.0.0.1", () => resolve()))
    const address = embeddingProvider.address()
    if (!address || typeof address === "string") throw new Error("Could not bind deterministic embedding provider")

    const projectId = `d09-${crypto.randomUUID()}`
    const taskId = `d09-${crypto.randomUUID()}`
    const config = { provider: "openai", apiKey: "native-d09-test", model: "test-model", ollamaUrl: "", customEndpoint: "", maxContextSize: 128000 }
    useWikiStore.setState({
      project: { id: projectId, name: "D09 temp", path: projectRoot, createdAt: 0, purposeText: "", fileTree: [] } as never,
      embeddingConfig: { enabled: true, endpoint: `http://127.0.0.1:${address.port}/v1/embeddings`, apiKey: "native-d09-test", model: "d09-deterministic", extraHeaders: {}, maxChunkChars: 500, overlapChunkChars: 0 },
    })
    useWikiStore.getState().setLlmConfig(config)
    await configureObsidianVault(projectRoot, vaultRoot)
    const sourceHash = await bridge.nativeInvoke("hash_file_sha256", { path: sourcePath }) as string
    const llmCallStart = llm.calls

    const run = async (id: string) => {
      const scenarioResponses = [scenario.analysisResponse, scenario.generationResponse]
      llm.responses.push(...scenarioResponses)
      let bound: { sourceId: string; sourceRevision: string; idempotencyKey: string } | null = null
      const written = await autoIngest(projectRoot!, sourcePath, useWikiStore.getState().llmConfig, undefined, undefined, undefined, {
        taskId: id,
        projectId,
        bindIdempotency: async identity => { bound = identity },
      })
      expect(written).toEqual(expect.arrayContaining(scenario.expected.writtenPaths))
      expect(bound).not.toBeNull()
      expect(bound!.idempotencyKey).toBe(ingestionIdempotencyKey(projectId, bound!.sourceId, bound!.sourceRevision))
      return bound!
    }

    const firstBound = await run(taskId)
    expect(llm.calls - llmCallStart).toBe(2)
    const sourceRecords = await loadIngestRecords(projectRoot)
    const source = Object.values(sourceRecords.sources).find(item => item.id === firstBound.sourceId)
    expect(source?.sourceKind).toBe("raw")
    const index = await readCompiledSourceIndex(projectRoot, firstBound.sourceId)
    expect(index?.record.status).toBe("succeeded")
    expect(index?.record.pages.length).toBeGreaterThan(0)
    expect(index?.record.pages.every(item => item.evidence !== null)).toBe(true)
    const embeddingCallsAfterFirst = embeddingCalls

    for (const item of index!.record.pages) {
      const check = await bridge.nativeInvoke("verify_page_index_commit", { projectPath: projectRoot, relativePath: item.relativePath, config: useWikiStore.getState().embeddingConfig, expected: item.evidence }) as { status: string; manifestRef?: string }
      expect(check.status).toBe("verified")
      expect(check.manifestRef).toBe(item.evidence!.manifestRef)
    }
    const search = await bridge.nativeInvoke("search_project", { projectPath: projectRoot, query: "rotary position embedding", topK: 10, includeContent: true, queryEmbedding: [1, 0, 0, 0], embeddingConfig: null }) as { vectorHits: number; results: Array<{ path: string }> }
    expect(search.vectorHits).toBeGreaterThan(0)
    expect(search.results.some(result => index!.record.pages.some(item => item.relativePath === result.path.replace(/\\/g, "/")))).toBe(true)

    const phase = await loadPhaseReceiptRecords(projectRoot)
    const phaseReceipt = phase.receipts[`${firstBound.sourceId}-parsed-text-sha256-${firstBound.sourceRevision}`]
    expect(phaseReceipt?.sourceKind).toBe("raw")
    expect(phaseReceipt?.checkpoint.stages.index.status).toBe("succeeded")
    expect(phaseReceipt?.checkpoint.stages.feedback.status).toBe("succeeded")
    expect(phaseReceipt?.summary.complete).toBe(true)
    expect(phaseReceipt?.delivery).toBe("delivered")
    expect(phaseReceipt?.deliveredDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(phaseReceipt?.indexCommitRefs.length).toBe(index!.record.pages.length)
    expect(phaseReceipt?.outputVersions.length).toBeGreaterThanOrEqual(index!.record.pages.length)
    expect(phaseReceipt?.outputVersions.every(item => /^sha256:[a-f0-9]{64}$/.test(item.version))).toBe(true)
    expect(index!.record.pages.every(item => phaseReceipt!.outputVersions.some(output => output.path === item.relativePath))).toBe(true)
    expect(bridge.vaultWrites).toBeGreaterThan(0)
    const vaultJson = (await readdir(path.join(vaultRoot, "kb-ingest-records"))).filter(name => name.endsWith(".json"))
    expect(vaultJson.length).toBeGreaterThan(0)
    const external = await Promise.all(vaultJson.map(name => readFile(path.join(vaultRoot!, "kb-ingest-records", name), "utf8").then(JSON.parse)))
    expect(external.some(value => value.schemaVersion === 2 && value.sourceKind === "raw" && value.checkpoint?.stages?.index?.status === "succeeded")).toBe(true)
    expect(await bridge.nativeInvoke("hash_file_sha256", { path: sourcePath })).toBe(sourceHash)

    await run(`d09-${crypto.randomUUID()}`)
    expect(llm.calls - llmCallStart).toBe(2)
    expect(embeddingCalls).toBe(embeddingCallsAfterFirst)
    // autoIngest saves the superseded pointer locally. The production auto-sync
    // service writes that pointer over the previously delivered unknown receipt.
    await syncConfiguredPhaseReceipts(projectRoot, {
      read: path => phaseReceipts.read(path),
      retryFeedback: retryIngestionFeedback,
      sync: path => phaseReceipts.sync(path),
    })
    const phaseAfterSecond = await loadPhaseReceiptRecords(projectRoot)
    const knownAfterSecond = phaseAfterSecond.receipts[phaseReceipt!.id]
    expect(knownAfterSecond?.sourceId).toBe(firstBound.sourceId)
    expect(knownAfterSecond?.runId).not.toBe(phaseReceipt!.runId)
    const archivedUnknown = Object.values(phaseAfterSecond.receipts).filter(item => item.sourceId === firstBound.sourceId && item.sourceRevision === null && item.summary.status === "processing")
    expect(archivedUnknown.length).toBeGreaterThan(0)
    expect(archivedUnknown.every(item => item.supersededBy === knownAfterSecond?.id)).toBe(true)
    for (const item of archivedUnknown) {
      const archived = JSON.parse(await readFile(path.join(vaultRoot, "kb-ingest-records", `${item.sourceId}-unknown-${item.runId}.json`), "utf8"))
      expect(archived.supersededBy).toBe(knownAfterSecond?.id)
    }
    const afterSecond = await readCompiledSourceIndex(projectRoot, firstBound.sourceId)
    expect(afterSecond?.record.status).toBe("succeeded")
    expect(afterSecond?.record.times).toEqual(index!.record.times)
    expect(await bridge.nativeInvoke("hash_file_sha256", { path: sourcePath })).toBe(sourceHash)
  }, 120_000)
})
