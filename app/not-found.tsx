import Link from "next/link"
import { ArrowLeft, SearchX } from "lucide-react"

import { buttonVariants } from "@/components/ui/button"
import { PageEmptyState } from "@/components/ui/page-empty-state"
import { cn } from "@/lib/utils"

export default function NotFound() {
  return (
    <PageEmptyState
      icon={SearchX}
      title="Not found"
      description="That page does not exist."
    >
      <div className="mt-4 flex justify-center">
        <Link href="/" className={cn(buttonVariants({ variant: "outline" }))}>
          <ArrowLeft />
          All clients
        </Link>
      </div>
    </PageEmptyState>
  )
}
