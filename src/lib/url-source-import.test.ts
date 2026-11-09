import { beforeEach, describe, expect, it, vi } from "vitest"

const runtime = vi.hoisted(() => ({
  files: new Map<string, string>(),
  catalog: new Map<string, { id: string; originalPath: string; receivedAt: string | null }>(),
  fetch: vi.fn(),
  write: vi.fn(),
  enqueue: vi.fn(),
  confirm: vi.fn(),
  clock: 0,
}))
vi.mock("@/commands/fs", () => ({ writeFile: runtime.write }))
vi.mock("@/lib/tauri-fetch", () => ({ getHttpFetch: async () => runtime.fetch }))
vi.mock("@/lib/source-lifecycle", () => ({
  enqueueSourceIngest: runtime.enqueue,
  getUniqueDestPath: async (root: string, name: string, known: string[] = []) => {
    const occupied = new Set(known.map((path) => path.toLowerCase()))
    const [stem, ext] = [name.slice(0, name.lastIndexOf(".")), name.slice(name.lastIndexOf("."))]
    let candidate = `${root}/${name}`
    let suffix = 2
    while (occupied.has(candidate.toLowerCase())) candidate = `${root}/${stem}-${suffix++}${ext}`
    return candidate
  },
}))
vi.mock("@/lib/ingest-receipts", () => ({
  documents: {
    pathForOriginalSource: async (_project: string, origin: string) =>
      [...runtime.catalog].find(([, record]) => record.originalPath === origin)?.[0] ?? null,
    list: async () => Object.fromEntries(runtime.catalog),
  },
  reserveImportedSource: async (_project: string, path: string, origin: string) => {
    runtime.catalog.set(path, runtime.catalog.get(path) ?? {
      id: `source-${runtime.catalog.size + 1}`, originalPath: origin, receivedAt: null,
    })
  },
  confirmImportedSource: runtime.confirm,
}))

import { MAX_BATCH_URLS, fetchImportUrl, importSourceUrls, parseImportUrls, urlSourceFileName } from "./url-source-import"

const project = { id: "p1", path: "/p" } as import("@/types/wiki").WikiProject

function response(body = "payload", status = 200) {
  return new Response(body, { status, headers: { "content-type": "text/plain" } })
}

describe("parseImportUrls", () => {
  it("normalizes fragments, removes duplicates, and preserves order", () => {
    expect(parseImportUrls(" https://example.com/a#part\nhttps://example.com/a\nhttp://例子.测试/b ")).toEqual([
      "https://example.com/a",
      "http://xn--fsqu00a.xn--0zwm56d/b",
    ])
  })

  it("rejects malformed and non-http URLs", () => {
    expect(() => parseImportUrls("not-a-url")).toThrow("Invalid URL")
    expect(() => parseImportUrls("file:///tmp/secret")).toThrow("Unsupported URL scheme")
    expect(() => parseImportUrls("https://user:secret@example.com/page")).toThrow("embedded credentials")
  })

  it("caps batch size", () => {
    const urls = Array.from({ length: MAX_BATCH_URLS + 1 }, (_, index) => `https://example.com/${index}`)
    expect(() => parseImportUrls(urls.join("\n"))).toThrow(`at most ${MAX_BATCH_URLS}`)
  })
})

describe("urlSourceFileName", () => {
  it("prefers a safe HTML title", () => {
    expect(urlSourceFileName(
      "https://example.com/post/123",
      "text/html; charset=utf-8",
      "<html><head><title>安全 / Useful: Guide</title></head></html>",
    )).toBe("安全-Useful-Guide.html")
  })

  it("uses the URL leaf for plain text", () => {
    expect(urlSourceFileName("https://example.com/docs/readme.md", "text/plain", "hello"))
      .toBe("readme.txt")
  })

  it("avoids Windows reserved names and tolerates malformed escapes", () => {
    expect(urlSourceFileName("https://example.com/AUX", "text/plain", "hello"))
      .toBe("AUX-web.txt")
    expect(urlSourceFileName("https://example.com/bad%escape", "text/plain", "hello"))
      .toBe("bad-escape.txt")
  })
})

