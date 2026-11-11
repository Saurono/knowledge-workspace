import { expect, it, vi } from "vitest"
import { createAuthorizedRepository } from "./authorized-repository"
import type { SharedRepository } from "./ports"
import type { AccessContext } from "@/modules/identity/domain"

it("governance workspace denies credentials without memory.write before loading", async () => {
  const load = vi.fn()
  const repository = createAuthorizedRepository({ governanceWorkspace: load } as unknown as SharedRepository,
    async () => ({ projectId: "p", permissions: ["memory.read"] }) as unknown as AccessContext, async () => [], () => "2026-11-10T00:00:00Z")
  await expect(repository.governanceWorkspace("p")).rejects.toMatchObject({ code: "forbidden" })
  expect(load).not.toHaveBeenCalled()
  await expect(repository.governanceSaveWorkspace("p", {} as never, 1)).rejects.toMatchObject({ code: "forbidden" })
})

it("governance reads preserve archived records and writes bypass visible merging", async () => {
  const data = { memories: [{ id: "archived", status: "archived" }] } as never
  const load = vi.fn().mockResolvedValue({ data, revision: 1 })
  const save = vi.fn().mockResolvedValue({ data, revision: 2 })
  const repository = createAuthorizedRepository({ governanceWorkspace: load, save } as unknown as SharedRepository,
    async () => ({ projectId: "p", permissions: ["memory.write"] }) as unknown as AccessContext, async () => [], () => "now")
  await expect(repository.governanceWorkspace("p")).resolves.toEqual({ data, revision: 1 })
  await expect(repository.governanceSaveWorkspace("p", data, 1)).resolves.toEqual({ data, revision: 2 })
  expect(save).toHaveBeenCalledWith("p", "workspace", "default", data, 1, "now")
})
