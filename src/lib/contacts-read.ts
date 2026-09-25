import { supabase } from "@/integrations/supabase/client";

/** Canonical CRM contacts (unarchived) from the database; RLS limits to admins. */
export async function fetchCanonicalContacts(): Promise<any[]> {
  const { data, error } = await supabase
    .from("contacts")
    .select("*")
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(5000);
  if (error) throw new Error(error.message);
  return data ?? [];
}
