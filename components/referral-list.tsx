"use client"

import { useMemo, useState } from "react"
import { ChevronRight } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { FilterBar } from "@/components/filter-bar"
import { Initials } from "@/components/initials"
import { PlatformIcon } from "@/components/platform-icon"
import { ProspectDrawer } from "@/components/prospect-drawer"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { RECOMMENDATION_LABEL } from "@/src/intelligence/verdict"
import {
  RECOMMENDATION_CLASS,
  RELATIONSHIP_LABEL,
  pathLabel,
} from "@/lib/format"
import { NO_FILTERS, applyFilters, type ReferralFilters } from "@/lib/filters"
import type { ReferralView } from "@/src/clients/types"

/**
 * Ranked people, best first. One line each: who, why, who to ask for the intro, and the
 * verdict. Clicking a row opens the full prospect in a side drawer. `tieHeader` names the
 * "who to ask" column; for one employee's list it reads as how that employee knows them.
 */
export function ReferralList({
  clientId,
  results,
  dim,
  onRefresh,
  tieHeader = "Ask for the intro",
  limit,
  initialVerdict = "all",
}: {
  clientId: string
  results: ReferralView[]
  dim: boolean
  /** Called after more detail was fetched for someone, so the page rescores. */
  onRefresh: () => void
  tieHeader?: string
  /** Show at most this many rows, after filtering. */
  limit?: number
  /** The verdict the list starts on. Top picks starts on "top". */
  initialVerdict?: ReferralFilters["verdict"]
}) {
  const initial = useMemo(
    () => ({ ...NO_FILTERS, verdict: initialVerdict }),
    [initialVerdict]
  )
  const [filters, setFilters] = useState<ReferralFilters>(initial)
  const matched = useMemo(
    () => applyFilters(results, filters),
    [results, filters]
  )
  const shown = limit ? matched.slice(0, limit) : matched
  const [opened, setOpened] = useState<ReferralView | null>(null)
  // Follow the row through rescoring. If a refresh drops it from this table (their verdict
  // changed), keep showing the last version rather than closing the drawer under the user.
  const open = opened
    ? (results.find((r) => r.personId === opened.personId) ?? opened)
    : null

  return (
    <>
      <FilterBar
        value={filters}
        onChange={setFilters}
        initial={initial}
        verdicts={[
          { value: "all", label: "Any verdict" },
          { value: "top", label: "Top picks" },
          { value: "ask", label: RECOMMENDATION_LABEL.ask },
          { value: "maybe", label: RECOMMENDATION_LABEL.maybe },
          { value: "skip", label: RECOMMENDATION_LABEL.skip },
        ]}
        shown={shown.length}
        matched={matched.length}
      />
      <Table
        className={`table-fixed transition-opacity ${dim ? "opacity-50" : ""}`}
      >
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-[30%] md:w-[24%]">Person</TableHead>
            <TableHead className="hidden md:table-cell">Why</TableHead>
            <TableHead className="w-[30%]">{tieHeader}</TableHead>
            <TableHead className="w-14 text-right">Fit</TableHead>
            <TableHead className="w-32">Verdict</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.map((r) => (
            <Row key={r.personId} r={r} onOpen={() => setOpened(r)} />
          ))}
        </TableBody>
      </Table>
      {!shown.length ? (
        <p className="px-5 py-8 text-center text-[13px] text-muted-foreground">
          Nobody matches these filters.
        </p>
      ) : null}
      <ProspectDrawer
        clientId={clientId}
        row={open}
        onClose={() => setOpened(null)}
        onRefresh={onRefresh}
      />
    </>
  )
}

function Row({ r, onOpen }: { r: ReferralView; onOpen: () => void }) {
  const headline =
    [r.title, r.company].filter(Boolean).join(" at ") ||
    r.about?.slice(0, 100) ||
    "No details"
  const first = r.paths[0]
  const more = r.paths.length - 1

  return (
    <TableRow className="h-12 cursor-pointer" onClick={onOpen}>
      <TableCell>
        <div className="flex items-center gap-2.5">
          <Initials name={r.name} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-medium text-foreground">
                {r.name ?? "Unnamed"}
              </span>
              {r.limitedInfo ? (
                <Badge
                  variant="secondary"
                  className="h-4 shrink-0 px-1.5 text-[10px] text-muted-foreground"
                >
                  Limited info
                </Badge>
              ) : null}
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {headline}
            </div>
          </div>
        </div>
      </TableCell>
      <TableCell className="hidden truncate md:table-cell" title={r.reason}>
        {r.reason}
      </TableCell>
      <TableCell title={r.paths.map(pathLabel).join("\n")}>
        {first ? (
          <>
            <div className="flex items-center gap-1.5">
              <span className="truncate font-medium text-foreground">
                {first.employeeName ?? "Someone"}
              </span>
              {more > 0 ? (
                <span className="shrink-0 text-xs text-muted-foreground">
                  +{more} more
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <PlatformIcon
                platform={first.platform}
                className="size-3.5 rounded-[3px]"
              />
              <span className="truncate">
                {RELATIONSHIP_LABEL[first.relationshipType]}
              </span>
            </div>
          </>
        ) : (
          "—"
        )}
      </TableCell>
      <TableCell
        className="text-right font-medium tabular-nums"
        title={
          r.fitSource !== "llm"
            ? "Not rated yet"
            : r.confidence === "low"
              ? "Low confidence: the facts we hold are thin"
              : undefined
        }
      >
        {r.fitSource !== "llm" ? (
          <span className="text-muted-foreground">—</span>
        ) : r.confidence === "low" ? (
          <span className="text-muted-foreground">
            ~{Math.round(r.fit * 100)}
          </span>
        ) : (
          Math.round(r.fit * 100)
        )}
      </TableCell>
      <TableCell>
        <Badge className={RECOMMENDATION_CLASS[r.recommendation]}>
          {r.recommendationLabel}
        </Badge>
      </TableCell>
      <TableCell className="text-muted-foreground">
        <ChevronRight className="size-4" />
      </TableCell>
    </TableRow>
  )
}
