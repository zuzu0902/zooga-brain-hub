import { createFileRoute } from "@tanstack/react-router";
import { checkDebugAuth, jsonResponse, methodGuards, INTAKE_FLOWS, INTAKE_FLOW_LABELS } from "@/lib/introspect-api.server";

export const Route = createFileRoute("/api/introspect/tamar-routing")({
  server: { handlers: methodGuards(async ({ request }) => {
    const gate = checkDebugAuth(request); if (gate) return gate;
    return jsonResponse({
      conversation_modes: [
        { key: "intake", description: "Scripted intake questions by flow type" },
        { key: "qualification", description: "Open-ended qualification + AI extraction" },
        { key: "offer_followup", description: "Discuss/clarify a specific offer" },
        { key: "handoff", description: "Escalate to human manager" },
      ],
      routing_priorities: [
        { order: 1, rule: "active campaign flow takes precedence" },
        { order: 2, rule: "explicit user intent (purchase/objection) overrides script" },
        { order: 3, rule: "low confidence → handoff queue" },
        { order: 4, rule: "fallback: generic qualification" },
      ],
      confidence_thresholds: {
        auto_apply: 75, pending_review_max: 74, handoff_min_doubt_score: 60,
      },
      intake_stages: Object.keys(INTAKE_FLOWS).map((k) => ({
        flow: k, label: (INTAKE_FLOW_LABELS as any)[k] ?? k,
        stages: ["greeting","scripted_questions","ai_qualification","summary","handoff_or_offer"],
      })),
      sensitive_routing: {
        risk_routing_exists: true,
        triggers: ["explicit_distress","minor_age_signal","payment_dispute","abusive_language"],
        action: "flag manager_attention_required + create pending_ai_insight",
      },
    });
  })},
});