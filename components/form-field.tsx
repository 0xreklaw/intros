import type { ReactNode } from "react"

import { Label } from "@/components/ui/label"

export function FormField({
  id,
  label,
  icon,
  hint,
  children,
}: {
  id: string
  label: string
  /** Shown before the label, such as a platform logo. */
  icon?: ReactNode
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="gap-2 text-[13px]">
        {icon}
        {label}
      </Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
      {message}
    </p>
  )
}
