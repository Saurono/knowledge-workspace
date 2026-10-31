import { fileExists, readFile, writeFileAtomic } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"

import { DEFAULT_LINT_CONFIG, normalizeLintConfig } from "@/modules/quality/domain"
import type { WikiCheckConfig as LintConfig } from "@/modules/quality/domain"
export { DEFAULT_LINT_CONFIG, normalizeLintConfig } from "@/modules/quality/domain"
export type { WikiCheckConfig as LintConfig } from "@/modules/quality/domain"

function lintConfigPath(projectPath: string): string {
  return `${normalizePath(projectPath)}/.llm-wiki/lint-config.json`
}

export async function loadLintConfig(projectPath: string): Promise<LintConfig> {
  const path = lintConfigPath(projectPath)
  try {
    if (!(await fileExists(path))) return DEFAULT_LINT_CONFIG
    return normalizeLintConfig(JSON.parse(await readFile(path)) as Partial<LintConfig>)
  } catch (error) {
    console.warn("[lint] failed to load lint config:", error)
    return DEFAULT_LINT_CONFIG
  }
}

export async function saveLintConfig(
  projectPath: string,
  config: LintConfig,
): Promise<LintConfig> {
  const normalized = normalizeLintConfig(config)
  await writeFileAtomic(lintConfigPath(projectPath), JSON.stringify(normalized, null, 2))
  return normalized
}

