"use client"

import { useEffect, useState, type ReactNode } from "react"
import { ExternalLink } from "lucide-react"
import { Initials } from "@/components/initials"
import { PlatformIcon } from "@/components/platform-icon"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { api } from "@/lib/api"
import { RECOMMENDATION_CLASS, pct, tieLabel, usd } from "@/lib/format"
import {
  PLATFORM_LABEL,
  type ProspectProfile,
  type ReferralView,
} from "@/src/clients/types"

/** What one LinkedIn profile costs, shown on the button. */
const PROFILE_COST_MICRO = 1500

/** How the fit was reached, and how far to trust it. */
function fitNote(row: ReferralView): string {
  if (row.fitSource === "none") return "Not enough information to judge."
  if (row.fitSource === "pending") return "Not rated yet."
  const how = row.agentReviewed
    ? "Reviewed in depth by the AI agent."
    : "Read by AI from everything we know."
  return row.confidence === "low"
    ? `${how} Low confidence: the facts are thin${row.canEnrich ? ", and fetching their full profile may change this" : ""}.`
    : how
}

/**
 * A prospect in full, in a side drawer: a written profile, why they match, who can make the
 * intro, and every fact we hold. Opens from any row in a ranked table.
 */
export function ProspectDrawer({
  clientId,
  row,
  onClose,
  onRefresh,
}: {
  clientId: string
  row: ReferralView | null
  onClose: () => void
  /** Called after more detail was fetched, so the tables rescore. */
  onRefresh: () => void
}) {
  const personId = row?.personId ?? null
  const [reload, setReload] = useState(0)
  /** What was loaded, tagged with the request it answers, so a stale answer is never shown. */
  const [loaded, setLoaded] = useState<{
    key: string
    profile?: ProspectProfile
    error?: string
  } | null>(null)
  const [action, setAction] = useState<{
    personId: string
    error: string
  } | null>(null)
  const [fetching, setFetching] = useState(false)

  const key = personId ? `${personId}:${reload}` : null
  const current = loaded?.key === key ? loaded : null
  const profile = current?.profile ?? null
  const error =
    (action?.personId === personId ? action.error : null) ??
    current?.error ??
    null

  useEffect(() => {
    if (!personId || !key) return
    let cancelled = false
    api
      .prospect(clientId, personId)
      .then((p) => !cancelled && setLoaded({ key, profile: p }))
      .catch(
        (err: Error) => !cancelled && setLoaded({ key, error: err.message })
      )
    return () => {
      cancelled = true
    }
  }, [clientId, personId, key])

  async function fetchMore() {
    if (!personId) return
    setFetching(true)
    setAction(null)
    try {
      const summary = await api.enrich(clientId, [personId], false)
      const problem = summary.errors[0]
      if (problem) setAction({ personId, error: problem })
      setReload((n) => n + 1)
      onRefresh()
    } catch (err) {
      setAction({ personId, error: (err as Error).message })
    } finally {
      setFetching(false)
    }
  }

  const name = row?.name ?? profile?.name ?? "Unnamed"
  const headline =
    [row?.title, row?.company].filter(Boolean).join(" at ") ||
    profile?.headline ||
    "No details yet"

  return (
    <Sheet open={row !== null} onOpenChange={(open) => !open && onClose()}>
      {/* The sheet sets its own width per side, so override with the same variants. */}
      <SheetContent className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-3xl">
        {row ? (
          <>
            <SheetHeader className="gap-3 border-b border-border/50 p-5 pr-14">
              <div className="flex items-start gap-3">
                <Initials name={name} className="size-11 text-sm" />
                <div className="min-w-0 flex-1">
                  <SheetTitle className="truncate text-[17px] tracking-tight">
                    {name}
                  </SheetTitle>
                  <SheetDescription className="text-[13px]">
                    {headline}
                  </SheetDescription>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Badge className={RECOMMENDATION_CLASS[row.recommendation]}>
                    {row.recommendationLabel}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    Fit {Math.round(row.fit * 100)}
                  </span>
                </div>
              </div>
              {(profile?.profiles ?? row.profiles).length ? (
                <div className="flex flex-wrap gap-2">
                  {(profile?.profiles ?? row.profiles).map((p) => (
                    <a
                      key={p.url}
                      href={p.url}
                      target="_blank"
                      rel="noreferrer"
                      className={buttonVariants({
                        variant: "outline",
                        size: "sm",
                      })}
                    >
                      <PlatformIcon
                        platform={p.platform}
                        className="size-4 rounded-[4px]"
                      />
                      {PLATFORM_LABEL[p.platform]}
                      <ExternalLink className="text-muted-foreground" />
                    </a>
                  ))}
                </div>
              ) : null}
            </SheetHeader>

            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-5">
              <Section
                title="Profile"
                aside={
                  profile?.brief.source === "ai" ? (
                    <span className="text-xs text-muted-foreground">
                      Written by AI
                    </span>
                  ) : profile ? (
                    <span className="text-xs text-muted-foreground">
                      From what we know
                    </span>
                  ) : null
                }
              >
                {profile ? (
                  <p className="text-[13px] leading-relaxed whitespace-pre-line">
                    {profile.brief.text}
                  </p>
                ) : error ? null : (
                  <div className="space-y-2">
                    <Skeleton className="h-3.5 w-full" />
                    <Skeleton className="h-3.5 w-full" />
                    <Skeleton className="h-3.5 w-3/4" />
                  </div>
                )}
              </Section>

              <Section title="Why they match">
                <p className="text-[13px] leading-relaxed">{row.reason}</p>
                <div className="mt-3 grid gap-2">
                  <Meter label="Fit" value={row.fit} />
                  <Meter label="Closeness" value={row.warmth} />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {fitNote(row)}
                </p>
              </Section>

              <Section title="Who can make the intro">
                <ul className="divide-y divide-border/50 rounded-md border border-border/60">
                  {row.paths.map((p, i) => (
                    <li
                      key={`${p.employeeId}:${p.platform}:${p.relationshipType}`}
                      className="flex items-center gap-3 px-3 py-2.5"
                    >
                      <PlatformIcon
                        platform={p.platform}
                        className="size-6 rounded-md"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-medium">
                          {p.employeeName ?? "Someone"}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {tieLabel(p)}
                        </div>
                      </div>
                      {i === 0 && row.paths.length > 1 ? (
                        <Badge variant="secondary" className="text-[10px]">
                          Best path
                        </Badge>
                      ) : null}
                      <span className="w-10 text-right text-xs text-muted-foreground tabular-nums">
                        {pct(p.strength)}
                      </span>
                    </li>
                  ))}
                </ul>
              </Section>

              <Section title="Everything we know">
                {profile ? (
                  <Facts profile={profile} />
                ) : error ? (
                  <p className="text-[13px] text-destructive">{error}</p>
                ) : (
                  <div className="space-y-2">
                    <Skeleton className="h-3.5 w-2/3" />
                    <Skeleton className="h-3.5 w-1/2" />
                    <Skeleton className="h-3.5 w-3/5" />
                  </div>
                )}
              </Section>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-border/50 px-5 py-3">
              <p className="text-xs text-muted-foreground">
                {row.canEnrich
                  ? "Fetch their full LinkedIn profile to fill in more."
                  : row.enriched
                    ? "Full LinkedIn profile fetched."
                    : "No LinkedIn profile on file to fetch."}
              </p>
              {row.canEnrich ? (
                <Button onClick={fetchMore} disabled={fetching}>
                  {fetching
                    ? "Fetching…"
                    : `Get more detail · ${usd(PROFILE_COST_MICRO)}`}
                </Button>
              ) : null}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

function Section({
  title,
  aside,
  children,
}: {
  title: string
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          {title}
        </h3>
        {aside}
      </div>
      {children}
    </section>
  )
}

function Meter({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="w-16 text-muted-foreground">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-foreground/70"
          style={{ width: pct(value) }}
        />
      </div>
      <span className="w-9 text-right tabular-nums">{pct(value)}</span>
    </div>
  )
}

/** Every fact we hold, as labelled rows. Rows with nothing to show are left out. */
function Facts({ profile: p }: { profile: ProspectProfile }) {
  const rows: [string, ReactNode][] = [
    ["Title", p.title],
    ["Company", p.company],
    ["Industry", p.industry],
    ["Location", p.location],
    ["Headline", p.headline],
    [
      "About",
      p.about ? <span className="whitespace-pre-line">{p.about}</span> : null,
    ],
    [
      "Experience",
      p.experience.length ? (
        <ul className="space-y-1">
          {p.experience.map((e, i) => (
            <li key={i}>
              <span className="font-medium">{e.title ?? "Role unknown"}</span>
              <span className="text-muted-foreground"> at {e.company}</span>
              {e.period ? (
                <span className="text-muted-foreground"> · {e.period}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null,
    ],
    [
      "Skills",
      p.skills.length ? (
        <div className="flex flex-wrap gap-1">
          {p.skills.map((s) => (
            <Badge key={s} variant="secondary" className="font-normal">
              {s}
            </Badge>
          ))}
        </div>
      ) : null,
    ],
    [
      "Profile fetched",
      p.enrichedAt ? new Date(p.enrichedAt).toLocaleDateString() : null,
    ],
  ]
  const shown = rows.filter(([, value]) => value)
  if (!shown.length)
    return (
      <p className="text-[13px] text-muted-foreground">
        Nothing beyond a name yet.
      </p>
    )
  return (
    <dl className="divide-y divide-border/50 rounded-md border border-border/60">
      {shown.map(([label, value]) => (
        <div
          key={label}
          className="grid grid-cols-[6.5rem_1fr] gap-3 px-3 py-2 text-[13px]"
        >
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="min-w-0">{value}</dd>
        </div>
      ))}
    </dl>
  )
}
