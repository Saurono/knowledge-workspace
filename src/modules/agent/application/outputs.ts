import { summarizeAgentFileChange } from "../domain"
import type { ChatAgentFileChange } from "../domain"
export function createAgentOutputTracker(ports: {
  read(path: string): Promise<string | null>
  now(): number
  unknownSnapshot: string
}, runId: string) {
  let sequence = 0
  const tracked = new Set<string>(), observed = new Set<string>()
  const chains = new Map<string, Promise<void>>()
  const pending: Promise<void>[] = []
  const changes: Array<{ order: number; change: ChatAgentFileChange }> = []
  const record = (path: string, tool: string, before: string | null | undefined, order: number, timestamp: number) => async () => {
    const after = await ports.read(path)
    if (after === null) return
    const known = before !== undefined
    const change = summarizeAgentFileChange({ id: `${runId}:${path}:${order}`, path, tool, beforeContent: before ?? (known ? null : ""), afterContent: after, timestamp })
    if (!known) {
      change.operation = "modified"
      change.additions = change.deletions = 0
      change.diff = ports.unknownSnapshot
      change.beforeContent = change.afterContent = undefined
    }
    changes.push({ order, change })
  }
  return {
    reference(path: string) {
      if (tracked.has(path) || observed.has(path)) return
      observed.add(path)
      const order = ++sequence, timestamp = ports.now()
      pending.push((async () => {
        const run = record(path, "shell.exec", undefined, order, timestamp)
        if (!tracked.has(path)) await run()
      })())
    },
    changed(path: string, tool: string, existedBefore?: boolean, previousContent?: string) {
      tracked.add(path)
      const order = ++sequence, timestamp = ports.now()
      const before = existedBefore === false ? null : previousContent
      const work = (chains.get(path) ?? Promise.resolve()).then(record(path, tool, before, order, timestamp))
      chains.set(path, work.catch(() => {}))
      pending.push(work)
    },
    async flush(): Promise<ChatAgentFileChange[]> {
      await Promise.allSettled(pending)
      return changes.sort((a, b) => a.order - b.order).map(item => item.change)
    },
  }
}
