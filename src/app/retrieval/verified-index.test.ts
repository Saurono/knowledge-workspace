import { describe, expect, it, vi } from "vitest"
import type { VerifiedPageIndexCommit } from "@/modules/retrieval/application"
import { createVerifiedPageIndexPort } from "./verified-index"

describe("native verified page index port", () => {
  const config = { enabled: true, endpoint: "http://localhost/v1/embeddings", apiKey: "secret", model: "embed-a" }
  const commit: VerifiedPageIndexCommit = {
    projectPath: "C:/wiki-project",
    pageId: "nested/page",
    contentRevision: "sha256:content",
    configFingerprint: "sha256:config",
    manifestRef: "page-commit-manifests/abc.json",
    expectedChunkCount: 2,
    chunkKeys: ["nested/page#0", "nested/page#1"],
    chunkDigest: "sha256:chunks",
    status: "committed",
  }

  it("commits through the native page embed command and returns its evidence", async () => {
    const invoke = vi.fn().mockResolvedValue(commit)
    const port = createVerifiedPageIndexPort(invoke)

    await expect(port.commitPage({ projectPath: commit.projectPath, relativePath: "wiki/nested/page.md", config }))
      .resolves.toEqual(commit)
    expect(invoke).toHaveBeenCalledWith("embed_wiki_page_verified", {
      projectPath: commit.projectPath,
      relativePath: "wiki/nested/page.md",
      config,
      force: false,
    })
  })

  it("verifies the entire expected evidence against the current native page", async () => {
    const invoke = vi.fn().mockResolvedValue({ status: "verified", manifestRef: commit.manifestRef })
    const port = createVerifiedPageIndexPort(invoke)

    await expect(port.verifyPage({ projectPath: commit.projectPath, relativePath: "wiki/nested/page.md", config, expected: commit }))
      .resolves.toEqual({ status: "verified", manifestRef: commit.manifestRef })
    expect(invoke).toHaveBeenCalledWith("verify_page_index_commit", {
      projectPath: commit.projectPath,
      relativePath: "wiki/nested/page.md",
      config,
      expected: commit,
    })
  })
})
