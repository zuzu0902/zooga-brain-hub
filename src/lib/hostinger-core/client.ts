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

/**
 * In the embedded preview the auth session is restored asynchronously through
 * the editor broker (postMessage). A getSession() call made right after a
 * refresh can resolve null before the broker answers. Wait for the auth
 * client's INITIAL_SESSION, then retry a few times before giving up.
 */
let authReady: Promise<void> | null = null;
function waitForAuthReady(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (!authReady) {
    authReady = new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 5000);
      const { data } = supabase.auth.onAuthStateChange((event) => {
        if (event === "INITIAL_SESSION" || event === "SIGNED_IN") {
          clearTimeout(timer);
          data.subscription.unsubscribe();
          resolve();
        }
      });
    });
  }
  return authReady;
}

const defaultToken: TokenGetter = async () => {
  await waitForAuthReady();
  for (let i = 0; i < 4; i++) {
    const { data } = await supabase.auth.getSession();
    const t = data.session?.access_token;
    if (t) return t;
    await new Promise((r) => setTimeout(r, 400 * (i + 1)));
  }
  return null;
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
      mapPage(normalizePage<any>(await request<any>(`/v1/admin/contacts${qs(p)}`), "contacts"), normalizeContact),
    getContact: async (id: string) =>
      normalizeContact(unwrap<any>(await request<any>(`/v1/admin/contacts/${encodeURIComponent(id)}`), "contact")),
    patchContact: async (id: string, patch: CoreContactPatch) =>
      normalizeContact(unwrap<any>(
        await request<any>(`/v1/admin/contacts/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify(patch),
        }),
        "contact",
      )),
    createContact: async (body: CoreContactPatch) =>
      normalizeContact(unwrap<any>(
        await request<any>(`/v1/admin/contacts`, { method: "POST", body: JSON.stringify(body) }),
        "contact",
      )),
    /** Soft delete in Core; reversible via restoreContact. */
    deleteContact: async (id: string, reason?: string) =>
      request<any>(`/v1/admin/contacts/${encodeURIComponent(id)}`, {
        method: "DELETE",
        ...(reason ? { body: JSON.stringify({ reason }) } : {}),
      }),
    restoreContact: async (id: string) =>
      normalizeContact(unwrap<any>(
        await request<any>(`/v1/admin/contacts/${encodeURIComponent(id)}/restore`, { method: "POST", body: "{}" }),
        "contact",
      )),
    listCatalog: async (p: { limit?: number; cursor?: string | null } = {}) =>
      mapPage(normalizePage<any>(await request<any>(`/v1/admin/catalog${qs(p)}`), "catalog"), normalizeCatalogItem),
  };
}

export function normalizePage<T>(body: any, key: string): CorePage<T> {
  const items = Array.isArray(body) ? body : body?.rows ?? body?.items ?? body?.data ?? body?.[key] ?? [];
  return { items: Array.isArray(items) ? items : [], next_cursor: body?.next_cursor ?? body?.cursor ?? null };
}

function mapPage<A, B>(p: CorePage<A>, f: (a: A) => B): CorePage<B> {
  return { items: p.items.map(f), next_cursor: p.next_cursor };
}

const obj = (v: unknown): Record<string, any> => (v && typeof v === "object" && !Array.isArray(v) ? (v as any) : {});

/**
 * Flatten a Core contact ({identity, profile, lifecycle, consent_state, ...})
 * into the flat shape the screens render. Raw nested objects are retained.
 */
export function normalizeContact(raw: any): CoreContact {
  const r = obj(raw);
  const { identity, profile, lifecycle, consent_state, ...top } = r;
  const flat: Record<string, any> = {
    ...top,
    ...obj(consent_state),
    ...obj(identity),
    ...obj(profile),
    ...obj(lifecycle),
    // Consent lives under its own keys so it never overwrites lifecycle status.
    consent_status: obj(consent_state).status ?? null,
    consent_evidence: obj(consent_state).evidence ?? null,
    id: r.id,
    identity, profile, lifecycle, consent_state,
  };
  if (flat.created_at == null && r.source_created_at != null) flat.created_at = r.source_created_at;
  if (flat.updated_at == null && r.source_updated_at != null) flat.updated_at = r.source_updated_at;
  return flat as CoreContact;
}

/** Flatten a Core catalog item (commercial + verified_facts; lifecycle_status → status). */
export function normalizeCatalogItem(raw: any): CoreCatalogItem {
  const r = obj(raw);
  const { commercial, verified_facts, ...top } = r;
  const flat: Record<string, any> = {
    ...obj(verified_facts),
    ...obj(commercial),
    ...top,
    commercial, verified_facts,
  };
  if (flat.status == null && r.lifecycle_status != null) flat.status = r.lifecycle_status;
  return flat as CoreCatalogItem;
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
