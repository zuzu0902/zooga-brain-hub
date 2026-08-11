/**
 * Supabase query results are thenables, NOT real Promises: they expose
 * `then` but have no `catch`. Writing `db().from(x).insert(y).catch(...)`
 * therefore throws `TypeError: ... .catch is not a function` at runtime and
 * can take down a whole reply turn because of a failed telemetry write.
 *
 * `quiet()` is the only safe way to fire a best-effort database write.
 */
export async function quiet<T>(query: PromiseLike<T>): Promise<T | null> {
  try {
    return await query;
  } catch {
    return null;
  }
}
