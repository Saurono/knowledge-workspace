import type { DomainFilterOption } from "./domain-filter"

export function ResourceDomainAssignment({
  label,
  domains,
  selectedIds,
  onChange,
  disabled = false,
}: {
  label: string
  domains: DomainFilterOption[]
  selectedIds: string[]
  onChange: (ids: string[]) => void
  disabled?: boolean
}) {
  return (
    <details
      name="resource-domain-assignment"
      className="relative shrink-0 text-xs"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !event.currentTarget.open) return
        event.preventDefault()
        event.currentTarget.open = false
        event.currentTarget.querySelector("summary")?.focus()
      }}
      onBlur={(event) => {
        const next = event.relatedTarget
        if (next && event.currentTarget.contains(next)) return
        event.currentTarget.open = false
      }}
    >
      <summary
        className="cursor-pointer list-none rounded px-1.5 py-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`设置领域归类：${label}`}
        title="设置领域归类"
      >
        领域{selectedIds.length ? ` · ${selectedIds.length}` : ""}
      </summary>
      <fieldset disabled={disabled} className="absolute right-0 z-20 mt-1 min-w-44 rounded-md border bg-popover p-2 text-popover-foreground shadow-md">
        <legend className="px-1 font-medium">{label}的领域归类</legend>
        {domains.length ? domains.map((domain) => (
          <label key={domain.id} className="flex cursor-pointer items-center gap-2 px-1 py-1">
            <input
              type="checkbox"
              checked={selectedIds.includes(domain.id)}
              aria-label={`${label}：${domain.name}`}
              onChange={(event) => onChange(event.target.checked
                ? [...new Set([...selectedIds, domain.id])]
                : selectedIds.filter((id) => id !== domain.id))}
            />
            {domain.name}
          </label>
        )) : <p className="px-1 py-1 text-muted-foreground">暂无领域，请先创建领域。</p>}
      </fieldset>
    </details>
  )
}
