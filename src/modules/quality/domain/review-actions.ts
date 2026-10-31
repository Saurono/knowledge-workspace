export function actionLooksLikeResearch(action: string): boolean {
  // Skip internal action identifiers
  if (action.startsWith("__")) return false
  const lower = action.toLowerCase()
  return (
    lower.includes("research") ||
    lower.includes("investigate") ||
    lower.includes("explore") ||
    lower.includes("look into") ||
    lower.includes("研究") ||
    lower.includes("调研") ||
    lower.includes("探索")
  )
}

export function actionLooksLikeOpen(action: string): boolean {
  const lower = action.trim().toLowerCase()
  return (
    lower === "open" ||
    lower === "view" ||
    lower === "open page" ||
    lower === "view page" ||
    lower === "打开" ||
    lower === "查看" ||
    lower === "打开页面" ||
    lower === "查看页面"
  )
}

/** Detect if an action is a dismissal (no-op) or should create a page */
export function actionIsDismissal(action: string): boolean {
  const lower = action.toLowerCase()
  return (
    lower === "skip" ||
    lower === "dismiss" ||
    lower === "ignore" ||
    lower === "跳过" ||
    lower === "忽略" ||
    lower === "approve" ||
    lower === "keep existing" ||
    lower === "no"
  )
}

export function actionLooksLikeCreate(action: string): boolean {
  // Anything that isn't a dismissal should create a page
  return !actionIsDismissal(action)
}