describe("importSourceUrls entrypoint", () => {
  beforeEach(() => {
    runtime.files.clear()
    runtime.catalog.clear()
    runtime.clock = 0
    vi.resetAllMocks()
    runtime.fetch.mockImplementation(async () => response())
    runtime.write.mockImplementation(async (path: string, content: string) => {
      runtime.files.set(path, content)
    })
    runtime.confirm.mockImplementation(async (_project: string, path: string) => {
      const record = runtime.catalog.get(path)
      if (record && record.receivedAt === null) record.receivedAt = `t${++runtime.clock}`
    })
    runtime.enqueue.mockResolvedValue([])
  })

  it("reuses one URL identity and path across retries without resetting first received time", async () => {
    const url = "https://example.com/repeated.txt"
    const first = await importSourceUrls(project, [url], {} as never)
    const path = first[0].path!
    const receivedAt = runtime.catalog.get(path)?.receivedAt
    const second = await importSourceUrls(project, [url], {} as never)

    expect(second[0].path).toBe(path)
    expect(runtime.catalog.size).toBe(1)
    expect(runtime.catalog.get(path)?.receivedAt).toBe(receivedAt)
    expect(runtime.files.get(path)).toContain(`Source URL: ${url}`)
  })

  it("reserves different origins separately even when titles match and the first write fails", async () => {
    runtime.fetch.mockImplementation(async () => new Response(
      "<html><head><title>Same title</title></head></html>",
      { headers: { "content-type": "text/html" } },
    ))
    runtime.write.mockImplementationOnce(async () => { throw new Error("disk full") })
    const urls = ["https://one.example/a", "https://two.example/b"]
    const result = await importSourceUrls(project, urls, {} as never)

    expect(result[0].error).toContain("disk full")
    expect(result[1].path).toBeDefined()
    expect(runtime.catalog.size).toBe(2)
    expect(new Set([...runtime.catalog.keys()]).size).toBe(2)
    expect([...runtime.catalog.values()].map((entry) => entry.originalPath)).toEqual(urls)
    expect(runtime.catalog.get([...runtime.catalog.keys()][0])?.receivedAt).toBeNull()
  })

  it("does not confirm fetch or write failures", async () => {
    runtime.fetch.mockRejectedValueOnce(new Error("offline"))
    const fetchFailure = await importSourceUrls(project, ["https://example.com/fetch"], {} as never)
    expect(fetchFailure[0].error).toContain("offline")
    expect(runtime.confirm).not.toHaveBeenCalled()

    runtime.write.mockRejectedValueOnce(new Error("write failed"))
    const writeFailure = await importSourceUrls(project, ["https://example.com/write"], {} as never)
    expect(writeFailure[0].error).toContain("write failed")
    expect(runtime.confirm).not.toHaveBeenCalled()
    expect([...runtime.catalog.values()].some((record) => record.receivedAt !== null)).toBe(false)
  })

  it("retains written content but reports a receive-confirmation failure", async () => {
    runtime.confirm.mockRejectedValueOnce(new Error("records unavailable"))
    const result = await importSourceUrls(project, ["https://example.com/confirm"], {} as never)
    expect(result[0].error).toContain("records unavailable")
    const path = [...runtime.files.keys()][0]
    expect(runtime.files.get(path)).toContain("Source URL: https://example.com/confirm")
    expect(runtime.catalog.get(path)?.receivedAt).toBeNull()
  })

  it("retries a reserved URL after confirmation failure and timestamps only the successful confirmation", async () => {
    runtime.confirm.mockRejectedValueOnce(new Error("records unavailable"))
    const url = "https://example.com/retry-confirm"
    const failed = await importSourceUrls(project, [url], {} as never)
    const reservedPath = [...runtime.catalog.keys()][0]
    expect(failed[0].error).toContain("records unavailable")
    expect(runtime.catalog.get(reservedPath)?.receivedAt).toBeNull()

    const retried = await importSourceUrls(project, [url], {} as never)
    expect(retried[0].path).toBe(reservedPath)
    expect(runtime.catalog.size).toBe(1)
    expect(runtime.catalog.get(reservedPath)?.receivedAt).toBe("t1")
  })

  it("serializes concurrent imports of one URL to one source identity and destination", async () => {
    const url = "https://example.com/concurrent"
    const results = await Promise.all([
      importSourceUrls(project, [url], {} as never),
      importSourceUrls(project, [url], {} as never),
    ])
    expect(results[0][0].path).toBe(results[1][0].path)
    expect(runtime.catalog.size).toBe(1)
    expect(runtime.files.size).toBe(1)
    expect(runtime.catalog.values().next().value?.receivedAt).toBe("t1")
  })

  it("reports queue failure while keeping successful receive evidence", async () => {
    runtime.enqueue.mockRejectedValueOnce(new Error("queue unavailable"))
    const result = await importSourceUrls(project, ["https://example.com/queue"], {} as never)
    expect(result[0].error).toContain("Saved, but failed to queue ingest")
    expect(result[0].path).toBeDefined()
    expect(runtime.catalog.get(result[0].path!)?.receivedAt).toBe("t1")
  })
})

describe("fetchImportUrl", () => {
  it("blocks a public URL redirect before requesting a private target", async () => {
    const fetch = async (url: string | URL | Request, init?: RequestInit & { maxRedirections?: number }) => {
      expect(String(url)).toBe("https://example.com/start")
      expect(init).toMatchObject({ redirect: "manual", maxRedirections: 0 })
      return new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data" },
      })
    }
    await expect(fetchImportUrl(fetch as typeof globalThis.fetch, "https://example.com/start", new AbortController().signal))
      .rejects.toThrow("cannot redirect")
  })

  it("blocks IPv4-mapped IPv6 private redirect targets", async () => {
    const fetch = async () => new Response(null, {
      status: 302,
      headers: { location: "http://[::ffff:169.254.169.254]/metadata" },
    })
    await expect(fetchImportUrl(fetch as typeof globalThis.fetch, "https://example.com", new AbortController().signal))
      .rejects.toThrow("cannot redirect")
  })

  it("allows an explicitly requested private URL and follows relative redirects", async () => {
    const seen: string[] = []
    const fetch = async (url: string | URL | Request, init?: RequestInit & { maxRedirections?: number }) => {
      seen.push(String(url))
      expect(init).toMatchObject({ redirect: "manual", maxRedirections: 0 })
      return seen.length === 1
        ? new Response(null, { status: 302, headers: { location: "/page" } })
        : new Response("ok", { status: 200 })
    }
    const response = await fetchImportUrl(
      fetch as typeof globalThis.fetch,
      "http://192.168.1.50/start",
      new AbortController().signal,
    )
    expect(await response.text()).toBe("ok")
    expect(seen).toEqual(["http://192.168.1.50/start", "http://192.168.1.50/page"])
  })
})
