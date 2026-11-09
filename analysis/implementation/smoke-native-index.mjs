import { createServer } from "node:http"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const cdpUrl = process.env.KW_NATIVE_CDP_URL
if (!cdpUrl) {
  console.error("NOT RUN: KW_NATIVE_CDP_URL is not set; start the isolated Tauri executable with WebView remote debugging enabled.")
  process.exitCode = 2
} else {
  const playwrightModule = process.env.PLAYWRIGHT_MODULE || "playwright-core"
  const { chromium } = await import(playwrightModule).catch(() => { throw new Error(`Cannot load ${playwrightModule}; set PLAYWRIGHT_MODULE to the installed Playwright module`) })
  let browser
  let provider
  try {
    browser = await chromium.connectOverCDP(cdpUrl)
    const pages = browser.contexts().flatMap(context => context.pages())
    let page
    for (const candidate of pages) {
      if (await candidate.evaluate(() => typeof window.__TAURI_INTERNALS__?.invoke === "function").catch(() => false)) { page = candidate; break }
    }
    if (!page) throw new Error("Connected CDP endpoint has no Tauri WebView exposing __TAURI_INTERNALS__.invoke")
    const invoke = (command, args) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args })
    const recheckPath = process.env.KW_NATIVE_RECHECK
    if (recheckPath) {
      const evidence = JSON.parse(await readFile(recheckPath, "utf8"))
      const sourceHash = await invoke("hash_file_sha256", { path: evidence.sourcePath })
      if (sourceHash !== evidence.sourceHash) throw new Error("Independent raw source changed after the indexing process exited")
      const check = await invoke("verify_page_index_commit", { projectPath: evidence.projectPath, relativePath: evidence.relativePath, config: evidence.config, expected: evidence.commit })
      if (check.status !== "verified" || check.manifestRef !== evidence.commit.manifestRef) throw new Error("Saved proof did not survive the app/process restart")
      const search = await invoke("search_project", { projectPath: evidence.projectPath, query: "violet satellite glass map", topK: 5, includeContent: true, queryEmbedding: [1, 0, 0, 0], embeddingConfig: null })
      if (search.vectorHits < 1 || !search.results?.some(result => result.path.replace(/\\/g, "/") === evidence.relativePath)) throw new Error("Restarted LanceDB search did not return the verified page as a vector hit")
      console.log(JSON.stringify({ status: "passed-after-restart", projectPath: evidence.projectPath, relativePath: evidence.relativePath, manifestRef: evidence.commit.manifestRef, vectorHits: search.vectorHits }, null, 2))
    } else {
      let providerFails = false
      provider = createServer(async (request, response) => {
        for await (const _chunk of request) { /* consume request body */ }
        if (providerFails) {
          response.writeHead(503, { "content-type": "application/json" })
          response.end(JSON.stringify({ error: { message: "D09 injected provider failure" } }))
          return
        }
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ data: [{ object: "embedding", index: 0, embedding: [1, 0, 0, 0] }] }))
      })
      await new Promise(resolve => provider.listen(0, "127.0.0.1", resolve))
      const address = provider.address()
      const projectPath = await mkdtemp(join(tmpdir(), "kw-d09-native-index-"))
      const sourcePath = join(projectPath, "raw", "source.md")
      const relativePath = "wiki/codex-native-index-probe.md"
      const pagePath = join(projectPath, relativePath)
      const original = "# Native index probe\n\nThe blue comet carries a copper key."
      const changed = "# Native index probe\n\nThe violet satellite carries a glass map."
      await invoke("write_file_atomic", { path: sourcePath, contents: "Independent raw source; never modified by this harness." })
      const sourceHash = await invoke("hash_file_sha256", { path: sourcePath })
      if (!/^[a-f0-9]{64}$/.test(sourceHash)) throw new Error("Native hash_file_sha256 returned an invalid raw source digest")
      const config = { enabled: true, endpoint: `http://127.0.0.1:${address.port}/v1/embeddings`, apiKey: "local-d09-stub", model: "d09-deterministic", extraHeaders: null }
      await invoke("write_file_atomic", { path: pagePath, contents: original })
      const first = await invoke("embed_wiki_page_verified", { projectPath, relativePath, config, force: true })
      if (first.status !== "committed" || !first.manifestRef || first.expectedChunkCount < 1) throw new Error("Native verified commit returned invalid evidence")
      const firstCheck = await invoke("verify_page_index_commit", { projectPath, relativePath, config, expected: first })
      if (firstCheck.status !== "verified" || firstCheck.manifestRef !== first.manifestRef) throw new Error("Native verified commit did not read back")
      const search = await invoke("search_project", { projectPath, query: "blue comet copper key", topK: 5, includeContent: true, queryEmbedding: [1, 0, 0, 0], embeddingConfig: null })
      if (search.vectorHits < 1 || !search.results?.some(result => result.path.replace(/\\/g, "/") === relativePath)) throw new Error("Native retrieval did not return the page as a vector hit")

      await invoke("write_file_atomic", { path: pagePath, contents: changed })
      const staleCheck = await invoke("verify_page_index_commit", { projectPath, relativePath, config, expected: first })
      if (staleCheck.status !== "corrupt") throw new Error("Editing the Wiki page did not invalidate the old proof")
      providerFails = true
      let rejected = false
      try { await invoke("embed_wiki_page_verified", { projectPath, relativePath, config, force: true }) } catch { rejected = true }
      if (!rejected) throw new Error("Injected embedding provider failure returned a successful commit")
      providerFails = false
      const second = await invoke("embed_wiki_page_verified", { projectPath, relativePath, config, force: true })
      const secondCheck = await invoke("verify_page_index_commit", { projectPath, relativePath, config, expected: second })
      if (secondCheck.status !== "verified" || second.contentRevision === first.contentRevision || second.configFingerprint === first.configFingerprint || second.chunkDigest === first.chunkDigest)
        throw new Error("Reindex did not publish changed content evidence and verify it; manifestRef is stable per page")
      const sourceHashAfter = await invoke("hash_file_sha256", { path: sourcePath })
      if (sourceHashAfter !== sourceHash) throw new Error("Harness unexpectedly changed the independent raw source")
      const evidencePath = process.env.KW_NATIVE_EVIDENCE_PATH || join(projectPath, "native-index-evidence.json")
      await writeFile(evidencePath, JSON.stringify({ projectPath, sourcePath, sourceHash, relativePath, config, commit: second }, null, 2), "utf8")
      console.log(JSON.stringify({ status: "phase1-passed-relaunch-required", projectPath, evidencePath, sourcePath, sourceHash, firstManifest: first.manifestRef, secondManifest: second.manifestRef, retrievalVectorHits: search.vectorHits }, null, 2))
    }
  } catch (error) {
    console.error(`FAILED: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
    process.exitCode = 1
  } finally {
    if (provider) await new Promise(resolve => provider.close(resolve))
    if (browser) await browser.close()
  }
}
