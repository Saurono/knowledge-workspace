import { appendWikilink, rewriteWikilinkTarget } from "../domain"
import type { QualityItem } from "../domain"
export interface RepairPorts {
  transform(path: string, change: (content: string) => string): Promise<{ changed: boolean }>
  stub(target: string): Promise<{ relativePath: string; created: boolean }>
  review(item: QualityItem): void
  remove(ids: string[]): void
  isCurrent(): boolean
  changed(): void
}
/** Group transforms per page; completed pages are acknowledged even if a later page fails. */
export function createQualityRepairs(ports: RepairPorts) {
  const check = () => { if (!ports.isCurrent()) throw new DOMException("Repair scope changed", "AbortError") }
  return {
    async repair(items: readonly QualityItem[]) {
      const edits = new Map<string, Array<{ id: string; apply(content: string): string }>>()
      const queue = (path: string, id: string, apply: (content: string) => string) => {
        const pending = edits.get(path) ?? []
        pending.push({ id, apply }); edits.set(path, pending)
      }
      for (const item of items) {
        check()
        if (item.type === "orphan" && item.suggestedSource) {
          queue(item.suggestedSource, item.id, content => appendWikilink(content, item.page))
        } else if (item.type === "no-outlinks" && item.suggestedTarget) {
          queue(item.page, item.id, content => appendWikilink(content, item.suggestedTarget!))
        } else if (item.type === "broken-link" && item.brokenTarget) {
          const stub = item.suggestedTarget ? null : await ports.stub(item.brokenTarget)
          if (stub?.created) ports.changed()
          check()
          const target = item.suggestedTarget ?? stub!.relativePath
          queue(item.page, item.id, content => rewriteWikilinkTarget(content, item.brokenTarget!, target))
        } else {
          ports.review(item); ports.remove([item.id])
        }
      }
      for (const [path, pending] of edits) {
        check()
        const result = await ports.transform(path, original => pending.reduce((content, edit) => edit.apply(content), original))
        if (result.changed) ports.changed()
        check()
        ports.remove(pending.map(edit => edit.id))
      }
    },
  }
}
