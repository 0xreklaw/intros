import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

/** Full-page empty state: a centred icon, title and optional description, then any actions as children. */
export function PageEmptyState({
  icon: Icon,
  title,
  description,
  className,
  children,
}: {
  icon: LucideIcon
  title: string
  description?: string
  className?: string
  children?: ReactNode
}) {
  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col items-center justify-center p-8",
        className
      )}
    >
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-lg border bg-muted/40">
          <Icon className="size-5 text-muted-foreground" strokeWidth={1.75} />
        </div>
        <h1 className="text-base font-medium tracking-tight">{title}</h1>
        {description ? (
          <p className="mt-1.5 text-[13px] leading-snug text-muted-foreground">
            {description}
          </p>
        ) : null}
        {children}
      </div>
    </div>
  )
}
