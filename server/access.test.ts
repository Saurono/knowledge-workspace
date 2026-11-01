import { afterEach, describe, expect, it } from "vitest"
import { accountFixture } from "./testing"
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of cleanups.splice(0)) await close() })
describe("server-authenticated access contexts", () => {
  it("captures verified actor rather than client identity headers and requires project membership", async () => {
    const f = await accountFixture(); cleanups.push(f.close); await f.bootstrap(); const admin = await f.login()
    const project = (await f.json("/projects", "POST", { name: "Project" }, admin.cookie)).data
    const state = await f.authentication.catalog.read()
    await f.authentication.catalog.saveMembership(state.revision, { accountId: admin.data.account.id, projectId: project.id, permissionRole: "manager", workRoleIds: [] })
    const result = await f.json(`/projects/${project.id}/access?accountId=spoof`, "GET", undefined, admin.cookie, { "X-Account-Id": "spoof", "X-Role": "admin" })
    expect(result.response.status).toBe(200)
    expect(result.data).toMatchObject({ actorId: admin.data.account.id, effectiveAccountId: admin.data.account.id, projectId: project.id, credential: { channel: "session" } })
    expect((await f.request("/projects/unrelated/access", "GET", undefined, admin.cookie)).status).toBe(403)
  })
})
