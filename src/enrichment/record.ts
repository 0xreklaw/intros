import { withTenant } from "../db/client"
import { enrichmentCalls, sourceObjects } from "../db/schema/index"
import { putObject } from "../storage/index"
import type { TregCallResult } from "./treg"

/**
 * Keep one treg call: the raw response in object storage with a `source_objects` pointer, and
 * an `enrichment_calls` row with treg's call id and cost. Returns the pointer's id, or null
 * when there was no response to keep.
 */
export async function recordCall(params: {
  tenantId: string
  toolId: string
  personId?: string
  companyId?: string
  result: TregCallResult<unknown>
  outcome: "hit" | "miss" | "error"
}): Promise<string | null> {
  const { tenantId, result } = params
  let sourceObjectId: string | null = null

  // The answer is already paid for and in hand. If keeping a copy fails, say so and carry on:
  // losing the archive must not lose the result.
  try {
    if (result.ok && result.body) {
      const put = await putObject({
        tenantId,
        body: JSON.stringify(result.body),
        contentType: "application/json",
      })
      const [src] = await withTenant(tenantId, async (db) =>
        db
          .insert(sourceObjects)
          .values({
            tenantId,
            provider: "treg",
            providerId: result.callId ?? `${params.toolId}:${put.contentHash}`,
            objectKey: put.objectKey,
            contentHash: put.contentHash,
            contentType: "application/json",
            byteSize: put.byteSize,
            metadata: { toolId: params.toolId, servedBy: result.servedBy },
          })
          .onConflictDoNothing()
          .returning({ id: sourceObjects.id })
      )
      sourceObjectId = src?.id ?? null
    }

    await withTenant(tenantId, async (db) => {
      await db.insert(enrichmentCalls).values({
        tenantId,
        personId: params.personId ?? null,
        companyId: params.companyId ?? null,
        provider: "treg",
        toolId: params.toolId,
        servedBy: result.servedBy,
        tregCallId: result.callId,
        costMicro: result.costMicro,
        outcome: params.outcome,
        error: result.error,
        sourceObjectId,
      })
    })
  } catch (err) {
    console.error(`Could not record treg call ${params.toolId}:`, err)
  }
  return sourceObjectId
}
