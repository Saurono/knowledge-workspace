import { createDirectory, fileExists, readFile, writeFileAtomic } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import { withProjectLock } from "@/lib/project-mutex"
import { emptyWorkspaceData, validateWorkspaceData, type WorkspaceData } from "./snapshot"
const dataPath = (projectPath: string) => `${normalizePath(projectPath)}/.llm-wiki/workspace.json`
export async function loadWorkspaceData(projectPath: string): Promise<WorkspaceData> {
  if (!(await fileExists(dataPath(projectPath)))) return emptyWorkspaceData()
  return validateWorkspaceData(JSON.parse(await readFile(dataPath(projectPath))))
}
export async function updateWorkspaceData(
  projectPath: string,
  update: (data: WorkspaceData) => WorkspaceData,
): Promise<WorkspaceData> {
  return withProjectLock(`${normalizePath(projectPath)}\0workspace-data`, async () => {
    const data = validateWorkspaceData(update(await loadWorkspaceData(projectPath)))
    await createDirectory(`${normalizePath(projectPath)}/.llm-wiki`)
    await writeFileAtomic(dataPath(projectPath), JSON.stringify(data, null, 2))
    return data
  })
}
