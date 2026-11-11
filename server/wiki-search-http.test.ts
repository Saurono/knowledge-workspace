import { expect, it } from "vitest"
import { accountFixture } from "./testing"

it("searches only the credential's project and denies cross-project disclosure", async () => {
  const f = await accountFixture()
  try {
    await f.bootstrap()
    const admin = await f.login()
    await f.createAccount(admin.cookie, "alice")
    await f.createAccount(admin.cookie, "bob")
    const a = await f.login("alice"), b = await f.login("bob")
    const A = (await f.json("/projects", "POST", { name: "A" }, a.cookie)).data
    const B = (await f.json("/projects", "POST", { name: "B" }, b.cookie)).data
    for (const [project, cookie, secret] of [[A, a.cookie, "secretA"], [B, b.cookie, "secretB"]] as const) {
      const saved = await f.json(`/projects/${project.id}/wiki/page?path=wiki/page.md`, "PUT", { content: `${secret} shared` }, cookie, { "If-None-Match": "*" })
      expect(saved.response.status).toBeLessThan(300)
    }
    const result = await f.json(`/projects/${A.id}/retrieval`, "POST", { query: "shared" }, a.cookie)
    expect(result.response.status).toBe(200)
    expect(Object.keys(result.data).sort()).toEqual(["mode", "results", "tokenHits", "vectorHits"])
    expect(result.data).toMatchObject({ mode: "keyword", tokenHits: 1, vectorHits: 0 })
    expect(result.data.results).toHaveLength(1)
    expect(result.data.results[0]).toEqual({ path: "wiki/page.md", title: expect.any(String), snippet: expect.stringContaining("secretA"), titleMatch: expect.any(Boolean), score: expect.any(Number), images: [], projectId: A.id })
    expect(JSON.stringify(result.data)).not.toContain("secretB")
    for (const query of ['他"说', "foo-bar", "foo*bar", "NEAR("]) {
      const special = await f.json(`/projects/${A.id}/retrieval`, "POST", { query }, a.cookie)
      expect(special.response.status).toBe(200)
    }
    const denied = await f.request(`/projects/${A.id}/retrieval`, "POST", { query: "shared" }, b.cookie)
    expect(denied.status).toBe(403)
    expect(await denied.text()).not.toContain("secretA")
  } finally { await f.close() }
})
