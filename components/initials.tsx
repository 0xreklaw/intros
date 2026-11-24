import { cn } from "@/lib/utils"

/** Soft tints, picked by name so the same person always gets the same colour. */
const TINTS = [
  "bg-orange-100 text-orange-800",
  "bg-sky-100 text-sky-800",
  "bg-emerald-100 text-emerald-800",
  "bg-violet-100 text-violet-800",
  "bg-rose-100 text-rose-800",
  "bg-amber-100 text-amber-800",
  "bg-teal-100 text-teal-800",
  "bg-indigo-100 text-indigo-800",
]

function hash(text: string): number {
  let h = 0
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return h
}

/** "Priya Patel" becomes "PP"; one word gives one letter. Emoji and symbols in a name are skipped. */
function initialsOf(name: string | null | undefined): string {
  const all = (name ?? "").trim().split(/\s+/).filter(Boolean)
  const words = all.filter((w) => /^\p{L}/u.test(w))
  const use = words.length ? words : all
  if (!use.length) return "?"
  // Array.from splits by code point, so a character outside the basic plane is not cut in half.
  const letter = (w: string) => Array.from(w)[0]!
  const first = letter(use[0]!)
  const last = use.length > 1 ? letter(use[use.length - 1]!) : ""
  return (first + last).toUpperCase()
}

/** A person's or company's initials on a soft tint. `square` suits companies. */
export function Initials({
  name,
  square,
  className,
}: {
  name: string | null | undefined
  square?: boolean
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center text-[11px] font-semibold tracking-tight select-none",
        square ? "rounded-md" : "rounded-full",
        TINTS[hash(name ?? "") % TINTS.length],
        className
      )}
    >
      {initialsOf(name)}
    </span>
  )
}
