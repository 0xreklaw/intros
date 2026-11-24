"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { Users } from "lucide-react"
import { Notice, PageBody, PageHeader } from "@/components/page-header"
import { ReferralList } from "@/components/referral-list"
import { SearchComposer } from "@/components/search-composer"
import { EmployeesView } from "@/components/employees-view"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api"
import { usd } from "@/lib/format"
import { cn } from "@/lib/utils"
import { topPicks } from "@/lib/views"
import type { ClientDetail, SearchResponse } from "@/src/clients/types"

type Tab = "company" | "top"

/** How many of the top results "Get more detail" fetches at once. */
const ENRICH_TOP = 25

interface EnrichPlan {
  ids: string[]
  people: number
  costMicro: number
}

export function ClientView({
  detail,
  initial,
}: {
  detail: ClientDetail
  /** The default search as last saved. People not yet read are read on arrival. */
  initial: SearchResponse
}) {
  const { client, employees } = detail
  /** Set once a search has run in the browser; until then the server's results are shown. */
  const [searched, setSearched] = useState<SearchResponse | null>(null)
  const data = searched ?? initial
  /** The custom search in effect, or null for the default. */
  const [custom, setCustom] = useState<string | null>(null)
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  /** What a running search is doing now. */
  const [progress, setProgress] = useState<string | null>(null)
  const [plan, setPlan] = useState<EnrichPlan | null>(null)
  const [enriching, setEnriching] = useState(false)
  const [notice, setNotice] = useState<{
    tone: "info" | "error" | "success"
    text: string
  } | null>(null)
  const [tab, setTab] = useState<Tab>(
    employees.length > 0 && initial.total > 0 ? "top" : "company"
  )
  /** Numbers each search so a slow, older answer can never replace a newer one. */
  const latest = useRef(0)

  async function run(query: string | null) {
    const id = ++latest.current
    setLoading(true)
    setProgress(null)
    try {
      let response = await api.search(client.id, query)
      // People are read a chunk at a time so no request runs long. Show each step as it lands.
      while (
        id === latest.current &&
        response.mode === "llm" &&
        response.pending > 0 &&
        !response.error
      ) {
        setSearched(response)
        setCustom(query)
        setProgress(`Reading people… ${response.pending} to go`)
        const next = await api.search(client.id, query)
        const stuck = next.pending >= response.pending
        response = next
        if (stuck) break
      }
      if (id !== latest.current) return
      setSearched(response)
      setCustom(query)
      if (response.pending > 0 && !response.error)
        setNotice({
          tone: "error",
          text: `${response.pending} people could not be read. Search again to retry.`,
        })

      // Everyone is read: the agent takes a second look at the best matches.
      if (response.mode === "llm" && response.reviewPending) {
        setProgress("Reviewing the best matches…")
        response = await api.search(client.id, query, "review")
        if (id !== latest.current) return
        setSearched(response)
      }
    } catch (err) {
      if (id === latest.current)
        setNotice({ tone: "error", text: (err as Error).message })
    } finally {
      if (id === latest.current) {
        setLoading(false)
        setProgress(null)
      }
    }
  }

  // The server sends fresh data on arrival and after anything changes who is in the networks.
  // Read whoever it could not read from saved judgements, and redo a search the user had already run,
  // so the table always matches what is on screen.
  useEffect(() => {
    // Starting a fetch is the point of this effect.
    const unfinished = initial.pending > 0 || initial.reviewPending
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (unfinished || searched !== null) void run(custom)
    // `run` only closes over the client id and the latest state, so it is not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial])

  function submit() {
    // The answer to a search is the Top picks table, so show it.
    setTab("top")
    setNotice(null)
    setPlan(null)
    void run(input.trim() || null)
  }

  function backToDefault() {
    setTab("top")
    setInput("")
    setNotice(null)
    setPlan(null)
    void run(null)
  }

  /** Ask what fetching more detail would cost before spending anything. */
  async function planEnrich(ids: string[]) {
    setNotice(null)
    try {
      const summary = await api.enrich(client.id, ids, true)
      if (summary.people === 0) {
        setPlan(null)
        setNotice({
          tone: "info",
          text: "Nothing to fetch. These people have no LinkedIn profile on file, or their profile is already fetched.",
        })
        return
      }
      setPlan({ ids, people: summary.people, costMicro: summary.costMicro })
    } catch (err) {
      setNotice({ tone: "error", text: (err as Error).message })
    }
  }

  async function confirmEnrich() {
    if (!plan) return
    setEnriching(true)
    setNotice(null)
    try {
      const summary = await api.enrich(client.id, plan.ids, false)
      setPlan(null)
      await run(custom)
      setNotice({
        tone: summary.errors.length ? "error" : "success",
        text: summary.errors.length
          ? `Fetched ${summary.people} profiles. ${summary.errors[0]}`
          : `Fetched ${summary.people} profiles for ${usd(summary.costMicro)} and rescored.`,
      })
    } catch (err) {
      setNotice({ tone: "error", text: (err as Error).message })
    } finally {
      setEnriching(false)
    }
  }

  const busy = loading || enriching
  const ready = employees.length > 0 && data.total > 0
  const { picks, closest } = topPicks(data.results)

  const topIds = picks
    .filter((r) => r.canEnrich)
    .slice(0, ENRICH_TOP)
    .map((r) => r.personId)

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "company", label: "Company", count: employees.length },
    { id: "top", label: "Top picks", count: picks.length },
  ]

  return (
    <>
      <PageHeader
        title={client.name}
        description={
          [client.domain, client.industry, client.location]
            .filter(Boolean)
            .join(" · ") || undefined
        }
        back={{ href: "/", label: "All clients" }}
      />
      <div className="flex shrink-0 gap-5 border-b border-border/50 px-5">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id ? "page" : undefined}
            className={cn(
              "-mb-px flex h-10 items-center gap-1.5 border-b-2 text-[13px] font-medium transition-colors",
              tab === t.id
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
            <span className="font-normal text-muted-foreground tabular-nums">
              {t.count}
            </span>
          </button>
        ))}
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <PageBody
          className={cn(
            "flex flex-col p-0 sm:p-0",
            ready && "pb-[70px] sm:pb-[70px]"
          )}
        >
          {tab === "top" ? (
            ready && data.mode === "unavailable" ? (
              <EmptyBlock
                icon={<Users className="size-5" />}
                title="AI search is not set up"
                body="Matching people to a search is done by an AI model. Set OPENROUTER_API_KEY in .env and restart the server, then your team's networks are read against the search."
              />
            ) : ready ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 px-5 py-2">
                  <span className="text-[13px] text-muted-foreground">
                    {closest
                      ? `Nobody is a strong match for \u201c${data.query}\u201d. These are the closest.`
                      : `Best matches for \u201c${data.query}\u201d: ${picks.length} of the ${data.total} people your team knows`}
                  </span>
                  {topIds.length ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => planEnrich(topIds)}
                    >
                      Get more detail on {topIds.length}
                    </Button>
                  ) : null}
                </div>
                {picks.length ? (
                  <ReferralList
                    key={closest ? "closest" : "top"}
                    clientId={client.id}
                    results={data.results}
                    limit={picks.length || undefined}
                    initialVerdict={closest ? "all" : "top"}
                    dim={busy}
                    onRefresh={() => void run(custom)}
                  />
                ) : loading || data.pending > 0 ? (
                  <EmptyBlock
                    icon={<Users className="size-5" />}
                    title="Reading your team's networks"
                    body="Every person is rated against the search. The best matches appear here as soon as they are ready."
                  />
                ) : (
                  <EmptyBlock
                    icon={<Users className="size-5" />}
                    title="No matches"
                    body="Nothing in your team's networks fits this search. Try different words below."
                  />
                )}
              </>
            ) : (
              <EmptyBlock
                icon={<Users className="size-5" />}
                title={
                  employees.length ? "No connections yet" : "No people yet"
                }
                body={
                  employees.length
                    ? "Open the Company tab, add each person's accounts and click Find connections. The best matches will appear here."
                    : "Open the Company tab to add people or import them from the company's website, then find their connections."
                }
              />
            )
          ) : null}
          <div className={tab === "company" ? undefined : "hidden"}>
            <EmployeesView
              detail={detail}
              results={data.results}
              dim={busy}
              onRefresh={() => void run(custom)}
            />
          </div>
        </PageBody>
        {ready ? (
          <SearchComposer
            value={input}
            onChange={setInput}
            onSubmit={submit}
            busy={busy}
            isDefault={data.isDefault}
            query={data.query}
            unavailable={data.mode === "unavailable"}
            onBackToDefault={backToDefault}
          >
            {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}
            {data.mode === "unavailable" ? (
              <Notice tone="info">
                Search needs an AI key. Set OPENROUTER_API_KEY in .env and
                restart the server.
              </Notice>
            ) : null}
            {data.hiddenByCountry?.hidden ? (
              <Notice tone="info">
                {data.hiddenByCountry.hidden}{" "}
                {data.hiddenByCountry.hidden === 1 ? "person is" : "people are"}{" "}
                hidden by your country settings
                {data.hiddenByCountry.unknown
                  ? ` (${data.hiddenByCountry.unknown} because we could not tell where they are)`
                  : ""}
                . Change this in Settings.
              </Notice>
            ) : null}
            {data.error ? (
              <Notice tone="error">
                The search hit a problem: {data.error}. What finished before it
                is shown.
              </Notice>
            ) : null}
            {loading ? (
              <Notice tone="info">
                {progress ??
                  `Rating people against \u201c${custom ?? data.query}\u201d…`}
              </Notice>
            ) : data.agent && data.agent.reviewed > 0 && !data.error ? (
              <Notice tone="info">
                The AI agent reviewed {data.agent.reviewed}{" "}
                {data.agent.reviewed === 1 ? "person" : "people"} in depth
                {data.agent.enriched
                  ? `, fetching ${data.agent.enriched} full ${data.agent.enriched === 1 ? "profile" : "profiles"} for ${usd(data.agent.costMicro)}`
                  : ""}
                .
              </Notice>
            ) : null}
            {plan ? (
              <Notice tone="info">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    Fetch {plan.people} LinkedIn{" "}
                    {plan.people === 1 ? "profile" : "profiles"} for about{" "}
                    {usd(plan.costMicro)}? Their scores update afterwards.
                  </span>
                  <span className="flex gap-2">
                    <Button onClick={confirmEnrich} disabled={enriching}>
                      {enriching ? "Fetching…" : "Fetch"}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setPlan(null)}
                      disabled={enriching}
                    >
                      Cancel
                    </Button>
                  </span>
                </div>
              </Notice>
            ) : null}
          </SearchComposer>
        ) : null}
      </div>
    </>
  )
}

function EmptyBlock({
  icon,
  title,
  body,
}: {
  icon: ReactNode
  title: string
  body: string
}) {
  return (
    <div className="flex flex-col items-center gap-1.5 px-6 py-10 text-center">
      <div className="mb-1.5 flex size-10 items-center justify-center rounded-lg border bg-muted/40 text-muted-foreground">
        {icon}
      </div>
      <p className="text-base font-medium tracking-tight">{title}</p>
      <p className="max-w-md text-[13px] leading-snug text-muted-foreground">
        {body}
      </p>
    </div>
  )
}
