export type { WikiProject } from "@/modules/projects/domain"

export interface FileNode {
  name: string
  path: string
  is_dir: boolean
  children?: FileNode[]
}

export type { WikiPage } from "@/modules/wiki/domain"
