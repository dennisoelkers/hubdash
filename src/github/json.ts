/**
 * Narrowing helpers for values that came off the wire. Shared by the transport
 * (`client.ts`) and the normaliser (`parseResponse.ts`), which both walk the
 * same untyped GraphQL envelope and must agree on what counts as an object.
 */

/** Narrows to a plain object. Arrays and `null` are rejected, both being poor keyed lookups. */
export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
