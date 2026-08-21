/**
 * Reads and parses the JSON request body, falling back to an empty object if
 * reading/parsing fails (e.g. missing or malformed body) — so route handlers
 * can validate individual fields uniformly instead of also handling a thrown
 * error from a missing body.
 */
export function readBodySafe<T>(event: Parameters<typeof readBody>[0]): Promise<T> {
  return readBody<T>(event).catch(() => ({}) as T)
}
