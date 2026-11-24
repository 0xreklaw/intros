"use client"

import { useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { FormError, FormField } from "@/components/form-field"
import { api } from "@/lib/api"

const EMPTY = { name: "", domain: "" }

export function AddClientDialog() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const client = await api.createClient({
        name: form.name,
        domain: form.domain,
      })
      setOpen(false)
      setForm(EMPTY)
      router.push(`/clients/${client.id}`)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <Plus />
        Add client
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Add a client company</DialogTitle>
            <DialogDescription>
              Once added, open the client to add its people. We look up their
              accounts and read who they know.
            </DialogDescription>
          </DialogHeader>
          <FormField id="client-name" label="Company name">
            <Input
              id="client-name"
              required
              autoFocus
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Acme Corp"
            />
          </FormField>
          <FormField
            id="client-domain"
            label="Website"
            hint="We use it to find the company's people and look up their accounts."
          >
            <Input
              id="client-domain"
              required
              value={form.domain}
              onChange={(e) => setForm({ ...form, domain: e.target.value })}
              placeholder="acme.com"
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
            <Button
              type="submit"
              disabled={saving || !form.name.trim() || !form.domain.trim()}
            >
              {saving ? "Adding…" : "Add client"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
