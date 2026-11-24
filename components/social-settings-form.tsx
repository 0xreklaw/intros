"use client"

import { useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { Notice } from "@/components/page-header"
import { PlatformIcon } from "@/components/platform-icon"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { FormField } from "@/components/form-field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api } from "@/lib/api"
import {
  SOCIAL_PLATFORMS,
  type SocialPlatform,
  type SocialSettings,
} from "@/src/clients/types"

const LABEL: Record<SocialPlatform, string> = {
  x: "X",
  instagram: "Instagram",
  linkedin: "LinkedIn",
}

export function SocialSettingsForm({ initial }: { initial: SocialSettings }) {
  const router = useRouter()
  const [platforms, setPlatforms] = useState(initial.platforms)
  const [maxPerList, setMaxPerList] = useState(String(initial.maxPerList))
  const [mutualOnly, setMutualOnly] = useState(initial.mutualOnly)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{
    tone: "success" | "error"
    text: string
  } | null>(null)

  function toggle(platform: SocialPlatform, on: boolean) {
    setPlatforms(
      on ? [...platforms, platform] : platforms.filter((p) => p !== platform)
    )
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setNotice(null)
    try {
      await api.saveSocialSettings({
        platforms,
        maxPerList: Number(maxPerList),
        mutualOnly,
      })
      setNotice({ tone: "success", text: "Saved." })
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
        <CardTitle>Social import</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="grid gap-4">
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {SOCIAL_PLATFORMS.map((p) => (
              <Label key={p} className="gap-2 text-[13px] font-normal">
                <Checkbox
                  checked={platforms.includes(p)}
                  onCheckedChange={(on) => toggle(p, on)}
                />
                <PlatformIcon platform={p} className="size-4" />
                {LABEL[p]}
              </Label>
            ))}
          </div>
          <FormField id="social-max" label="Accounts to read per list">
            <Input
              id="social-max"
              type="number"
              required
              min={10}
              max={2000}
              value={maxPerList}
              onChange={(e) => setMaxPerList(e.target.value)}
              className="w-32"
            />
          </FormField>
          <Label className="gap-2 text-[13px] font-normal">
            <Checkbox checked={mutualOnly} onCheckedChange={setMutualOnly} />
            Mutual follows only
          </Label>
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
