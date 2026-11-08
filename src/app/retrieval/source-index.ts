import { createDirectory, fileExists, hashFileSha256, readFile, writeFileAtomic } from "@/commands/fs"
import { normalizePath, isAbsolutePath, getRelativePath } from "@/lib/path-utils"
import { withProjectLock } from "@/lib/project-mutex"
import { useWikiStore } from "@/stores/wiki-store"
import type { EmbeddingConfig } from "@/modules/retrieval/domain"
import { createVerifiedSourceIndexService } from "@/modules/retrieval/application"
import type { VerifiedSourceIndexRepository, VerifiedSourceSnapshot, VersionedVerifiedSourceIndexRecord } from "@/modules/retrieval/application"
import { loadIngestRecords } from "@/app/document-records/repository"
import { verifiedPageIndexPort } from "./verified-index"

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const sha256 = (value: string) => `sha256:${value.replace(/^sha256:/, "")}`
const repoPath = (root: string, sourceId: string) => {
  const normalized = normalizePath(root)
  if (!ID.test(sourceId)) throw new Error("Invalid source ID")
  if (!isAbsolutePath(normalized) || normalized.split("/").some(part => part === "." || part === "..")) throw new Error("Project path must be absolute and canonical")
  return `${normalized.replace(/\/+$/, "")}/.llm-wiki/verified-source-index/${sourceId}.json`
}
function outputPath(root: string, path: string): string {
  if (path.includes("\\") || /[\u0000-\u001f\u007f]/.test(path)) throw new Error("Invalid compiled output path")
  if (path.split("/").some(segment => segment === "." || segment === "..")) throw new Error("Unsafe compiled output path")
  const full = normalizePath(isAbsolutePath(path) ? path : `${normalizePath(root)}/${path}`)
  const base = normalizePath(root).replace(/\/+$/, "")
  const windows = /^[A-Za-z]:\//.test(base) || base.startsWith("//")
  const equal = (left: string, right: string) => windows ? left.toLowerCase() === right.toLowerCase() : left === right
  const relative = getRelativePath(full, base)
  if (relative === full || !relative.startsWith("wiki/") || relative.split("/").some(segment => !segment || segment === "." || segment === "..") || !equal(full.slice(0, full.length - relative.length - 1), base))
    throw new Error("Compiled output is outside the project wiki")
  return full
}
async function fingerprint(config: EmbeddingConfig): Promise<string> {
  const identity = { ...config, apiKey: undefined }
  const canonical = (value: unknown): unknown => Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]))
      : value
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(identity)))
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return `sha256:${Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("")}`
}
async function snapshotFor(root: string, sourceId: string, requestedRevision?: string, config?: EmbeddingConfig, expectedRawSourceRevision?: string): Promise<VerifiedSourceSnapshot | null> {
  const records = await loadIngestRecords(root)
  const sourceEntry = Object.entries(records.sources).find(([, value]) => value.id === sourceId)
  const source = sourceEntry?.[1]
  if (!source || !sourceEntry) return null
  if (!source.contentRevision || requestedRevision && source.contentRevision !== requestedRevision) return null
  const sourcePath = normalizePath(sourceEntry[0])
  if (!isAbsolutePath(sourcePath) || !(await fileExists(sourcePath))) return null
  const rawSourceRevision = `sha256:${await hashFileSha256(sourcePath)}`
  if (expectedRawSourceRevision && rawSourceRevision !== sha256(expectedRawSourceRevision)) return null
  const receipts = Object.values(records.receipts).filter(value => value.sourceId === sourceId && value.sourceRevision === source.contentRevision && (!requestedRevision || value.sourceRevision === requestedRevision))
  receipts.sort((a, b) => (b.revisionIngestedAt ?? b.recordedAt).localeCompare(a.revisionIngestedAt ?? a.recordedAt))
  const receipt = receipts[0]
  if (!receipt) return null
  const outputs = []
  for (const entry of receipt.wikiResults) {
    const absolute = outputPath(root, entry.path)
    if (!(await fileExists(absolute))) throw new Error(`Compiled output is missing: ${entry.path}`)
    outputs.push({ relativePath: getRelativePath(absolute, root), contentRevision: `sha256:${await hashFileSha256(absolute)}` })
  }
  if (!outputs.length) throw new Error("Compiled source receipt has no Wiki outputs")
  return { sourceId, sourceRevision: receipt.sourceRevision, rawSourceRevision, configFingerprint: config ? await fingerprint(config) : "", outputs }
}
function createRepository(root: string, rawSourceRevision: string): VerifiedSourceIndexRepository {
  return {
    async read(sourceId): Promise<VersionedVerifiedSourceIndexRecord | null> {
      const path = repoPath(root, sourceId)
      if (!(await fileExists(path))) return null
      const value = JSON.parse(await readFile(path)) as VersionedVerifiedSourceIndexRecord
      if (!Number.isSafeInteger(value.version) || value.version < 1 || value.record?.sourceId !== sourceId) throw new Error("Invalid verified source index file; original preserved")
      return value
    },
    readCurrentSnapshot: sourceId => snapshotFor(root, sourceId, undefined, useWikiStore.getState().embeddingConfig, rawSourceRevision),
    async save(sourceId, expectedVersion, record) {
      return withProjectLock(`${normalizePath(root)}\0verified-source-index:${sourceId}`, async () => {
        const current = await this.read(sourceId)
        const version = current?.version ?? 0
        if (version !== expectedVersion) throw Object.assign(new Error("Verified source index CAS conflict"), { code: "conflict" })
        const next = { version: version + 1, record: structuredClone(record) }
        const path = repoPath(root, sourceId)
        await createDirectory(`${normalizePath(root)}/.llm-wiki/verified-source-index`)
        await writeFileAtomic(path, JSON.stringify(next, null, 2))
        return next
      })
    },
  }
}

