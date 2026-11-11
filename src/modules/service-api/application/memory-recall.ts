import { buildInjection, createRecallService, type RecallOptions } from "@/modules/memory/application"
import type { AccessContext, MemoryGrant } from "@/modules/identity/domain"
import type { SharedWorkspace } from "./workspace"
import { canAccessMemory } from "./workspace-authorization"

export function recallForContext(workspace: SharedWorkspace, context: AccessContext, grants: MemoryGrant[], options: RecallOptions) {
  const result = createRecallService({ authorize: memory => canAccessMemory(context, memory, grants, options.now, "read") }).recall(workspace.memories, options)
  const recall = { ...result, scope: { ...result.scope, projectId: context.projectId, workRoleId: context.workRoleId, permission: "memory.read" as const } }
  return { injection: buildInjection(recall, { maxChars: options.maxChars ?? Number.MAX_SAFE_INTEGER }), recall }
}
