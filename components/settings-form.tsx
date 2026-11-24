"use client"

import { useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { Notice } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { FormField } from "@/components/form-field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/lib/api"
import {
  MAX_SEARCH_BUDGET_MICRO,
  type SearchSettings,
} from "@/src/clients/types"

export function SettingsForm({ initial }: { initial: SearchSettings }) {
  const router = useRouter()
  const [query, setQuery] = useState(initial.query)
  const [budget, setBudget] = useState(String(initial.budgetMicro / 1_000_000))
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{
    tone: "success" | "error"
    text: string
  } | null>(null)

  async function save(e: FormEvent) {
    e.preventDefault()
    const dollars = Number(budget)
    const budgetMicro = Math.round(dollars * 1_000_000)
    if (
      !budget.trim() ||
      !Number.isFinite(dollars) ||
      budgetMicro < 0 ||
      budgetMicro > MAX_SEARCH_BUDGET_MICRO
    ) {
      setNotice({
        tone: "error",
        text: `The budget must be between $0 and $${MAX_SEARCH_BUDGET_MICRO / 1_000_000}.`,
      })
      return
    }
    setSaving(true)
    setNotice(null)
    try {
      await api.saveSearchSettings({ query: query.trim(), budgetMicro })
      setNotice({
        tone: "success",
        text: "Saved.",
      })
      router.refresh()
    } catch (err) {
      setNotice({ tone: "error", text: (err as Error).message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Search</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="grid gap-4">
          <FormField id="default-search" label="Who are you looking for?">
            <Textarea
              id="default-search"
              required
              rows={2}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Founders and business owners"
            />
          </FormField>
          <FormField id="search-budget" label="Profile budget per search (USD)">
            <Input
              id="search-budget"
              type="number"
              inputMode="decimal"
              min={0}
              max={MAX_SEARCH_BUDGET_MICRO / 1_000_000}
              step="0.01"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              className="max-w-32"
            />
          </FormField>
          {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}
          <div>
            <Button type="submit" disabled={saving || !query.trim()}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
