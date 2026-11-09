export function formatSourceTimestamp(value: string | null | undefined, unknownLabel: string, locale?: string): string {
  if (!value) return unknownLabel
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return unknownLabel
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date)
}
