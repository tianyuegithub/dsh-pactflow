import { z } from 'zod'
import type { ZodType } from 'zod'

/** Shared wire envelope used by every PactFlow Session Event. */
export const pactFlowVersionedPayloadSchema = z.object({ v: z.literal(1) })

/** Brand-aware schema adapter; runtime validation remains owned by the Zod object. */
export function pactFlowSchema<T>(schema: z.ZodTypeAny): ZodType<T> {
  return schema as unknown as ZodType<T>
}

export function parsePactFlowVersionedPayload(value: unknown, eventType: string): void {
  const parsed = pactFlowVersionedPayloadSchema.safeParse(value)
  if (!parsed.success) throw new Error(`invalid ${eventType} payload version: ${parsed.error.message}`)
}
