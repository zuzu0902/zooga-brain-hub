import { describe, it, expect } from "vitest";
import { createCoreClient } from "@/lib/hostinger-core/client";

function mk() {
  const calls: any[] = [];
  const fetcher = (async (url: string, init: any) => {
    calls.push({ url, method: init.method, auth: init.headers.Authorization, body: init.body });
    return new Response(JSON.stringify({ contact: { id: "c1", profile: { first_name: "A" } } }), { status: 200 });
  }) as any;
  return { calls, api: createCoreClient({ getToken: async () => "sess", fetcher, baseUrl: "https://core" }) };
}

describe("coreApi contact mutations", () => {
  it("create/delete/restore hit only Core with session bearer", async () => {
    const { calls, api } = mk();
    const c = await api.createContact({ profile: { first_name: "A" } });
    expect(c.id).toBe("c1");
    await api.deleteContact("c1", "dup");
    await api.restoreContact("c1");
    expect(calls.map((x) => `${x.method} ${x.url}`)).toEqual([
      "POST https://core/v1/admin/contacts",
      "DELETE https://core/v1/admin/contacts/c1",
      "POST https://core/v1/admin/contacts/c1/restore",
    ]);
    expect(calls.every((x) => x.auth === "Bearer sess")).toBe(true);
  });
});
