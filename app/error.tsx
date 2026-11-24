"use client"

import { AlertTriangle } from "lucide-react"

import { Button } from "@/components/ui/button"
import { PageEmptyState } from "@/components/ui/page-empty-state"

/** Shown when a page fails to load, for example when the database cannot be reached. */
export default function ErrorPage({
  reset,
}: {
  error: Error
  reset: () => void
}) {
  return (
    <PageEmptyState
      icon={AlertTriangle}
      title="Something went wrong"
      description="This page could not be loaded. Try again in a moment."
    >
      <div className="mt-4 flex justify-center">
        <Button variant="outline" onClick={reset}>
          Try again
        </Button>
      </div>
    </PageEmptyState>
  )
}
