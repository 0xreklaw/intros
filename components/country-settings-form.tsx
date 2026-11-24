"use client"

import { useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { CountryPicker } from "@/components/country-picker"
import { FormField } from "@/components/form-field"
import { Notice } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { api } from "@/lib/api"
import type { CountrySettings } from "@/src/clients/countries"

export function CountrySettingsForm({ initial }: { initial: CountrySettings }) {
  const router = useRouter()
  const [blocked, setBlocked] = useState(initial.blocked)
  const [allowed, setAllowed] = useState(initial.allowed)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{
    tone: "success" | "error"
    text: string
  } | null>(null)

  async function save(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setNotice(null)
    try {
      const saved = await api.saveCountrySettings({ blocked, allowed })
      setBlocked(saved.blocked)
      setAllowed(saved.allowed)
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
        <CardTitle>Countries</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="grid gap-4">
          <FormField id="blocked-countries" label="Never show">
            <CountryPicker
              id="blocked-countries"
              value={blocked}
              onChange={setBlocked}
              taken={allowed}
              placeholder="Add a country"
            />
          </FormField>
          <FormField id="allowed-countries" label="Only show">
            <CountryPicker
              id="allowed-countries"
              value={allowed}
              onChange={setAllowed}
              taken={blocked}
              placeholder="Add a country"
            />
          </FormField>
          {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}
          <div>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
