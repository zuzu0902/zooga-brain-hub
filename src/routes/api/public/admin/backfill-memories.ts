import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Memory v2 backfill (heuristic, idempotent).
 * Scans recent interactions and inserts contact_memories rows in the v2 taxonomy
 * (warning / observation / relationship_signal / offer_signal) when absent.
 *
 * Auth: same DEBUG_READ_ONLY_TOKEN gate as introspect (admin operational tool).
 * No-op writes if a memory_key already exists for the contact.
 * No PII returned in the response.
 */

type Kind = "warning" | "observation" | "relationship_signal" | "offer_signal";

const RULES: { kind: Kind; key: string; patterns: RegExp[]; confidence: number; value: string }[] = [
  { kind: "warning", key: "cancellation_intent", patterns: [/לבטל|ביטול|מבטל|מבטלת/], confidence: 70, value: "Customer mentioned cancellation" },
  { kind: "warning", key: "refund_request", patterns: [/החזר כספי|רוצה החזר|תחזירו/], confidence: 75, value: "Customer requested refund" },
  { kind: "warning", key: "complaint", patterns: [/תלונה|מתלונן|מתלוננת|לא מרוצה|לא מרוצ/], confidence: 70, value: "Customer expressed dissatisfaction" },
  { kind: "warning", key: "legal_threat", patterns: [/עורך דין|תביעה|לתבוע/], confidence: 90, value: "Customer mentioned legal action" },
  { kind: "warning", key: "angry_tone", patterns: [/כועס|כועסת|מעצבן|נמאס לי/], confidence: 60, value: "Angry / frustrated tone detected" },

  { kind: "offer_signal", key: "purchase_intent", patterns: [/מעוניין|מעוניינת|רוצה להרשם|רוצה להירשם|אני בפנים|רושמ/], confidence: 70, value: "Expressed interest in booking" },
  { kind: "offer_signal", key: "price_question", patterns: [/כמה זה עולה|כמה עולה|מחיר|עלות/], confidence: 60, value: "Asked about price" },
  { kind: "offer_signal", key: "date_question", patterns: [/מתי זה|באיזה תאריך|תאריכים/], confidence: 55, value: "Asked about dates" },
  { kind: "offer_signal", key: "budget_objection", patterns: [/יקר לי|אין לי תקציב|לא יכול לעמוד/], confidence: 65, value: "Budget objection raised" },

  { kind: "relationship_signal", key: "single_status", patterns: [/אני רווק|אני רווקה|רווק\/ה/], confidence: 70, value: "Single" },
  { kind: "relationship_signal", key: "divorced_status", patterns: [/גרוש|גרושה/], confidence: 75, value: "Divorced" },
  { kind: "relationship_signal", key: "widowed_status", patterns: [/אלמן|אלמנה/], confidence: 80, value: "Widowed" },
  { kind: "relationship_signal", key: "loneliness_signal", patterns: [/לבד|בודד|בודדה|אין לי חבר/], confidence: 65, value: "Expressed loneliness" },
  { kind: "relationship_signal", key: "with_friend", patterns: [/חבר שלי|חברה שלי|נגיע עם/], confidence: 55, value: "Plans to attend with friend/partner" },

  { kind: "observation", key: "first_time_traveler", patterns: [/לא טסתי|פעם ראשונה|אף פעם לא נסעתי/], confidence: 55, value: "First-time traveler observation" },
  { kind: "observation", key: "health_constraint", patterns: [/בעיות בריאות|לא יכול ללכת הרבה|כאבי גב|כאבי ברכי/], confidence: 70, value: "Possible health/mobility constraint" },
  { kind: "observation", key: "kosher_pref", patterns: [/כשר|אוכל כשר|שומר כשרות/], confidence: 75, value: "Keeps kosher" },
  { kind: "observation", key: "language_pref_he", patterns: [/בעברית בבקשה|רק בעברית/], confidence: 80, value: "Prefers Hebrew communication" },
  { kind: "observation", key: "decision_with_partner", patterns: [/אדבר עם בעלי|אדבר עם אשתי|אצטרך להתייעץ/], confidence: 60, value: "Decides with spouse/partner" },
];

export const Route = createFileRoute("/api/public/admin/backfill-memories")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = request.headers.get("x-debug-token");
        const expected = process.env.DEBUG_READ_ONLY_TOKEN;
        if (!expected || token !== expected) {
          return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
        }

        const body = await request.json().catch(() => ({} as any));
        const dryRun = body?.dry_run === true;
        const limitContacts = Math.min(Math.max(Number(body?.limit_contacts) || 200, 1), 1000);
        const interactionsPerContact = Math.min(Math.max(Number(body?.interactions_per_contact) || 40, 1), 100);

        // Pull recent contacts with interactions
        const { data: contacts, error: cErr } = await supabaseAdmin
          .from("contacts")
          .select("id")
          .order("last_interaction_at", { ascending: false, nullsFirst: false })
          .limit(limitContacts);
        if (cErr) return new Response(JSON.stringify({ error: cErr.message }), { status: 500, headers: { "Content-Type": "application/json" } });

        let scanned = 0;
        let inserted = 0;
        let skippedExisting = 0;
        const insertedByKind: Record<string, number> = { warning: 0, observation: 0, relationship_signal: 0, offer_signal: 0 };

        for (const c of contacts ?? []) {
          const contactId = c.id as string;
          const { data: ints } = await supabaseAdmin
            .from("interactions")
            .select("content, source")
            .eq("contact_id", contactId)
            .order("timestamp", { ascending: false })
            .limit(interactionsPerContact);
          if (!ints?.length) continue;
          scanned += 1;

          // Existing memory keys for dedup
          const { data: existing } = await supabaseAdmin
            .from("contact_memories")
            .select("memory_key, memory_type")
            .eq("contact_id", contactId);
          const existingKeys = new Set((existing ?? []).map((m: any) => `${m.memory_type}::${m.memory_key}`));

          for (const i of ints) {
            const text = String(i?.content ?? "");
            if (!text) continue;
            for (const rule of RULES) {
              if (existingKeys.has(`${rule.kind}::${rule.key}`)) continue;
              const matched = rule.patterns.some((re) => re.test(text));
              if (!matched) continue;
              const sample = text.slice(0, 240);
              if (!dryRun) {
                const { error: insErr } = await supabaseAdmin
                  .from("contact_memories")
                  .insert({
                    contact_id: contactId,
                    memory_type: rule.kind,
                    memory_key: rule.key,
                    memory_value: rule.value,
                    confidence_score: rule.confidence,
                    extracted_from: "backfill_v2_heuristic",
                    source_message: sample,
                  });
                if (insErr) continue;
              }
              existingKeys.add(`${rule.kind}::${rule.key}`);
              inserted += 1;
              insertedByKind[rule.kind] = (insertedByKind[rule.kind] ?? 0) + 1;
            }
          }
        }

        // count skipped existing as informational
        skippedExisting = (contacts?.length ?? 0) - scanned;

        return Response.json({
          ok: true,
          dry_run: dryRun,
          contacts_considered: contacts?.length ?? 0,
          contacts_scanned: scanned,
          contacts_skipped_no_interactions: skippedExisting,
          inserted_total: inserted,
          inserted_by_kind: insertedByKind,
          rules_count: RULES.length,
          taxonomy_version: 2,
        });
      },
    },
  },
});