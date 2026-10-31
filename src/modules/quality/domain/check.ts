export interface WikiCheckConfig {
  ignoreOrphan: boolean
  ignoreNoOutlinks: boolean
  ignorePages: string[]
}
export interface QualityFinding {
  type: "orphan" | "broken-link" | "no-outlinks" | "semantic"
  severity: "warning" | "info"
  page: string
  detail: string
  affectedPages?: string[]
  brokenTarget?: string
  suggestedTarget?: string
  suggestedSource?: string
}
