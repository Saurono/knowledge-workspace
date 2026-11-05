import type { DomainFilter as DomainFilterValue } from "@/modules/domains/domain"

export interface DomainFilterOption {
  id: string
  name: string
}

export function DomainFilter({
  domains,
  value,
  onChange,
  disabled = false,
}: {
  domains: DomainFilterOption[]
  value: DomainFilterValue
  onChange: (value: DomainFilterValue) => void
  disabled?: boolean
}) {
  const updateIds = (id: string, checked: boolean) => {
    const domainIds = checked
      ? [...value.domainIds, id]
      : value.domainIds.filter((current) => current !== id)
    onChange({ ...value, domainIds: [...new Set(domainIds)], unclassified: false })
  }

  return (
    <fieldset disabled={disabled} className="mb-2 rounded border p-2 text-xs">
      <legend className="px-1 font-medium">按领域筛选</legend>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {domains.map((domain) => (
          <label key={domain.id} className="inline-flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={value.domainIds.includes(domain.id)}
              onChange={(event) => updateIds(domain.id, event.target.checked)}
            />
            {domain.name}
          </label>
        ))}
        <label className="inline-flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={value.unclassified}
            onChange={(event) => onChange({ ...value, domainIds: [], unclassified: event.target.checked })}
          />
          未分类
        </label>
        <label className="inline-flex items-center gap-1.5">
          匹配方式
          <select
            aria-label="领域匹配方式"
            className="rounded border bg-background px-1 py-0.5"
            value={value.match}
            onChange={(event) => onChange({ ...value, match: event.target.value as DomainFilterValue["match"] })}
          >
            <option value="any">任一领域</option>
            <option value="all">全部领域</option>
          </select>
        </label>
        <button
          type="button"
          className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          disabled={!value.domainIds.length && !value.unclassified}
          onClick={() => onChange({ domainIds: [], match: "any", unclassified: false })}
        >
          清除筛选
        </button>
      </div>
    </fieldset>
  )
}
