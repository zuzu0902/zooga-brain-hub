/**
 * Typed browser client for the Hostinger Core admin API.
 *
 * MIGRATION: control-plane CRM screens (dashboard, contacts, offers/catalog)
 * read and edit CRM data through Hostinger Core instead of the database.
 * The base URL below is public and non-secret. Authentication uses the
 * signed-in user's session token, fetched at request time. No control or
 * service token ever reaches the browser.
 */
import { supabase } from "@/integrations/supabase/client";

// MIGRATION: public Hostinger Core base URL (non-secret).
export const HOSTINGER_CORE_BASE_URL = "https://zooga-core.72-62-31-90.sslip.io";

export class CoreApiError extends Error {
  constructor(public status: number, public code: string) {
    super(`core_api_${status}_${code}`);
  }
}

export type CorePage<T> = { items: T[]; next_cursor: string | null };
export type CoreContact = Record<string, any> & { id: string };
export type CoreCatalogItem = Record<string, any> & { id: string };
export type CoreContactPatch = { profile?: Record<string, unknown>; lifecycle?: Record<string, unknown> };

type TokenGetter = () => Promise<string | null>;
type Fetcher = typeof fetch;

const defaultToken: TokenGetter = async () => {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
};

export function createCoreClient(opts: { getToken?: TokenGetter; fetcher?: Fetcher; baseUrl?: string } = {}) {
  const getToken = opts.getToken ?? defaultToken;
  const baseUrl = opts.baseUrl ?? HOSTINGER_CORE_BASE_URL;

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await getToken();
    if (!token) throw new CoreApiError(401, "not_signed_in");
    const f = opts.fetcher ?? fetch;
    const res = await f(`${baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        Authorization: `Bearer ${token}`,
      },
    });
    const body: any = await res.json().catch(() => null);
    if (!res.ok) throw new CoreApiError(res.status, String(body?.error ?? "request_failed"));
    return body as T;
  }

  function qs(p: Record<string, string | number | undefined | null>) {
    const s = new URLSearchParams();
    for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== null && v !== "") s.set(k, String(v));
    const str = s.toString();
    return str ? `?${str}` : "";
  }

  return {
    overview: () => request<Record<string, any>>("/v1/admin/overview"),
    listContacts: async (p: { limit?: number; cursor?: string | null } = {}) =>
      normalizePage<CoreContact>(await request<any>(`/v1/admin/contacts${qs(p)}`), "contacts"),
    getContact: async (id: string) =>
      unwrap<CoreContact>(await request<any>(`/v1/admin/contacts/${encodeURIComponent(id)}`), "contact"),
    patchContact: async (id: string, patch: CoreContactPatch) =>
      unwrap<CoreContact>(
        await request<any>(`/v1/admin/contacts/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify(patch),
        }),
        "contact",
      ),
    listCatalog: async (p: { limit?: number; cursor?: string | null } = {}) =>
      normalizePage<CoreCatalogItem>(await request<any>(`/v1/admin/catalog${qs(p)}`), "catalog"),
  };
}

export function normalizePage<T>(body: any, key: string): CorePage<T> {
  const items = Array.isArray(body) ? body : body?.items ?? body?.data ?? body?.[key] ?? [];
  return { items: Array.isArray(items) ? items : [], next_cursor: body?.next_cursor ?? body?.cursor ?? null };
}

export function unwrap<T>(body: any, key: string): T {
  return (body?.[key] ?? body?.data ?? body) as T;
}

/** Load every page up to a safety cap. */
export async function listAll<T>(
  fn: (p: { limit: number; cursor?: string | null }) => Promise<CorePage<T>>,
  cap = 1000,
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null = null;
  do {
    const page: CorePage<T> = await fn({ limit: 200, cursor });
    out.push(...page.items);
    cursor = page.next_cursor;
  } while (cursor && out.length < cap);
  return out.slice(0, cap);
}

const LIFECYCLE_KEYS = new Set([
  "status", "conversion_stage", "sales_temperature", "manager_attention_required", "intake_status", "intake_stage",
]);

/** Split a flat contact edit into Core's {profile, lifecycle} shape. */
export function toCorePatch(flat: Record<string, unknown>): CoreContactPatch {
  const profile: Record<string, unknown> = {};
  const lifecycle: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(flat)) (LIFECYCLE_KEYS.has(k) ? lifecycle : profile)[k] = v;
  const out: CoreContactPatch = {};
  if (Object.keys(profile).length) out.profile = profile;
  if (Object.keys(lifecycle).length) out.lifecycle = lifecycle;
  return out;
}

export const coreApi = createCoreClient();
