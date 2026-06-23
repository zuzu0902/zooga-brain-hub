/**
 * RUNTIME LEAD CONTEXT — Railway brain → Lovable CRM bridge.
 *
 * Replaces direct Supabase reads from Railway. Given a phone (or contact_id),
 * find or create the contact and return the minimum context the runtime
 * brain needs to decide what to answer.
 *
 * Auth: Authorization: Bearer <RUNTIME_BRIDGE_TOKEN>
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { authorizeRuntimeBridge, normalizePhone } from "@/lib/runtime-bridge-auth";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-token",
};

async function readParams(request: Request): Promise<Record<string, any>> {
  if (request.method === "GET") {
    const u = new URL(request.url);
    const out: Record<string, any> = {};
    u.searchParams.forEach((v, k) => (out[k] = v));
    return out;
  }
  return await request.json().catch(() => ({}));
}

async function findOrCreateContact(phone: string | null, contactId: string | null, name: string | null) {
  if (contactId) {
    const { data } = await supabaseAdmin.from("contacts").select("*").eq("id", contactId).maybeSingle();
    if (data) return data;
  }
  if (phone) {
    const { data } = await supabaseAdmin
      .from("contacts")
      .select("*")
      .or(`phone.eq.${phone},whatsapp_number.eq.${phone}`)
      .maybeSingle();
    if (data) return data;
    const insert: any = {
      phone,
      whatsapp_number: phone,
      source: "railway_runtime_bridge",
      status: "active",
    };
    if (name) insert.first_name = name;
    const { data: created, error } = await supabaseAdmin
      .from("contacts")
      .insert(insert)
      .select("*")
      .single();
    if (error) throw error;
    return created;
  }
  return null;
}

async function handle(request: Request): Promise<Response> {
  const unauthorized = await authorizeRuntimeBridge(request);
  if (unauthorized) return unauthorized;

  const params = await readParams(request);
  const phone = normalizePhone(params.phone ?? params.whatsapp_number ?? params.from);
  const contactId = params.contact_id ?? null;
  const name = params.first_name ?? params.name ?? null;

  if (!phone && !contactId) {
    return new Response(
      JSON.stringify({ ok: false, error: "missing_phone_or_contact_id" }),
      { status: 400, headers: { "Content-Type": "application/json", ...CORS } },
    );
  }

  let contact: any = null;
  try {
    contact = await findOrCreateContact(phone, contactId, name);
  } catch (e: any) {
    return new Response(
      JSON.stringify({ ok: false, error: "contact_upsert_failed", detail: String(e?.message ?? e) }),
      { status: 500, headers: { "Content-Type": "application/json", ...CORS } },
    );
  }
  if (!contact) {
    return new Response(
      JSON.stringify({ ok: false, error: "contact_not_found" }),
      { status: 404, headers: { "Content-Type": "application/json", ...CORS } },
    );
  }

  const [interactionsRes, offersRes, openHandoffRes] = await Promise.all([
    supabaseAdmin
      .from("interactions")
      .select("id,type,source,content,timestamp,campaign_id,related_offer_id")
      .eq("contact_id", contact.id)
      .order("timestamp", { ascending: false })
      .limit(20),
    supabaseAdmin
      .from("offers")
      .select("id,title,description,category,offer_url,ai_summary,sales_angle,price,currency,base_price_per_person,single_supplement,couple_price,pricing_status,target_region,nights,event_date,status,matching_tags,target_min_age,target_max_age,target_interests,target_spending_profile,event_end_date,flights_included")
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(50),
    supabaseAdmin
      .from("manager_handoffs" as any)
      .select("id,status,handoff_reason,manager_notified,created_at")
      .eq("contact_id", contact.id)
      .not("status", "in", "(resolved,closed)")
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  const dyn = (contact.dynamic_profile_fields ?? {}) as Record<string, any>;
  const openHandoff = ((openHandoffRes.data ?? []) as any[])[0] ?? null;

  return new Response(
    JSON.stringify({
      ok: true,
      contact: {
        id: contact.id,
        phone: contact.phone ?? contact.whatsapp_number,
        whatsapp_number: contact.whatsapp_number,
        first_name: contact.first_name,
        last_name: contact.last_name,
        full_name: contact.full_name,
        lead_stage: contact.intake_stage ?? contact.conversion_stage ?? null,
        intake_state: contact.intake_state,
        intake_stage: contact.intake_stage,
        intake_completion_score: contact.intake_completion_score,
        preferred_destination: dyn.preferred_destination ?? null,
        preferred_time_window: dyn.preferred_time_window ?? null,
        travel_companion_state: dyn.travel_companion_state ?? null,
        current_offer_id: dyn.current_offer_id ?? contact.entry_offer_id ?? contact.last_clicked_offer ?? null,
        manager_attention_required: !!contact.manager_attention_required,
        ai_summary: contact.ai_summary,
        sales_temperature: contact.sales_temperature,
        purchase_intent: contact.purchase_intent,
      },
      recent_interactions: interactionsRes.data ?? [],
      active_offers: (offersRes.data ?? []).map((o: any) => ({
        id: o.id,
        title: o.title,
        description: o.description,
        destination: o.target_region ?? null,
        category: o.category,
        price: o.base_price_per_person ?? o.price ?? null,
        currency: o.currency ?? "₪",
        offer_url: o.offer_url,
        ai_summary: o.ai_summary,
        sales_angle: o.sales_angle,
        nights: o.nights,
        event_date: o.event_date,
        pricing_status: o.pricing_status,
        matching_tags: o.matching_tags,
        target_min_age: o.target_min_age ?? null,
        target_max_age: o.target_max_age ?? null,
        target_interests: o.target_interests ?? [],
        target_spending_profile: o.target_spending_profile ?? null,
        event_end_date: o.event_end_date ?? null,
        flights_included: o.flights_included ?? null,
        // Qualifier hints derived from structured + textual fields so
        // the Railway brain can score offers like "וייטנאם 60+" without
        // re-parsing the whole row.
        qualifier_hints: deriveQualifierHints(o),
      })),
      runtime_flags: {
        handoff_open: !!openHandoff,
        handoff_id: openHandoff?.id ?? null,
        handoff_status: openHandoff?.status ?? null,
        manager_attention_required: !!contact.manager_attention_required,
      },
      conversation_memory: {
        last_presented_offers: Array.isArray(contact.last_presented_offers)
          ? contact.last_presented_offers
          : [],
        last_presented_offers_at: contact.last_presented_offers_at ?? null,
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json", ...CORS } },
  );
}

function deriveQualifierHints(o: any): {
  age_min: number | null;
  age_max: number | null;
  age_band: string | null;
  audience_tags: string[];
} {
  const text = [o.title, o.description, o.sales_angle, o.ai_summary]
    .filter(Boolean)
    .join(" ");
  const tags = new Set<string>();
  if (Array.isArray(o.matching_tags)) o.matching_tags.forEach((t: any) => tags.add(String(t).toLowerCase()));
  if (Array.isArray(o.target_interests)) o.target_interests.forEach((t: any) => tags.add(String(t).toLowerCase()));

  // Hebrew + English age qualifier patterns.
  let ageMin: number | null = typeof o.target_min_age === "number" ? o.target_min_age : null;
  let ageMax: number | null = typeof o.target_max_age === "number" ? o.target_max_age : null;
  let ageBand: string | null = null;

  // "60+", "60 פלוס", "בני 60 ומעלה", "מגיל 60", "55 ומעלה"
  const plusMatch = text.match(/(\d{2})\s*(?:\+|פלוס|ומעלה|ומעל)/);
  if (plusMatch) {
    const n = parseInt(plusMatch[1], 10);
    if (!Number.isNaN(n)) {
      ageMin = ageMin ?? n;
      ageBand = `${n}+`;
      tags.add(`${n}+`);
    }
  }
  // "בני 60", "מגיל 60"
  const fromMatch = text.match(/(?:בני|מגיל|מעל גיל)\s*(\d{2})/);
  if (fromMatch) {
    const n = parseInt(fromMatch[1], 10);
    if (!Number.isNaN(n)) {
      ageMin = ageMin ?? n;
      ageBand = ageBand ?? `${n}+`;
      tags.add(`${n}+`);
    }
  }
  // Range "55-70"
  const rangeMatch = text.match(/(\d{2})\s*[-–]\s*(\d{2})/);
  if (rangeMatch) {
    const a = parseInt(rangeMatch[1], 10);
    const b = parseInt(rangeMatch[2], 10);
    if (!Number.isNaN(a) && !Number.isNaN(b)) {
      ageMin = ageMin ?? Math.min(a, b);
      ageMax = ageMax ?? Math.max(a, b);
      ageBand = ageBand ?? `${Math.min(a, b)}-${Math.max(a, b)}`;
    }
  }

  if (!ageBand && ageMin && ageMax) ageBand = `${ageMin}-${ageMax}`;
  else if (!ageBand && ageMin) ageBand = `${ageMin}+`;

  return {
    age_min: ageMin,
    age_max: ageMax,
    age_band: ageBand,
    audience_tags: Array.from(tags),
  };
}

export const Route = createFileRoute("/api/public/runtime/lead-context")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request }) => handle(request),
      POST: async ({ request }) => handle(request),
    },
  },
});