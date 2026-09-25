import { describe, it, expect, vi } from "vitest";
const calls: any[] = [];
let result: any = { data: [{ id: "a" }], error: null };
vi.mock("@/integrations/supabase/client", () => {
  const q: any = {};
  for (const m of ["from", "select", "is", "order"]) q[m] = (...a: any[]) => { calls.push([m, ...a]); return q; };
  q.limit = () => Promise.resolve(result);
  return { supabase: q };
});
import { fetchCanonicalContacts } from "../contacts-read";
describe("fetchCanonicalContacts", () => {
  it("reads unarchived rows from public.contacts", async () => {
    expect(await fetchCanonicalContacts()).toHaveLength(1);
    expect(calls).toContainEqual(["from", "contacts"]);
    expect(calls).toContainEqual(["is", "archived_at", null]);
  });
  it("surfaces errors instead of showing an empty list", async () => {
    result = { data: null, error: { message: "permission denied" } };
    await expect(fetchCanonicalContacts()).rejects.toThrow("permission denied");
  });
});
