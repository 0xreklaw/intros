/** Small readers for untrusted JSON from treg and the database: wrong shapes give null or empty, never a throw. */

/** An object, or null for anything else (including arrays). */
export const rec = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null

/** A trimmed, non-empty string, or null. */
export const text = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null

/** The objects in an array; anything else is skipped. */
export const list = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.map(rec).filter((r) => r !== null) : []
