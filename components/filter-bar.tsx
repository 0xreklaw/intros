"use client"

import { XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { isFiltering, type ReferralFilters } from "@/lib/filters"

type Option = { value: string; label: string }

const NETWORKS: Option[] = [
  { value: "all", label: "All networks" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "x", label: "X" },
  { value: "instagram", label: "Instagram" },
]

const CONNECTIONS: Option[] = [
  { value: "all", label: "Any connection" },
  { value: "mutual", label: "Follow each other" },
  { value: "follower", label: "Follower" },
  { value: "following", label: "Following" },
]

const FITS: Option[] = [
  { value: "0", label: "Any fit" },
  { value: "50", label: "Fit 50+" },
  { value: "70", label: "Fit 70+" },
  { value: "90", label: "Fit 90+" },
]

/** A shadcn select that shows the label of the chosen option. */
function Filter({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string
  value: string
  options: Option[]
  onChange: (value: string) => void
  className?: string
}) {
  return (
    <Select
      value={value}
      items={options}
      onValueChange={(v) => v !== null && onChange(v)}
    >
      <SelectTrigger size="sm" aria-label={label} className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="start" alignItemWithTrigger={false}>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** One row of filters above a list: text, network, kind of tie, verdict and lowest fit. */
export function FilterBar({
  value,
  onChange,
  initial,
  verdicts,
  shown,
  matched,
}: {
  value: ReferralFilters
  onChange: (value: ReferralFilters) => void
  /** What the list starts with, and what Clear goes back to. */
  initial: ReferralFilters
  verdicts: Option[]
  /** Rows on screen. */
  shown: number
  /** Rows that pass the filters, which can be more than are shown. */
  matched: number
}) {
  const set = (patch: Partial<ReferralFilters>) =>
    onChange({ ...value, ...patch })
  const active = isFiltering(value, initial)

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border/50 px-5 py-2">
      <Input
        aria-label="Filter by name, title or reason"
        placeholder="Filter by name or role"
        value={value.text}
        onChange={(e) => set({ text: e.target.value })}
        className="w-48"
      />
      <Filter
        label="Network"
        value={value.platform}
        options={NETWORKS}
        onChange={(platform) =>
          set({ platform: platform as ReferralFilters["platform"] })
        }
        className="w-36"
      />
      <Filter
        label="How they are connected"
        value={value.relationship}
        options={CONNECTIONS}
        onChange={(relationship) =>
          set({ relationship: relationship as ReferralFilters["relationship"] })
        }
        className="w-40"
      />
      <Filter
        label="Verdict"
        value={value.verdict}
        options={verdicts}
        onChange={(verdict) =>
          set({ verdict: verdict as ReferralFilters["verdict"] })
        }
        className="w-36"
      />
      <Filter
        label="Lowest fit"
        value={String(value.minFit)}
        options={FITS}
        onChange={(minFit) => set({ minFit: Number(minFit) })}
        className="w-28"
      />
      <div
        className={cn(
          "ml-auto flex items-center gap-1 text-xs text-muted-foreground tabular-nums",
          !active && "invisible"
        )}
      >
        {matched > shown ? `Top ${shown} of ${matched}` : `${matched} match`}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange(initial)}
          tabIndex={active ? 0 : -1}
        >
          <XIcon />
          Clear
        </Button>
      </div>
    </div>
  )
}