function serviceFor(projectPath: string, rawSourceRevision: string) {
  return createVerifiedSourceIndexService(createRepository(projectPath, rawSourceRevision), verifiedPageIndexPort, { now: () => new Date().toISOString() })
}

/** Indexes an already compiled receipt; it never invokes the parser or compiler. */
export async function indexCompiledSource(input: { projectPath: string; sourceId: string; sourceRevision: string; rawSourceRevision: string; config: EmbeddingConfig; attemptToken: string }) {
  if (!ID.test(input.sourceId)) throw new Error("Invalid source ID")
  const configFingerprint = await fingerprint(input.config)
  const snapshot = await snapshotFor(input.projectPath, input.sourceId, input.sourceRevision, input.config, input.rawSourceRevision)
  if (!snapshot) throw new Error("Compiled source receipt not found")
  if (snapshot.sourceRevision !== input.sourceRevision) throw new Error("Compiled source revision changed")
  const records = await loadIngestRecords(input.projectPath)
  const receipt = Object.values(records.receipts).find(value => value.sourceId === input.sourceId && value.sourceRevision === input.sourceRevision)
  const source = Object.values(records.sources).find(value => value.id === input.sourceId)
  if (snapshot.configFingerprint !== configFingerprint) throw new Error("Embedding configuration changed while preparing source index")
  return serviceFor(input.projectPath, snapshot.rawSourceRevision).begin({
    projectPath: normalizePath(input.projectPath), sourceId: input.sourceId, sourceRevision: snapshot.sourceRevision,
    rawSourceRevision: snapshot.rawSourceRevision,
    configFingerprint, outputs: snapshot.outputs, config: input.config, attemptToken: input.attemptToken,
    times: { receivedAt: source?.receivedAt ?? null, sourceIngestedAt: source?.ingestedAt ?? null, revisionIngestedAt: receipt?.revisionIngestedAt ?? null },
  })
}

/** Retries page indexing against the current compiled files and never recompiles. */
export async function retryCompiledSourceIndex(input: { projectPath: string; sourceId: string; config: EmbeddingConfig; attemptToken: string }) {
  const existingRaw = await readSavedRawRevision(input.projectPath, input.sourceId)
  const current = await serviceFor(input.projectPath, existingRaw ?? "").read(input.sourceId)
  if (!current) throw new Error("Source index record not found")
  if (!existingRaw) throw new Error("Source index record has no raw source revision")
  const configFingerprint = await fingerprint(input.config)
  return serviceFor(input.projectPath, existingRaw).retryIndex({ projectPath: normalizePath(input.projectPath), sourceId: input.sourceId, configFingerprint, config: input.config, attemptToken: input.attemptToken })
}
async function readSavedRawRevision(projectPath: string, sourceId: string): Promise<string | null> {
  const path = repoPath(projectPath, sourceId)
  if (!(await fileExists(path))) return null
  const value = JSON.parse(await readFile(path)) as VersionedVerifiedSourceIndexRecord
  if (!Number.isSafeInteger(value.version) || value.version < 1 || value.record?.sourceId !== sourceId || !/^(?:sha256:)?[a-f0-9]{64}$/.test(value.record.rawSourceRevision))
    throw new Error("Invalid verified source index file; original preserved")
  return value.record.rawSourceRevision
}
export async function readCompiledSourceIndex(projectPath: string, sourceId: string) {
  const raw = await readSavedRawRevision(projectPath, sourceId)
  return raw ? serviceFor(projectPath, raw).read(sourceId) : null
}
