"use client"

import { useMemo, useState } from "react"
import { XIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { COUNTRIES, countryName } from "@/src/clients/countries"

/** Pick countries by typing part of a name. Picked ones show as chips that can be removed. */
export function CountryPicker({
  id,
  value,
  onChange,
  taken = [],
  placeholder,
}: {
  id: string
  value: string[]
  onChange: (codes: string[]) => void
  /** Codes on the other list, which cannot be added here. */
  taken?: string[]
  placeholder: string
}) {
  const [query, setQuery] = useState("")
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return COUNTRIES.filter(
      (c) =>
        !value.includes(c.code) &&
        !taken.includes(c.code) &&
        (c.name.toLowerCase().includes(q) || c.code.toLowerCase() === q)
    ).slice(0, 6)
  }, [query, value, taken])

  function add(code: string) {
    onChange([...value, code])
    setQuery("")
  }

  return (
    <div className="grid gap-2">
      {value.length ? (
        <div className="flex flex-wrap gap-1.5">
          {value.map((code) => (
            <Badge key={code} variant="secondary" className="h-6 gap-1 pr-1">
              {countryName(code)}
              <button
                type="button"
                aria-label={`Remove ${countryName(code)}`}
                onClick={() => onChange(value.filter((c) => c !== code))}
                className="rounded-full p-0.5 hover:bg-foreground/10"
              >
                <XIcon />
              </button>
            </Badge>
          ))}
        </div>
      ) : null}
      <Input
        id={id}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            if (matches[0]) add(matches[0].code)
          }
        }}
        placeholder={placeholder}
        autoComplete="off"
      />
      {matches.length ? (
        <ul className="grid overflow-hidden rounded-md border text-[13px]">
          {matches.map((c) => (
            <li key={c.code}>
              <button
                type="button"
                onClick={() => add(c.code)}
                className="w-full px-3 py-1.5 text-left hover:bg-muted"
              >
                {c.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
