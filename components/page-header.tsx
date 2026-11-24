import type { ReactNode } from "react"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"

import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * Toolbar under the nav bar: 15px title, 13px muted description, actions on the right. A page
 * that sits inside another passes `back`, which puts an arrow before the title.
 */
export function PageHeader({
  title,
  description,
  actions,
  back,
}: {
  title: string
  description?: string
  actions?: ReactNode
  back?: { href: string; label: string }
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border/50 bg-background px-4 py-3 sm:px-5">
      <div className="flex min-w-0 items-center gap-3">
        {back ? (
          <Link
            href={back.href}
            aria-label={back.label}
            title={back.label}
            className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
          >
            <ArrowLeft />
          </Link>
        ) : null}
        <div className="min-w-0">
          <h1 className="truncate text-[15px] font-medium tracking-tight">
            {title}
          </h1>
          {description ? (
            <p className="text-[13px] text-muted-foreground">{description}</p>
          ) : null}
        </div>
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  )
}

/** Scrolling content area under the page header. */
export function PageBody({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cn("min-h-0 flex-1 overflow-y-auto p-4 sm:p-5", className)}>
      {children}
    </div>
  )
}

export function Notice({
  tone,
  children,
}: {
  tone: "info" | "error" | "success"
  children: ReactNode
}) {
  const cls =
    tone === "error"
      ? "border-destructive/30 bg-[color-mix(in_oklab,var(--destructive)_10%,white)] text-destructive"
      : tone === "success"
        ? "border-emerald-500/30 bg-[color-mix(in_oklab,var(--color-emerald-500)_10%,white)] text-emerald-800"
        : "border-border/80 bg-muted text-foreground"
  return (
    <div className={cn("rounded-md border px-3 py-2 text-[13px]", cls)}>
      {children}
    </div>
  )
}
