import { describe, expect, it, vi } from "vitest"
import type { EmbeddingConfig } from "../domain"
import type { VerifiedPageIndexCommit, VerifiedPageIndexPort } from "./ports"
import { createVerifiedSourceIndexService } from "./verified-source-index"
import type { VerifiedSourceIndexRecord, VerifiedSourceIndexRepository, VerifiedSourceSnapshot } from "./verified-source-index"

const config: EmbeddingConfig = { enabled: true, endpoint: "http://localhost/v1/embeddings", apiKey: "secret", model: "embed-a" }
const digest = (char: string) => `sha256:${char.repeat(64)}`
const snapshot: VerifiedSourceSnapshot = {
  sourceId: "source-1",
  sourceRevision: "a".repeat(64),
  rawSourceRevision: digest("9"),
  configFingerprint: digest("b"),
  outputs: [
    { relativePath: "wiki/a.md", contentRevision: digest("c") },
    { relativePath: "wiki/nested/b.md", contentRevision: digest("d") },
  ],
}
const projectPath = "C:/project"
const times = { receivedAt: "2026-11-01T10:00:00.000Z", sourceIngestedAt: "2026-11-01T10:01:00.000Z", revisionIngestedAt: "2026-11-01T10:02:00.000Z" }

function setup(overrides: { commitPage?: VerifiedPageIndexPort["commitPage"]; verifyPage?: VerifiedPageIndexPort["verifyPage"] } = {}) {
  let version = 0
  let record: VerifiedSourceIndexRecord | null = null
  let currentSnapshot: VerifiedSourceSnapshot | null = structuredClone(snapshot)
  const repository: VerifiedSourceIndexRepository = {
    async read() { return record ? { version, record: structuredClone(record) } : null },
    async readCurrentSnapshot() { return currentSnapshot ? structuredClone(currentSnapshot) : null },
    async save(sourceId, expectedVersion, next) {
      if (sourceId !== snapshot.sourceId) throw new Error("owner mismatch")
      if (expectedVersion !== version) throw Object.assign(new Error("CAS conflict"), { code: "conflict" })
      version++
      record = structuredClone(next)
      return { version, record: structuredClone(record) }
    },
  }
  const evidence = (relativePath: string): VerifiedPageIndexCommit => {
    const output = snapshot.outputs.find(item => item.relativePath === relativePath)!
    return {
      projectPath,
      pageId: relativePath === "wiki/a.md" ? "a" : "nested/b",
      contentRevision: output.contentRevision,
      configFingerprint: digest("e"),
      manifestRef: `page-commit-manifests/${(relativePath === "wiki/a.md" ? "1" : "2").repeat(64)}.json`,
      expectedChunkCount: 1,
      chunkKeys: [`${relativePath === "wiki/a.md" ? "a" : "nested/b"}#0`],
      chunkDigest: digest("f"),
      status: "committed",
    }
  }
  const pagePort: VerifiedPageIndexPort = {
    commitPage: overrides.commitPage ?? vi.fn(async input => evidence(input.relativePath)),
    verifyPage: overrides.verifyPage ?? vi.fn(async ({ expected }) => ({ status: "verified" as const, manifestRef: expected.manifestRef })),
  }
  const service = createVerifiedSourceIndexService(repository, pagePort, {
    now: () => "2026-11-06T10:00:00.000Z",
  })
  return {
    service, repository, pagePort, evidence,
    setSnapshot(value: VerifiedSourceSnapshot | null) { currentSnapshot = value ? structuredClone(value) : null },
    get record() { return record ? structuredClone(record) : null },
    get version() { return version },
  }
}

const beginInput = (attemptToken: string) => ({ projectPath, ...snapshot, config, attemptToken, times })

