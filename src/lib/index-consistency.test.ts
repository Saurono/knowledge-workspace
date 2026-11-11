import { afterEach, describe, expect, it, vi } from "vitest"
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createHash } from "node:crypto"
import { createIndexConsistency, type IndexConsistencyPorts } from "./index-consistency"
import { rebuildIndex } from "./rebuild-index"
import type { VerifiedPageIndexCommit } from "@/modules/retrieval/application"
import type { EmbeddingConfig } from "@/modules/retrieval/domain"

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "k03-k06-")); roots.push(root)
  const wiki = join(root, "wiki"), derived = join(root, "derived")
  await mkdir(wiki)
  await writeFile(join(wiki, "a.md"), "alpha first page")
  await writeFile(join(wiki, "b.md"), "alpha second page")
  const revision = (s: string) => `sha256:${createHash("sha256").update(s).digest("hex")}`
  const config = {} as EmbeddingConfig
  let fail = "", gate: Promise<void> | undefined
  const ports: IndexConsistencyPorts<string> = {
    async pages() {
      return Promise.all((await readdir(wiki)).sort().map(async name => {
        const content = await readFile(join(wiki, name), "utf8")
        return { relativePath: `wiki/${name}`, content, revision: revision(content) }
      }))
    },
    async readEvidence() { return JSON.parse(await readFile(join(derived, "evidence.json"), "utf8")) },
    async saveEvidence(value) { await writeFile(join(derived, "evidence.json"), JSON.stringify(value)) },
    index: {
      commitPage: vi.fn(async input => {
        await gate
        if (input.relativePath === fail) throw new Error("fixture step failure")
        const content = await readFile(join(root, input.relativePath), "utf8")
        await mkdir(derived, { recursive: true })
        await writeFile(join(derived, input.relativePath.slice(5) + ".json"), JSON.stringify({ content }))
        return { projectPath: root, pageId: input.relativePath.slice(5, -3), contentRevision: revision(content), configFingerprint: "fixture", manifestRef: input.relativePath, expectedChunkCount: 1, chunkKeys: ["0"], chunkDigest: revision(content), status: "committed" } satisfies VerifiedPageIndexCommit
      }),
      async verifyPage({ relativePath, expected }) {
        try {
          const { content } = JSON.parse(await readFile(join(derived, relativePath.slice(5) + ".json"), "utf8"))
          return { status: revision(content) === expected.contentRevision ? "verified" : "corrupt" }
        } catch { return { status: "missing" } }
      },
    },
    search: vi.fn(async query => {
      const names = (await readdir(derived)).filter(name => name !== "evidence.json").sort()
      const results: string[] = []
      for (const name of names) {
        const { content } = JSON.parse(await readFile(join(derived, name), "utf8"))
        if (content.includes(query)) results.push(content)
      }
      return results
    }),
    async fallback(query, pages) { return pages.filter(page => page.content.includes(query)).map(page => page.content) },
  }
  return { root, derived, config, ports, service: () => createIndexConsistency(root, config, ports), fail: (path: string) => { fail = path }, gate: (value: Promise<void>) => { gate = value } }
}

describe("K03/K06 index consistency", () => {
  it("rebuilds deleted derived directory with identical retrieval results", async () => {
    const f = await fixture()
    const before = await rebuildIndex(f.root, f.config, f.ports)
    const expected = await before.query("alpha")
    await rm(f.derived, { recursive: true })
    const after = f.service()
    expect(await after.startup()).toEqual({ status: "stale", queued: ["wiki/a.md", "wiki/b.md"] })
    await after.rebuild()
    expect(await after.query("alpha")).toEqual(expected)
  })
  it("returns stale Markdown matches during rebuild, never an artificial empty array", async () => {
    const f = await fixture(), service = f.service()
    await service.startup()
    let release!: () => void
    f.gate(new Promise<void>(resolve => { release = resolve }))
    const rebuilding = service.rebuild()
    try { expect(await service.query("alpha")).toEqual({ status: "stale", results: ["alpha first page", "alpha second page"] }) }
    finally { release(); await rebuilding }
  })
  it("unknown is never ready and does not call vector search", async () => {
    const f = await fixture(), service = f.service()
    expect(service.status()).toBe("unknown")
    expect((await service.query("alpha")).status).toBe("stale")
    expect(f.ports.search).not.toHaveBeenCalled()
  })
  it("retries only the failed page without rerunning successful steps", async () => {
    const f = await fixture(), service = f.service()
    f.fail("wiki/b.md")
    await service.startup()
    await expect(service.rebuild()).rejects.toThrow("1 page(s)")
    expect(service.status()).toBe("stale")
    expect(service.queued()).toEqual(["wiki/b.md"])
    f.fail("")
    await service.rebuild()
    expect(vi.mocked(f.ports.index.commitPage).mock.calls.map(([input]) => input.relativePath)).toEqual(["wiki/a.md", "wiki/b.md", "wiki/b.md"])
    expect(service.status()).toBe("ready")
  })
  it("corrupt evidence and corrupt derived pages queue rebuild instead of ready", async () => {
    const f = await fixture()
    await rebuildIndex(f.root, f.config, f.ports)
    await writeFile(join(f.derived, "a.md.json"), "broken")
    const service = f.service()
    expect((await service.startup()).queued).toEqual(["wiki/a.md"])
    await writeFile(join(f.derived, "evidence.json"), "broken")
    expect((await f.service().startup()).queued).toHaveLength(2)
  })
  it("resumes failed pages after restart using persisted verified evidence", async () => {
    const f = await fixture(), first = f.service()
    f.fail("wiki/b.md")
    await first.startup()
    await expect(first.rebuild()).rejects.toThrow()
    const restarted = f.service()
    expect((await restarted.startup()).queued).toEqual(["wiki/b.md"])
    f.fail("")
    await restarted.rebuild()
    expect(restarted.status()).toBe("ready")
    expect(vi.mocked(f.ports.index.commitPage).mock.calls.map(([input]) => input.relativePath)).toEqual(["wiki/a.md", "wiki/b.md", "wiki/b.md"])
  })
  it("never accepts an unverified commit as ready", async () => {
    const f = await fixture(), service = f.service()
    f.ports.index.verifyPage = async () => ({ status: "corrupt" })
    await service.startup()
    await expect(service.rebuild()).rejects.toThrow()
    expect(service.status()).toBe("stale")
    expect(service.queued()).toHaveLength(2)
  })
})
