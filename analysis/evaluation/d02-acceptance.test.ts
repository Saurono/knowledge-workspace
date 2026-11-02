import { afterEach, describe, expect, it } from "vitest"
import { createHash } from "node:crypto"
import { accountFixture } from "../../server/testing"

const closers: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of closers.splice(0)) await close() })

async function fixture() {
  const f = await accountFixture()
  closers.push(f.close)
  await f.bootstrap()
  const admin = await f.login()
  const project = (await f.json("/projects", "POST", { name: "D02 upload fixture" }, admin.cookie)).data
  const root = `/projects/${project.id}`
  const upload = (name: string, bytes: string, options: { key?: string; sourceId?: string; createSource?: boolean; mediaType?: string; cookie?: string } = {}) => {
    const headers: Record<string, string> = {
      "X-File-Name": encodeURIComponent(name),
      "Content-Type": options.mediaType ?? "text/markdown",
      ...(options.key ? { "Idempotency-Key": options.key } : {}),
      ...(options.sourceId ? { "X-Source-Id": options.sourceId } : {}),
      ...(options.createSource ? { "X-Create-Source": "1" } : {}),
    }
    return fetch(f.origin + `/api/v1${root}/documents`, {
      method: "POST",
      headers: { Cookie: options.cookie ?? admin.cookie, "X-KW-CSRF": "1", ...headers },
      body: bytes,
    })
  }
  const documents = async () => (await f.json(`${root}/documents`, "GET", undefined, admin.cookie)).data as Array<Record<string, any>>
  const events = async () => (await f.json(`${root}/events`, "GET", undefined, admin.cookie)).data as Array<Record<string, any>>
  const payloadOf = (document: Record<string, any>) => document.data.data as Record<string, any>
  const sourceOf = (document: Record<string, any>) => payloadOf(document).sourceId
  const revisionOf = (document: Record<string, any>) => payloadOf(document).sourceRevision
  const sha256 = (bytes: string) => createHash("sha256").update(bytes).digest("hex")
  const bodyOf = async (response: Response) => await response.json() as { data: Record<string, any> }
  return { ...f, get origin() { return f.origin }, get authentication() { return f.authentication }, admin, project, root, upload, documents, events, sourceOf, revisionOf, sha256, bodyOf }
}