describe("verified source indexing lifecycle", () => {
  it("rejects reusing the current attempt token in begin", async () => {
    const fake = setup()
    await fake.service.begin(beginInput("same-token"))
    await expect(fake.service.begin(beginInput("same-token"))).rejects.toMatchObject({ code: "conflict" })
  })

  it("rejects reusing the current attempt token in retry", async () => {
    const fake = setup({ commitPage: vi.fn(async () => { throw new Error("temporary") }) })
    await fake.service.begin(beginInput("same-token"))
    await expect(fake.service.retryIndex({ projectPath, sourceId: snapshot.sourceId, configFingerprint: snapshot.configFingerprint, config, attemptToken: "same-token" })).rejects.toMatchObject({ code: "conflict" })
  })

  it("keeps verified pages and retries only failed pages without changing source times", async () => {
    let bAttempts = 0
    const commitPage = vi.fn(async ({ relativePath }: { relativePath: string }) => {
      if (relativePath === "wiki/nested/b.md" && bAttempts++ === 0) throw new Error("temporary provider failure")
      return relativePath === "wiki/a.md" ? fake.evidence(relativePath) : fake.evidence(relativePath)
    })
    const fake = setup({ commitPage })
    const first = await fake.service.begin(beginInput("attempt-1"))
    expect(first.status).toBe("failed")
    expect(first.record.pages.map(page => page.status)).toEqual(["verified", "failed"])
    expect(first.record.times).toEqual(times)

    const second = await fake.service.retryIndex({ projectPath, sourceId: snapshot.sourceId, configFingerprint: snapshot.configFingerprint, config, attemptToken: "attempt-2" })
    expect(second.status).toBe("succeeded")
    expect(second.record.pages.map(page => page.status)).toEqual(["verified", "verified"])
    expect(second.record.times).toEqual(times)
    expect(commitPage.mock.calls.filter(([input]) => input.relativePath === "wiki/a.md")).toHaveLength(1)
    expect(commitPage.mock.calls.filter(([input]) => input.relativePath === "wiki/nested/b.md")).toHaveLength(2)
    expect(fake.pagePort.verifyPage).toHaveBeenCalledWith(expect.objectContaining({ relativePath: "wiki/a.md" }))
  })

  it("does not let a late commit overwrite a cancelled attempt", async () => {
    let finishCommit!: (value: VerifiedPageIndexCommit) => void
    const commitPage = vi.fn(() => new Promise<VerifiedPageIndexCommit>(resolve => { finishCommit = resolve }))
    const fake = setup({ commitPage })
    const running = fake.service.begin(beginInput("attempt-cancel"))
    await vi.waitFor(() => expect(commitPage).toHaveBeenCalled())
    expect(commitPage).toHaveBeenCalled()
    await fake.service.cancel(snapshot.sourceId, "attempt-cancel")
    finishCommit(fake.evidence("wiki/a.md"))
    const result = await running
    expect(result.status).toBe("cancelled")
    expect(fake.record?.status).toBe("cancelled")
  })

  it("does not succeed when committing a later page invalidates an earlier page", async () => {
    let secondCommitted = false
    let fake!: ReturnType<typeof setup>
    const commitPage = vi.fn(async ({ relativePath }: { relativePath: string }) => {
      if (relativePath === "wiki/nested/b.md") secondCommitted = true
      return fake.evidence(relativePath)
    })
    fake = setup({ commitPage })
    // The second commit makes the first page's previously published manifest stale.
    vi.mocked(fake.pagePort.verifyPage).mockImplementation(async ({ relativePath, expected }) =>
      relativePath === "wiki/a.md" && secondCommitted
        ? { status: "corrupt" as const }
        : { status: "verified" as const, manifestRef: expected.manifestRef },
    )
    const result = await fake.service.begin(beginInput("attempt-late-invalidation"))
    expect(result.status).toBe("failed")
    expect(fake.record?.status).toBe("failed")
  })

  it.each(["config", "output", "raw source"] as const)("blocks completion when current %s snapshot changes during indexing", async kind => {
    let fake!: ReturnType<typeof setup>
    const commitPage = vi.fn(async ({ relativePath }: { relativePath: string }) => {
      const changed = structuredClone(snapshot)
      if (kind === "config") changed.configFingerprint = digest("8")
      else if (kind === "raw source") changed.rawSourceRevision = digest("7")
      else changed.outputs[0].contentRevision = digest("6")
      fake.setSnapshot(changed)
      return fake.evidence(relativePath)
    })
    fake = setup({ commitPage })
    const result = await fake.service.begin(beginInput(`attempt-${kind}`))
    expect(result.status).toBe("blocked")
    expect(fake.record?.status).toBe("blocked")
    expect(fake.record?.error?.code).toBe("snapshot_changed")
  })

  it("re-verifies persisted evidence after restart and repairs an invalid page without recompiling", async () => {
    const fake = setup()
    const completed = await fake.service.begin(beginInput("attempt-first"))
    expect(completed.status).toBe("succeeded")
    let verifyCalls = 0
    vi.mocked(fake.pagePort.verifyPage).mockImplementation(async ({ expected }) => {
      verifyCalls++
      return verifyCalls === 1 ? { status: "corrupt" } : { status: "verified", manifestRef: expected.manifestRef }
    })
    vi.mocked(fake.pagePort.verifyPage).mockClear()
    const recovered = await fake.service.retryIndex({ projectPath, sourceId: snapshot.sourceId, configFingerprint: snapshot.configFingerprint, config, attemptToken: "attempt-recovery" })
    expect(recovered.status).toBe("succeeded")
    expect(fake.pagePort.verifyPage).toHaveBeenCalledTimes(5)
    expect(fake.pagePort.commitPage).toHaveBeenCalledTimes(3)
    expect(recovered.record.pages.every(page => page.evidence !== null)).toBe(true)
  })

  it("fails closed on malformed persisted records and does not replace them", async () => {
    const fake = setup()
    await fake.service.begin(beginInput("attempt-one"))
    const record = fake.record!
    record.pages[0].pageId = "wrong-page"
    const corruptRepo = fake.repository
    const read = corruptRepo.read
    vi.spyOn(corruptRepo, "read").mockImplementation(async sourceId => {
      const stored = await read(sourceId)
      return stored ? { ...stored, record } : null
    })
    await expect(fake.service.read(snapshot.sourceId)).rejects.toMatchObject({ code: "invalid_record" })
  })
})
