import { computeStructuralLint } from "@/modules/quality/domain"
import type { StructuralLintFinding, StructuralLintPage } from "@/modules/quality/domain"
import type { StructuralLintOptions } from "@/modules/quality/application"
export function runStructuralWorker(
  pages: StructuralLintPage[],
  options: StructuralLintOptions,
): Promise<StructuralLintFinding[]> {
  if (typeof Worker === "undefined") {
    return Promise.resolve(computeStructuralLint(pages, options.onProgress, options.config))
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../../lib/lint-structural.worker.ts", import.meta.url), { type: "module" })
    const abort = () => {
      worker.terminate()
      reject(new DOMException("Structural lint cancelled", "AbortError"))
    }
    if (options.signal?.aborted) {
      abort()
      return
    }
    options.signal?.addEventListener("abort", abort, { once: true })
    worker.onerror = (event) => {
      options.signal?.removeEventListener("abort", abort)
      worker.terminate()
      reject(new Error(event.message || "Structural lint worker failed"))
    }
    worker.onmessage = (event: MessageEvent<{
      type: "progress" | "done"
      completed?: number
      total?: number
      findings?: StructuralLintFinding[]
    }>) => {
      if (event.data.type === "progress") {
        options.onProgress?.(event.data.completed ?? 0, event.data.total ?? pages.length)
        return
      }
      options.signal?.removeEventListener("abort", abort)
      worker.terminate()
      resolve(event.data.findings ?? [])
    }
    worker.postMessage({ pages, config: options.config ?? {} })
  })
}
