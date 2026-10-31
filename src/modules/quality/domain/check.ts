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
export interface QualityFileNode {
  name: string
  path: string
  is_dir: boolean
  children?: QualityFileNode[]
}
export interface QualityItem extends QualityFinding {
  id: string
  createdAt: number
}
