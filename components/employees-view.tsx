"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, ChevronRight, Share2 } from "lucide-react"
import { AddEmployeeDialog } from "@/components/forms/add-employee-dialog"
import { EditSocialsDialog } from "@/components/forms/edit-socials-dialog"
import { Notice } from "@/components/page-header"
import { ReferralList } from "@/components/referral-list"
import { Initials } from "@/components/initials"
import { PlatformIcon } from "@/components/platform-icon"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { api } from "@/lib/api"
import { usd } from "@/lib/format"
import { forEmployee } from "@/lib/views"
import {
  PLATFORM_LABEL,
  SOCIAL_PLATFORMS,
  profileUrl,
  type ClientDetail,
  type EmployeeView,
  type ImportResult,
  type ReferralView,
} from "@/src/clients/types"

const hasAccounts = (e: EmployeeView) =>
  Boolean(e.socials.x || e.socials.instagram || e.socials.linkedin)

/**
 * Each employee on their own: their accounts, and everyone they know ranked against the
 * current search, with how they know each person. Also where setup lives: finding connections
 * and adding people or connections by hand.
 */
export function EmployeesView({
  detail,
  results,
  dim,
  onRefresh,
}: {
  detail: ClientDetail
  /** Everyone in the networks, scored against the current search. */
  results: ReferralView[]
  dim: boolean
  /** Called after more detail was fetched for someone, so results rescore. */
  onRefresh: () => void
}) {
  const router = useRouter()
  const { client, employees } = detail
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busy, setBusy] = useState<"network" | null>(null)
  /** The employee whose network is being read right now. */
  const [reading, setReading] = useState<string | null>(null)
  const [notice, setNotice] = useState<{
    tone: "info" | "error" | "success"
    text: string
  } | null>(null)

  /** The page re-reads the networks, and re-runs the search in view. */
  const changed = () => router.refresh()

  /** Read one employee's networks. Takes tens of seconds, so progress is shown as it goes. */
  async function readNetwork(
    employee: EmployeeView,
    position: string
  ): Promise<{ saved: number; cost: number; problem: string | null }> {
    setReading(employee.id)
    setNotice({
      tone: "info",
      text: `Finding ${employee.name ?? "their"} accounts and reading their networks${position}…`,
    })
    const result = await api.importNetwork(client.id, employee.id)
    return {
      saved: result.saved,
      cost: result.costMicro,
      problem: result.ok ? null : result.message,
    }
  }

  /** Find connections for one person. Accounts they are missing are looked up first. */
  async function findFor(employee: EmployeeView) {
    setBusy("network")
    try {
      const r = await readNetwork(employee, "")
      setNotice(
        r.problem
          ? { tone: "error", text: r.problem }
          : {
              tone: "success",
              text: `Saved ${r.saved} connections. Cost ${usd(r.cost)}.`,
            }
      )
    } catch (err) {
      setNotice({ tone: "error", text: (err as Error).message })
    } finally {
      setReading(null)
      setBusy(null)
      changed()
    }
  }

  /**
   * Find everyone's connections in one go: pull the company's people from its website if none
   * are known yet, read each person's networks.
   */
  async function findAll() {
    setBusy("network")
    setNotice(null)
    try {
      let team = employees
      if (!team.length) {
        setNotice({
          tone: "info",
          text: `Finding people at ${client.name}…`,
        })
        const imported: ImportResult = await api.importEmployees(client.id)
        if (!imported.ok) {
          setNotice({ tone: "error", text: imported.message })
          return
        }
        team = (await api.clientDetail(client.id)).employees
      }

      // Everyone is read; accounts they are missing are looked up on the way.
      let saved = 0
      let cost = 0
      const problems: string[] = []
      for (const [i, employee] of team.entries()) {
        const r = await readNetwork(employee, ` (${i + 1} of ${team.length})`)
        saved += r.saved
        cost += r.cost
        if (r.problem) problems.push(r.problem)
      }

      const parts = [
        team.length
          ? `Saved ${saved} connections from ${team.length} ${team.length === 1 ? "person" : "people"} (cost ${usd(cost)}).`
          : "There is no one to read yet. Add a person first.",
        ...problems,
      ].filter(Boolean)
      setNotice({
        tone: problems.length || !team.length ? "error" : "success",
        text: parts.join(" "),
      })
    } catch (err) {
      setNotice({ tone: "error", text: (err as Error).message })
    } finally {
      setReading(null)
      setBusy(null)
      changed()
    }
  }

  const selected = employees.find((e) => e.id === selectedId) ?? null
  const mine = selected ? forEmployee(results, selected.id) : []

  const reader = (e: EmployeeView) => (
    <Button
      variant="outline"
      size="sm"
      onClick={() => findFor(e)}
      disabled={busy !== null}
    >
      {reading === e.id ? "Finding…" : "Find connections"}
    </Button>
  )

  if (selected) {
    return (
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 px-5 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Back to the company"
              onClick={() => setSelectedId(null)}
            >
              <ArrowLeft />
            </Button>
            <Initials name={selected.name} className="size-9" />
            <div className="min-w-0">
              <div className="truncate text-[15px] font-medium tracking-tight">
                {selected.name ?? "Unnamed"}
              </div>
              <div className="truncate text-[13px] text-muted-foreground">
                {selected.title ?? "No title"}
              </div>
            </div>
            <SocialChips socials={selected.socials} />
          </div>
          <div className="flex items-center gap-1">
            <EditSocialsDialog
              key={`${selected.id}:${JSON.stringify(selected.socials)}`}
              employee={selected}
            />
            {reader(selected)}
          </div>
        </div>
        {notice ? (
          <div className="border-b border-border/50 px-5 py-3">
            <Notice tone={notice.tone}>{notice.text}</Notice>
          </div>
        ) : null}
        {mine.length ? (
          <>
            <div className="border-b border-border/50 px-5 py-2 text-[13px] text-muted-foreground">
              {mine.length} {mine.length === 1 ? "connection" : "connections"},
              best matches for the current search first
            </div>
            <ReferralList
              key={selected.id}
              clientId={client.id}
              results={mine}
              dim={dim}
              onRefresh={onRefresh}
              tieHeader="How they know them"
            />
          </>
        ) : (
          <p className="px-5 py-8 text-center text-[13px] text-muted-foreground">
            {hasAccounts(selected)
              ? "No connections yet. Click Find connections to read who they know."
              : "No accounts yet. Click Find connections to look them up from their name, or add them yourself (the pencil)."}
          </p>
        )}
      </div>
    )
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 px-5 py-2">
        <span className="text-[13px] text-muted-foreground">
          Everyone at {client.name}. Open a person to see who they know.
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={findAll}
            disabled={busy !== null || (!employees.length && !client.domain)}
            title={
              !employees.length && !client.domain
                ? "Add the company's website, or add a person, first"
                : undefined
            }
          >
            <Share2 />
            {busy === "network" ? "Finding connections…" : "Find connections"}
          </Button>
          <AddEmployeeDialog clientId={client.id} />
        </div>
      </div>
      {notice ? (
        <div className="border-b border-border/50 px-5 py-3">
          <Notice tone={notice.tone}>{notice.text}</Notice>
        </div>
      ) : null}
      {employees.length === 0 ? (
        <p className="px-5 py-8 text-center text-[13px] text-muted-foreground">
          {client.domain
            ? "Click Find connections to import people from the company's website, or add a person by name."
            : "Add the first person at this company."}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[28%]">Name</TableHead>
              <TableHead className="hidden md:table-cell">Accounts</TableHead>
              <TableHead className="w-32 text-right">Connections</TableHead>
              <TableHead className="w-32 text-right">Good matches</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {employees.map((e) => {
              const good = forEmployee(results, e.id).filter(
                (r) => r.recommendation === "ask"
              ).length
              return (
                <TableRow
                  key={e.id}
                  className="h-12 cursor-pointer"
                  onClick={() => setSelectedId(e.id)}
                >
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <Initials name={e.name} />
                      <div className="min-w-0">
                        <div className="truncate font-medium text-foreground">
                          {e.name ?? "Unnamed"}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {e.title ?? "No title"}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <SocialChips socials={e.socials} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {e.connectionCount}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {good || "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    <ChevronRight className="size-4" />
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
    </div>
  )
}

function SocialChips({ socials }: { socials: EmployeeView["socials"] }) {
  const items = [
    ...SOCIAL_PLATFORMS.map((platform) => ({
      platform,
      href: socials[platform] && profileUrl(platform, socials[platform]),
    })),
  ]
  return (
    <div className="flex items-center gap-1.5">
      {items.map(({ platform, href }) =>
        href ? (
          <a
            key={platform}
            href={href}
            target="_blank"
            rel="noreferrer"
            title={PLATFORM_LABEL[platform]}
            onClick={(e) => e.stopPropagation()}
          >
            <PlatformIcon platform={platform} />
          </a>
        ) : (
          <PlatformIcon
            key={platform}
            platform={platform}
            className="opacity-20 grayscale"
          />
        )
      )}
    </div>
  )
}
