import { createHash, randomUUID } from "node:crypto"

export function contentHash(bytes: Buffer | Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex")
}

/** Opaque object key: no names or emails in paths. `tenants/{tenantId}/sources/{id}/{hash}` */
export function buildObjectKey(tenantId: string, hash: string): string {
  return `tenants/${tenantId}/sources/${randomUUID()}/${hash}`
}