describe("D02 stable source, revision and upload idempotency contracts", () => {
  it("replays a matching idempotency key once, including concurrent HTTP requests", async () => {
    const f = await fixture(), beforeEvents = (await f.events()).length
    const send = () => f.upload("guide.md", "same body", { key: "retry-1" })
    const [a, b, c] = await Promise.all([send(), send(), send()])
    expect([a.status, b.status, c.status].every(status => status >= 200 && status < 300)).toBe(true)
    const keys = (await Promise.all([a, b, c].map(f.bodyOf))).map(x => x.data.key)
    expect(new Set(keys).size).toBe(1)
    expect(await f.documents()).toHaveLength(1)
    expect((await f.events()).length - beforeEvents).toBe(1)
  })

  it("rejects reuse of a key when bytes, name, media type or source intent differs and preserves the original", async () => {
    const f = await fixture()
    const otherSource = await f.bodyOf(await f.upload("other.md", "other source", { key: "other-source", createSource: true }))
    const first = await f.upload("original.md", "original bytes", { key: "semantic-key" })
    expect(first.status).toBe(201)
    const original = (await f.bodyOf(first)).data
    for (const changed of [
      { name: "original.md", bytes: "changed bytes", options: { key: "semantic-key" } },
      { name: "renamed.md", bytes: "original bytes", options: { key: "semantic-key" } },
      { name: "original.md", bytes: "original bytes", options: { key: "semantic-key", mediaType: "text/plain" } },
      { name: "original.md", bytes: "original bytes", options: { key: "semantic-key", createSource: true } },
      { name: "original.md", bytes: "original bytes", options: { key: "semantic-key", sourceId: f.sourceOf(otherSource) } },
    ]) expect((await f.upload(changed.name, changed.bytes, changed.options)).status).toBe(409)
    expect(await f.documents()).toHaveLength(2)
    expect(await (await f.request(`${f.root}/documents/${original.key}/content`, "GET", undefined, f.admin.cookie)).text()).toBe("original bytes")
  })

  it("reuses a source revision across distinct idempotency keys, but never merges separate sources", async () => {
    const f = await fixture()
    const created = await f.bodyOf(await f.upload("same.md", "same bytes", { key: "new-source", createSource: true }))
    const sourceId = f.sourceOf(created)
    expect(sourceId).toBeTruthy()
    expect(f.revisionOf(created)).toBe(f.sha256("same bytes"))
    const sameSource = await f.upload("same.md", "same bytes", { key: "another-key", sourceId })
    expect([200, 201]).toContain(sameSource.status)
    expect((await f.bodyOf(sameSource)).data.key).toBe(created.data.key)
    const separate = await f.bodyOf(await f.upload("same.md", "same bytes", { key: "independent", createSource: true }))
    expect(f.sourceOf(separate)).not.toBe(sourceId)
    expect(separate.data.key).not.toBe(created.data.key)
    expect(f.revisionOf(separate)).toBe(f.sha256("same bytes"))
    expect(await f.documents()).toHaveLength(2)
  })

  it("creates a new document for changed source content and preserves the earlier revision bytes", async () => {
    const f = await fixture()
    const first = await f.bodyOf(await f.upload("draft.md", "revision one", { key: "v1", createSource: true }))
    const sourceId = f.sourceOf(first)
    const secondResponse = await f.upload("draft.md", "revision two", { key: "v2", sourceId })
    expect(secondResponse.status).toBe(201)
    const second = await f.bodyOf(secondResponse)
    expect(second.data.key).not.toBe(first.data.key)
    expect(f.revisionOf(first)).toBe(f.sha256("revision one"))
    expect(f.revisionOf(second)).toBe(f.sha256("revision two"))
    expect(await f.documents()).toHaveLength(2)
    for (const [document, expected] of [[first.data, "revision one"], [second.data, "revision two"]] as const)
      expect(await (await f.request(`${f.root}/documents/${document.key}/content`, "GET", undefined, f.admin.cookie)).text()).toBe(expected)
  })

  it("survives service and SQLite repository restart when an accepted request is replayed", async () => {
    const f = await fixture()
    const first = await f.bodyOf(await f.upload("persist.md", "durable content", { key: "durable-key" }))
    await f.restart()
    const replay = await f.upload("persist.md", "durable content", { key: "durable-key" })
    expect([200, 201]).toContain(replay.status)
    expect((await f.bodyOf(replay)).data.key).toBe(first.data.key)
    expect(await f.documents()).toHaveLength(1)
    expect(await (await f.request(`${f.root}/documents/${first.data.key}/content`, "GET", undefined, f.admin.cookie)).text()).toBe("durable content")
  })

  it("continues an unkeyed legacy source by its returned sourceId, reuses its bytes, then preserves a new revision", async () => {
    const f = await fixture()
    const legacy = await f.bodyOf(await f.upload("legacy.md", "legacy bytes"))
    const sourceId = f.sourceOf(legacy)
    expect(sourceId).toBe(legacy.data.key)
    expect(f.revisionOf(legacy)).toBe(f.sha256("legacy bytes"))
    const replay = await f.bodyOf(await f.upload("legacy.md", "legacy bytes", { key: "legacy-replay", sourceId }))
    expect(replay.data.key).toBe(legacy.data.key)
    expect(f.sourceOf(replay)).toBe(sourceId)
    const revised = await f.bodyOf(await f.upload("legacy.md", "new bytes", { key: "legacy-v2", sourceId }))
    expect(revised.data.key).not.toBe(legacy.data.key)
    expect(f.sourceOf(revised)).toBe(sourceId)
    expect(f.revisionOf(revised)).toBe(f.sha256("new bytes"))
    expect(await f.documents()).toHaveLength(2)
    expect(await (await f.request(`${f.root}/documents/${legacy.data.key}/content`, "GET", undefined, f.admin.cookie)).text()).toBe("legacy bytes")
    expect(await (await f.request(`${f.root}/documents/${revised.data.key}/content`, "GET", undefined, f.admin.cookie)).text()).toBe("new bytes")
  })

  it("rejects unknown and cross-project source IDs without publishing a document", async () => {
    const f = await fixture(), secondProject = (await f.json("/projects", "POST", { name: "Other fixture" }, f.admin.cookie)).data
    const foreignResponse = await fetch(f.origin + `/api/v1/projects/${secondProject.id}/documents`, { method: "POST", headers: {
      Cookie: f.admin.cookie, "X-KW-CSRF": "1", "X-File-Name": "foreign.md", "Content-Type": "text/markdown", "Idempotency-Key": "foreign-create", "X-Create-Source": "1",
    }, body: "foreign" })
    expect(foreignResponse.status).toBe(201)
    const foreign = await f.bodyOf(foreignResponse)
    const foreignId = f.sourceOf(foreign)
    expect([400, 403, 404, 409]).toContain((await f.upload("unknown.md", "x", { key: "unknown", sourceId: "missing-source" })).status)
    const crossProject = await f.upload("cross.md", "x", { key: "cross", sourceId: foreignId })
    expect([400, 403, 404, 409]).toContain(crossProject.status)
    expect(await f.documents()).toHaveLength(0)
  })

  it("checks write authorization before both first acceptance and idempotent replay", async () => {
    const f = await fixture(), user = await f.createAccount(f.admin.cookie, "viewer")
    const userLogin = await f.login("viewer")
    const catalog = await f.authentication.catalog.read()
    await f.authentication.catalog.saveMembership(catalog.revision, { accountId: user.id, projectId: f.project.id, permissionRole: "viewer", workRoleIds: [] })
    const created = await f.bodyOf(await f.upload("guarded.md", "allowed at first", { key: "auth-key" }))
    expect((await f.upload("guarded.md", "allowed at first", { key: "auth-key", cookie: userLogin.cookie })).status).toBe(403)
    await f.request("/auth/logout", "POST", {}, userLogin.cookie)
    const revoked = await f.upload("guarded.md", "allowed at first", { key: "auth-key", cookie: userLogin.cookie })
    expect(revoked.status).toBe(401)
    expect((await f.documents()).map(item => item.key)).toEqual([created.data.key])
  })

  it("reports receive only and never claims that upload completed indexing", async () => {
    const f = await fixture()
    const response = await f.bodyOf(await f.upload("receive-only.md", "not indexed", { key: "receive-only" }))
    expect(response.data.data).toMatchObject({ status: "received", sourceIngestedAt: null })
    const stages = response.data.data.ingestion.stages
    expect(stages.receive.status).toBe("succeeded")
    for (const stage of ["parse", "compile", "index", "feedback"] as const)
      expect(stages[stage].status).not.toBe("succeeded")
  })
})
