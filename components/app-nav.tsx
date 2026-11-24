"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Network } from "lucide-react"

import { cn } from "@/lib/utils"

const LINKS = [
  {
    label: "Clients",
    href: "/",
    match: (path: string) => path === "/" || path.startsWith("/clients"),
  },
  {
    label: "Settings",
    href: "/settings",
    match: (path: string) => path.startsWith("/settings"),
  },
]

/** The bar across the top of every page: the way home, the two sections, and the workspace name. */
export function AppNav({ tenantName }: { tenantName: string }) {
  const pathname = usePathname()
  return (
    <header className="flex h-12 shrink-0 items-center gap-6 border-b border-border/50 bg-background px-4 sm:px-5">
      <Link href="/" className="flex shrink-0 items-center gap-2">
        <span className="flex size-6 items-center justify-center rounded-md bg-brand text-brand-foreground">
          <Network className="size-3.5" strokeWidth={2} />
        </span>
        <span className="hidden font-heading text-sm font-medium tracking-tight sm:inline">
          Intros
        </span>
      </Link>
      <nav className="flex h-full items-center gap-5">
        {LINKS.map((link) => {
          const active = link.match(pathname)
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "-mb-px flex h-full items-center border-b-2 text-[13px] font-medium transition-colors",
                active
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {link.label}
            </Link>
          )
        })}
      </nav>
      <span className="ml-auto truncate text-xs text-muted-foreground">
        {tenantName}
      </span>
    </header>
  )
}
