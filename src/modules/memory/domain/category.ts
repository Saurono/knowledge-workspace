// 临时词表，来源：reports/memory-system-review-20261110.md 的 M07。
// 管理员给正式方案前允许变更；修改这里必须配一次迁移。
export const MEMORY_CATEGORIES = ["identity", "preference", "fact", "decision", "procedure", "context", "reflection"] as const
export type MemoryCategory = typeof MEMORY_CATEGORIES[number]
export const DEFAULT_MEMORY_CATEGORY: MemoryCategory = "context"
export function isMemoryCategory(value: string): value is MemoryCategory {
  return MEMORY_CATEGORIES.some(category => category === value)
}
export function normalizeMemoryCategory(value: string): MemoryCategory {
  const trimmed = value.trim()
  return isMemoryCategory(trimmed) ? trimmed : DEFAULT_MEMORY_CATEGORY
}
