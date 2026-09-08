/**
 * Canonical server-side admin assertion for individual Tamar actions.
 * Uses the canonical has_role RPC through the caller's own (RLS-bound)
 * Supabase client — never the admin client.
 */
export async function assertAdmin(context: any): Promise<string> {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error || !data) throw new Response("Forbidden", { status: 403 });
  return context.userId as string;
}
