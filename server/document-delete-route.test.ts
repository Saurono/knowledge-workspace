import { afterEach, expect, it } from "vitest"
import { accountFixture } from "./testing"

const closers: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of closers.splice(0)) await close() })

async function fixture() {
  const f = await accountFixture()
  closers.push(f.close)
  await f.bootstrap()
  const admin = await f.login()
  const project = await f.json("/projects", "POST", { name: "Delete documents" }, admin.cookie)
  expect(project.response.status).toBe(201)
  const root = `/projects/${project.data.id}/documents`
  const upload = await f.json(root, "POST", "document bytes", admin.cookie, { "x-file-name": "delete.txt" })
  expect(upload.response.status).toBe(201)
  const sourceId = upload.data.data.sourceId
  const documentId = upload.data.data.id
  expect(typeof sourceId).toBe("string")
  expect(typeof documentId).toBe("string")
  const listed = await f.json(root, "GET", undefined, admin.cookie)
  expect(listed.response.status).toBe(200)
  const record = listed.data.find((item: { key: string }) => item.key === documentId)
  expect(record).toBeDefined()
  expect(record.data.sourceId).toBe(sourceId)
  return { f, admin, projectId: project.data.id, root, documentId, record, path: `${root}/${encodeURIComponent(documentId)}` }
}

it("deletes an uploaded document and its upload bytes", async () => {
  const { f, admin, path, record } = await fixture()
  const result = await f.json(path, "DELETE", undefined, admin.cookie, { "If-Match": `"v${record.revision}"` })
  expect(result.response.status).toBe(200)
  expect(result.data).toMatchObject({ removed: true, removedUpload: true, clearedDomainLinks: expect.any(Number) })
  expect(result.data).toHaveProperty("revision")
})

it("omits the deleted document from the list", async () => {
  const { f, admin, path, root, documentId, record } = await fixture()
  expect((await f.request(path, "DELETE", undefined, admin.cookie, { "If-Match": `"v${record.revision}"` })).status).toBe(200)
  const listed = await f.json(root, "GET", undefined, admin.cookie)
  expect(listed.response.status).toBe(200)
  expect(listed.data.some((item: { key: string }) => item.key === documentId)).toBe(false)
})

it("rejects a missing If-Match with precondition_required", async () => {
  const { f, admin, path } = await fixture()
  const result = await f.json(path, "DELETE", undefined, admin.cookie)
  expect(result.response.status).toBe(428)
  expect(result.error.code).toBe("precondition_required")
})

it("rejects a stale revision", async () => {
  const { f, admin, projectId, path, record } = await fixture()
  await f.repository.save(projectId, "document", record.key, record.data, record.revision, f.authentication.now())
  const result = await f.json(path, "DELETE", undefined, admin.cookie, { "If-Match": `"v${record.revision}"` })
  expect(result.response.status).toBe(409)
})

it("rejects an account without documents.write", async () => {
  const { f, admin, projectId, path, record } = await fixture()
  const reader = await f.createAccount(admin.cookie, "reader")
  const state = await f.authentication.catalog.read()
  await f.authentication.catalog.saveMembership(state.revision, { accountId: reader.id, projectId, permissionRole: "viewer", workRoleIds: [] })
  const login = await f.login("reader")
  expect((await f.request(path, "DELETE", undefined, login.cookie, { "If-Match": `"v${record.revision}"` })).status).toBe(403)
})
