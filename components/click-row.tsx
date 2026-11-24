"use client"

import type { ReactNode } from "react"
import { useRouter } from "next/navigation"
import { TableRow } from "@/components/ui/table"

/** A table row that navigates on click. The row still contains a real link for keyboard and screen readers. */
export function ClickRow({
  href,
  children,
}: {
  href: string
  children: ReactNode
}) {
  const router = useRouter()
  return (
    <TableRow className="h-11 cursor-pointer" onClick={() => router.push(href)}>
      {children}
    </TableRow>
  )
}
