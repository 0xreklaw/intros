"use client"

import { useEffect, useRef, type FormEvent, type ReactNode } from "react"
import { ArrowUp, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Chat-style search box floating at the bottom of the page. Sits over the scrolling
 * content, so the parent must be `relative` and leave room under its content.
 * Enter searches, Shift+Enter adds a line. Anything passed as children (notices,
 * confirmations) stacks directly above the box so it is always in view.
 */
export function SearchComposer({
  value,
  onChange,
  onSubmit,
  busy,
  isDefault,
  query,
  unavailable,
  onBackToDefault,
  children,
}: {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  busy: boolean
  /** Whether the results on screen came from the default search. */
  isDefault: boolean
  /** The search the results on screen answer. */
  query: string
  /** True when no AI key is set: there is nothing to search with. */
  unavailable: boolean
  onBackToDefault: () => void
  children?: ReactNode
}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  // Grow with the text, up to a few lines.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`
  }, [value])

  function submit(e?: FormEvent) {
    e?.preventDefault()
    if (!busy && !unavailable && value.trim()) onSubmit()
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 px-4 pb-4 sm:px-5">
      <div className="pointer-events-auto mx-auto flex max-w-3xl flex-col gap-2">
        {children}
        {!isDefault ? (
          <div className="flex max-w-full items-center gap-2 self-center rounded-full border border-border/80 bg-background px-3 py-1 text-xs text-muted-foreground shadow-sm">
            <span className="truncate">Searching &ldquo;{query}&rdquo;</span>
            <button
              type="button"
              onClick={onBackToDefault}
              className="shrink-0 text-foreground underline"
            >
              Back to default
            </button>
          </div>
        ) : null}
        <form
          onSubmit={submit}
          className={cn(
            "flex items-end gap-2 rounded-2xl border border-border/80 bg-background p-2 pl-4 shadow-lg shadow-black/5 transition-colors",
            "focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20"
          )}
        >
          <textarea
            ref={ref}
            rows={1}
            value={value}
            aria-label="Who are you looking for?"
            disabled={unavailable}
            placeholder={
              unavailable
                ? "Search needs an AI key (OPENROUTER_API_KEY)"
                : "Who are you looking for? For example: business owners in marketing"
            }
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              )
                submit(e)
            }}
            className="max-h-[140px] min-h-8 flex-1 resize-none bg-transparent py-1.5 text-[14px] leading-5 outline-none placeholder:text-muted-foreground"
          />
          <button
            type="submit"
            aria-label="Search"
            disabled={busy || unavailable || !value.trim()}
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:bg-foreground/90 disabled:opacity-30"
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <ArrowUp className="size-4" strokeWidth={2.25} />
            )}
          </button>
        </form>
      </div>
    </div>
  )
}
