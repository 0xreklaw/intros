"use client"

import { useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { FormError, FormField } from "@/components/form-field"
import { PlatformIcon } from "@/components/platform-icon"
import { api } from "@/lib/api"
import type { EmployeeView } from "@/src/clients/types"

export function EditSocialsDialog({ employee }: { employee: EmployeeView }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({
    x: employee.socials.x ?? "",
    instagram: employee.socials.instagram ?? "",
    linkedin: employee.socials.linkedin ?? "",
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await api.setEmployeeSocials(employee.clientId, employee.id, form)
      setOpen(false)
      router.refresh()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button variant="ghost" size="icon-sm" />}
        aria-label={`Edit accounts for ${employee.name ?? "employee"}`}
      >
        <Pencil />
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Accounts for {employee.name}</DialogTitle>
          </DialogHeader>
          <FormField
            id="soc-x"
            label="X handle"
            icon={<PlatformIcon platform="x" className="size-4" />}
          >
            <Input
              id="soc-x"
              value={form.x}
              onChange={(e) => setForm({ ...form, x: e.target.value })}
              placeholder="jane"
            />
          </FormField>
          <FormField
            id="soc-ig"
            label="Instagram handle"
            icon={<PlatformIcon platform="instagram" className="size-4" />}
          >
            <Input
              id="soc-ig"
              value={form.instagram}
              onChange={(e) => setForm({ ...form, instagram: e.target.value })}
              placeholder="jane"
            />
          </FormField>
          <FormField
            id="soc-li"
            label="LinkedIn handle"
            icon={<PlatformIcon platform="linkedin" className="size-4" />}
          >
            <Input
              id="soc-li"
              value={form.linkedin}
              onChange={(e) => setForm({ ...form, linkedin: e.target.value })}
              placeholder="jane-doe"
            />
          </FormField>
          <FormError message={error} />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save accounts"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
