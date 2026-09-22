/**
 * ZOOGA OS ACTIVE BRAIN EXECUTOR CRON ENDPOINT.
 *
 * POST /api/public/cron/zooga-brain-executor
 * header: x-api-token: <webhook_token>
 *
 * Claims runs from 'zooga_shadow_runs' where eval_status='pending' and status='open',
 * evaluates them using OpenAI and records the decision trace + proposal.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function authorized(request: Request): Promise<boolean> {
  const provided = request.headers.get("x-api-token");
  if (!provided) return false;
  const { data } = await supabaseAdmin.from("api_settings").select("webhook_token").eq("id", 1).maybeSingle();
  return !!data?.webhook_token && data.webhook_token === provided;
}

export const Route = createFileRoute("/api/public/cron/zooga-brain-executor")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await authorized(request))) {
          return new Response(JSON.stringify({ error: "unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        const openaiApiKey = process.env.OPENAI_API_KEY;
        if (!openaiApiKey) {
          return Response.json({ ok: false, error: "missing_openai_api_key" }, { status: 500 });
        }

        try {
          const { data: claimed, error: claimError } = await (supabaseAdmin as any).rpc("zooga_brain_claim_runs", {
            _gateway_token: "internal_cron",
            _limit: 5
          });

          if (claimError) throw claimError;
          const runs = Array.isArray(claimed) ? claimed : [];
          const results = [];

          const shadowActions = ["noop", "ask_consent", "ask_intake_question", "deliver_value", "recommend_offer", "request_handoff", "close"];
          const shadowStates = ["new_inbound", "consent_pending", "consented", "intake_active", "value_delivered", "offer_recommended", "human_handoff_queued", "human_owned", "opted_out", "closed", "paused"];

          for (const run of runs) {
            try {
              const promptText = `You are Zooga Relationship Intelligence Brain. 
Your goal is to guide the user seamlessly through the relationship intelligence lifecycle:
Consent -> Intake (gathering context/preferences) -> Value (delivering immediate relationship value/insights) -> Offer (recommending a premium relationship service/offer) -> Handoff (human assistance).

Analyze the input signals and determine the next logical action and subsequent state.
Be precise, execution-oriented, and strict.`;

              const response = await fetch("https://api.openai.com/v1/chat/completions", {
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${openaiApiKey}`,
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({
                  model: run.model_id || "gpt-4o-mini",
                  messages: [
                    { role: "system", content: promptText },
                    { 
                      role: "user", 
                      content: JSON.stringify({
                        event_id: run.event_id,
                        input_signals: run.input_signals,
                        canonical_state_before: run.canonical_state_before
                      }) 
                    }
                  ],
                  response_format: {
                    type: "json_schema",
                    json_schema: {
                      name: "zooga_decision",
                      strict: true,
                      schema: {
                        type: "object",
                        additionalProperties: false,
                        properties: {
                          action: { type: "string", enum: shadowActions },
                          state_after: { type: "string", enum: shadowStates },
                          reason_codes: {
                            type: "array",
                            items: { type: "string" }
                          },
                          confidence: { type: "number" }
                        },
                        required: ["action", "state_after", "reason_codes", "confidence"]
                      }
                    }
                  }
                })
              });

              if (!response.ok) throw new Error(`openai_error_${response.status}`);
              const payload = await response.json();
              const decision = JSON.parse(payload.choices[0].message.content);

              await (supabaseAdmin as any).rpc("zooga_brain_record_proposal", {
                _gateway_token: "internal_cron",
                _run_id: run.run_id,
                _action: decision.action,
                _state_after: decision.state_after,
                _reason_codes: decision.reason_codes,
                _confidence: decision.confidence,
                _input_tokens: payload.usage?.input_tokens || 0,
                _output_tokens: payload.usage?.output_tokens || 0,
                _cost_usd: (payload.usage?.input_tokens || 0) * 0.00000015 + (payload.usage?.output_tokens || 0) * 0.0000006
              });

              results.push({ run_id: run.run_id, success: true, action: decision.action });
            } catch (runErr: any) {
              results.push({ run_id: run.run_id, success: false, error: runErr.message });
            }
          }

          return Response.json({ ok: true, processed: results.length, details: results });
        } catch (err: any) {
          return Response.json({ ok: false, error: err.message }, { status: 500 });
        }
      }
    }
  }
});
