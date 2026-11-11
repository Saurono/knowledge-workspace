import { afterEach, expect, it, vi } from "vitest"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createHash } from "node:crypto"
import type { VerifiedPageIndexPort } from "@/modules/retrieval/application"
import { createProjectIndexConsistency } from "./index-consistency"
vi.mock("./search", () => ({ retrievalService: { search: async () => ({ results: [] }) } }))
vi.mock("@/commands/fs", async () => {
  const fs = await import("node:fs/promises")
  const crypto = await import("node:crypto")
  const listDirectory = async (path: string): Promise<unknown[]> => Promise.all((await fs.readdir(path, { withFileTypes: true })).map(async entry => ({ name: entry.name, path: `${path}/${entry.name}`, is_dir: entry.isDirectory(), children: entry.isDirectory() ? await listDirectory(`${path}/${entry.name}`) : undefined })))
  return { listDirectory, readFile: (p: string) => fs.readFile(p, "utf8"), hashFileSha256: async (p: string) => crypto.createHash("sha256").update(await fs.readFile(p)).digest("hex"), fileExists: async (p: string) => fs.stat(p).then(() => true, () => false), createDirectory: (p: string) => fs.mkdir(p, { recursive: true }), writeFileAtomic: async (p: string, text: string) => { await fs.writeFile(`${p}.tmp`, text); await fs.rename(`${p}.tmp`, p) } }
})
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(p => rm(p, { recursive: true, force: true }))) })
async function fixture() {
  const root = (await mkdtemp(join(tmpdir(), "k03b-"))).replace(/\\/g, "/"); roots.push(root)
  await mkdir(`${root}/wiki/nested`, { recursive: true })
  await writeFile(`${root}/wiki/nested/a.md`, "alpha")
  const index: VerifiedPageIndexPort = {
    commitPage: async input => ({ projectPath: root, pageId: "a", contentRevision: createHash("sha256").update(await readFile(`${root}/${input.relativePath}`)).digest("hex"), configFingerprint: "test", manifestRef: "test", expectedChunkCount: 1, chunkKeys: ["0"], chunkDigest: "test", status: "committed" }),
    verifyPage: async () => ({ status: "verified" }),
  }
  return { root, instance: createProjectIndexConsistency(root, { enabled: true, endpoint: "local", apiKey: "", model: "test" }, { index, fs: await import("@/commands/fs"), fileTree: () => [{ path: `${root}/wiki/nested/a.md`, name: "a.md", is_dir: false }] }) }
}
it("stays unknown before startup; missing and deleted evidence queue nested pages and rebuild persists ready", async () => {
  const { root, instance } = await fixture()
  expect(instance.status()).toBe("unknown")
  expect(await instance.startup()).toEqual({ status: "stale", queued: ["wiki/nested/a.md"] })
  await instance.rebuild()
  expect(instance.status()).toBe("ready")
  expect((await instance.startup()).status).toBe("ready")
  await rm(`${root}/.llm-wiki/index-evidence.json`)
  expect((await instance.startup()).queued).toEqual(["wiki/nested/a.md"])
  expect(instance.status()).toBe("stale")
  await instance.rebuild()
  expect(instance.status()).toBe("ready")
})
it("preserves corrupt JSON, stays stale and refuses rebuild evidence overwrite", async () => {
  const { root, instance } = await fixture()
  await mkdir(`${root}/.llm-wiki`)
  await writeFile(`${root}/.llm-wiki/index-evidence.json`, "{broken")
  expect((await instance.startup()).status).toBe("stale")
  await expect(instance.rebuild()).rejects.toThrow("Corrupt index evidence preserved")
  expect(instance.status()).toBe("stale")
  expect(await readFile(`${root}/.llm-wiki/index-evidence.json`, "utf8")).toBe("{broken")
})


it("startup reuses the supplied tree with zero full wiki scans", async () => {
  const fs = await import("@/commands/fs")
  const scan = vi.spyOn(fs, "listDirectory")
  scan.mockClear()
  const { instance } = await fixture()
  await instance.startup()
  expect(scan).toHaveBeenCalledTimes(0)
  scan.mockRestore()
})
