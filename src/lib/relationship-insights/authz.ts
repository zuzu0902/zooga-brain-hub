/** Admin-only authorization for the internal relationship insights feature. */
export async function assertAdminRole(supabase: any, userId: string): Promise<void> {
  const { data, error } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (error) throw new Error("authorization_check_failed");
  if (data !== true) throw new Error("forbidden");
}