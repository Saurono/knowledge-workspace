import { useWikiStore } from "@/stores/wiki-store"
import { normalizePath } from "@/lib/path-utils"
let projectEpoch = 0
useWikiStore.subscribe((next, previous) => {
  if (next.project?.id !== previous.project?.id || next.project?.path !== previous.project?.path) ++projectEpoch
})
export function qualityScope(path: string) {
  const epoch = projectEpoch
  return () => epoch === projectEpoch && normalizePath(useWikiStore.getState().project?.path ?? "") === normalizePath(path)
}
