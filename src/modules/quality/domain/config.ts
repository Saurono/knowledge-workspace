import type { WikiCheckConfig as LintConfig } from "./check"

export const DEFAULT_LINT_CONFIG: LintConfig = {
  ignoreOrphan: false,
  ignoreNoOutlinks: false,
  ignorePages: [],
}

export function normalizeLintConfig(config?: Partial<LintConfig> | null): LintConfig {
  return {
    ignoreOrphan: config?.ignoreOrphan === true,
    ignoreNoOutlinks: config?.ignoreNoOutlinks === true,
    ignorePages: [
      ...new Set(
        (config?.ignorePages ?? [])
          .flatMap((value) => value.split(/[,，\n]/))
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ],
  }
}
