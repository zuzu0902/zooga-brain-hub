-- ============ enum extension ============
ALTER TYPE tamar_conversation_state ADD VALUE IF NOT EXISTS 'new_inbound';
ALTER TYPE tamar_conversation_state ADD VALUE IF NOT EXISTS 'consent_asked';
ALTER TYPE tamar_conversation_state ADD VALUE IF NOT EXISTS 'recommendation_ready';
ALTER TYPE tamar_conversation_state ADD VALUE IF NOT EXISTS 'value_delivered';

ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS ambiguity_turns integer NOT NULL DEFAULT 0;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS tamar_agent_version integer;

-- ============ model registry ============
CREATE TABLE public.tamar_model_allowlist (
  model_id text PRIMARY KEY,
  label text NOT NULL DEFAULT '',
  tier text NOT NULL DEFAULT 'standard',
  verified_ok boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.tamar_model_allowlist TO authenticated;
GRANT ALL ON public.tamar_model_allowlist TO service_role;
ALTER TABLE public.tamar_model_allowlist ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allowlist_read" ON public.tamar_model_allowlist FOR SELECT TO authenticated USING (true);
CREATE POLICY "allowlist_admin" ON public.tamar_model_allowlist FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE TABLE public.tamar_model_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage text NOT NULL CHECK (stage IN ('intent_interpreter','response_writer','extractor','fallback')),
  model_id text NOT NULL,
  temperature numeric NOT NULL DEFAULT 0.3,
  max_tokens integer NOT NULL DEFAULT 900,
  timeout_ms integer NOT NULL DEFAULT 20000,
  retries integer NOT NULL DEFAULT 1,
  fallback_model text,
  structured_output boolean NOT NULL DEFAULT false,
  reasoning_effort text,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX tamar_model_registry_active_stage ON public.tamar_model_registry (stage) WHERE is_active;
GRANT SELECT ON public.tamar_model_registry TO authenticated;
GRANT ALL ON public.tamar_model_registry TO service_role;
ALTER TABLE public.tamar_model_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY "registry_read" ON public.tamar_model_registry FOR SELECT TO authenticated USING (true);
CREATE POLICY "registry_admin" ON public.tamar_model_registry FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE TRIGGER tamar_model_registry_touch BEFORE UPDATE ON public.tamar_model_registry FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.tamar_model_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage text NOT NULL,
  model_id text NOT NULL,
  ok boolean NOT NULL DEFAULT false,
  http_status integer,
  latency_ms integer,
  prompt_tokens integer,
  completion_tokens integer,
  fallback_used boolean NOT NULL DEFAULT false,
  attempt integer NOT NULL DEFAULT 1,
  error text,
  context text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tamar_model_calls_created_idx ON public.tamar_model_calls (created_at DESC);
GRANT SELECT ON public.tamar_model_calls TO authenticated;
GRANT ALL ON public.tamar_model_calls TO service_role;
ALTER TABLE public.tamar_model_calls ENABLE ROW LEVEL SECURITY;
CREATE POLICY "model_calls_read" ON public.tamar_model_calls FOR SELECT TO authenticated USING (true);

-- ============ agent versions ============
CREATE TABLE public.tamar_agent_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version integer NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','archived')),
  identity jsonb NOT NULL DEFAULT '{}'::jsonb,
  safety jsonb NOT NULL DEFAULT '{}'::jsonb,
  change_summary text,
  created_by text,
  activated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX tamar_agent_versions_version_idx ON public.tamar_agent_versions (version);
CREATE UNIQUE INDEX tamar_agent_versions_one_active ON public.tamar_agent_versions ((status)) WHERE status = 'active';
GRANT SELECT ON public.tamar_agent_versions TO authenticated;
GRANT ALL ON public.tamar_agent_versions TO service_role;
ALTER TABLE public.tamar_agent_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agent_versions_read" ON public.tamar_agent_versions FOR SELECT TO authenticated USING (true);
CREATE POLICY "agent_versions_admin" ON public.tamar_agent_versions FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE TRIGGER tamar_agent_versions_touch BEFORE UPDATE ON public.tamar_agent_versions FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ flow steps / options ============
CREATE TABLE public.tamar_flow_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_version_id uuid NOT NULL REFERENCES public.tamar_agent_versions(id) ON DELETE CASCADE,
  step_key text NOT NULL,
  field_key text,
  stage text NOT NULL DEFAULT 'intake',
  question_text text NOT NULL,
  help_text text,
  presentation text NOT NULL DEFAULT 'text' CHECK (presentation IN ('text','buttons','list')),
  required boolean NOT NULL DEFAULT false,
  skippable boolean NOT NULL DEFAULT true,
  conditions jsonb NOT NULL DEFAULT '{}'::jsonb,
  order_index integer NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX tamar_flow_steps_key_idx ON public.tamar_flow_steps (agent_version_id, step_key);
GRANT SELECT ON public.tamar_flow_steps TO authenticated;
GRANT ALL ON public.tamar_flow_steps TO service_role;
ALTER TABLE public.tamar_flow_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "flow_steps_read" ON public.tamar_flow_steps FOR SELECT TO authenticated USING (true);
CREATE POLICY "flow_steps_admin" ON public.tamar_flow_steps FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE TRIGGER tamar_flow_steps_touch BEFORE UPDATE ON public.tamar_flow_steps FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.tamar_flow_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  step_id uuid NOT NULL REFERENCES public.tamar_flow_steps(id) ON DELETE CASCADE,
  option_id text NOT NULL,
  label text NOT NULL,
  value text NOT NULL,
  order_index integer NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX tamar_flow_options_key_idx ON public.tamar_flow_options (step_id, option_id);
GRANT SELECT ON public.tamar_flow_options TO authenticated;
GRANT ALL ON public.tamar_flow_options TO service_role;
ALTER TABLE public.tamar_flow_options ENABLE ROW LEVEL SECURITY;
CREATE POLICY "flow_options_read" ON public.tamar_flow_options FOR SELECT TO authenticated USING (true);
CREATE POLICY "flow_options_admin" ON public.tamar_flow_options FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ============ evaluations ============
CREATE TABLE public.tamar_eval_suites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.tamar_eval_suites TO authenticated;
GRANT ALL ON public.tamar_eval_suites TO service_role;
ALTER TABLE public.tamar_eval_suites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "eval_suites_read" ON public.tamar_eval_suites FOR SELECT TO authenticated USING (true);
CREATE POLICY "eval_suites_admin" ON public.tamar_eval_suites FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE TABLE public.tamar_eval_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  suite_id uuid NOT NULL REFERENCES public.tamar_eval_suites(id) ON DELETE CASCADE,
  name text NOT NULL,
  inbound text NOT NULL,
  state text NOT NULL DEFAULT 'new_inbound',
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  expect jsonb NOT NULL DEFAULT '{}'::jsonb,
  order_index integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.tamar_eval_cases TO authenticated;
GRANT ALL ON public.tamar_eval_cases TO service_role;
ALTER TABLE public.tamar_eval_cases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "eval_cases_read" ON public.tamar_eval_cases FOR SELECT TO authenticated USING (true);
CREATE POLICY "eval_cases_admin" ON public.tamar_eval_cases FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE TABLE public.tamar_eval_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  suite_id uuid REFERENCES public.tamar_eval_suites(id) ON DELETE SET NULL,
  agent_version_id uuid REFERENCES public.tamar_agent_versions(id) ON DELETE SET NULL,
  mode text NOT NULL DEFAULT 'deterministic',
  total integer NOT NULL DEFAULT 0,
  passed integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  pass_rate numeric NOT NULL DEFAULT 0,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
GRANT SELECT ON public.tamar_eval_runs TO authenticated;
GRANT ALL ON public.tamar_eval_runs TO service_role;
ALTER TABLE public.tamar_eval_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "eval_runs_read" ON public.tamar_eval_runs FOR SELECT TO authenticated USING (true);
CREATE POLICY "eval_runs_admin" ON public.tamar_eval_runs FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE TABLE public.tamar_eval_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.tamar_eval_runs(id) ON DELETE CASCADE,
  case_name text NOT NULL,
  passed boolean NOT NULL DEFAULT false,
  actual jsonb NOT NULL DEFAULT '{}'::jsonb,
  failures jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.tamar_eval_results TO authenticated;
GRANT ALL ON public.tamar_eval_results TO service_role;
ALTER TABLE public.tamar_eval_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "eval_results_read" ON public.tamar_eval_results FOR SELECT TO authenticated USING (true);
CREATE POLICY "eval_results_admin" ON public.tamar_eval_results FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ============ feature flags + manager window ============
CREATE TABLE public.tamar_feature_flags (
  key text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  allowlist jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.tamar_feature_flags TO authenticated;
GRANT ALL ON public.tamar_feature_flags TO service_role;
ALTER TABLE public.tamar_feature_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "flags_read" ON public.tamar_feature_flags FOR SELECT TO authenticated USING (true);
CREATE POLICY "flags_admin" ON public.tamar_feature_flags FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE TRIGGER tamar_feature_flags_touch BEFORE UPDATE ON public.tamar_feature_flags FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.tamar_manager_window (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_phone text NOT NULL UNIQUE,
  last_inbound_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.tamar_manager_window TO authenticated;
GRANT ALL ON public.tamar_manager_window TO service_role;
ALTER TABLE public.tamar_manager_window ENABLE ROW LEVEL SECURITY;
CREATE POLICY "manager_window_admin" ON public.tamar_manager_window FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE TRIGGER tamar_manager_window_touch BEFORE UPDATE ON public.tamar_manager_window FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ seed: verified models ============
INSERT INTO public.tamar_model_allowlist (model_id, label, tier, verified_ok, verified_at, notes) VALUES
  ('openai/gpt-5.5','GPT-5.5 (flagship reasoning)','premium',true,now(),'verified 200 via gateway chat-completions; requires max_completion_tokens'),
  ('google/gemini-2.5-pro','Gemini 2.5 Pro (stable pro)','premium',true,now(),'verified 200 via gateway'),
  ('google/gemini-3.6-flash','Gemini 3.6 Flash','fast',true,now(),'verified 200 via gateway'),
  ('google/gemini-3.5-flash','Gemini 3.5 Flash','fast',true,now(),'verified 200 via gateway'),
  ('google/gemini-2.5-flash-lite','Gemini 2.5 Flash Lite','cheap',true,now(),'verified 200 via gateway')
ON CONFLICT (model_id) DO NOTHING;

INSERT INTO public.tamar_model_registry (stage, model_id, temperature, max_tokens, timeout_ms, retries, fallback_model, structured_output, reasoning_effort, notes) VALUES
  ('intent_interpreter','openai/gpt-5.5',0.1,1600,25000,1,'google/gemini-2.5-pro',true,'low','strongest verified model; strict JSON intent output'),
  ('response_writer','openai/gpt-5.5',0.4,1200,25000,1,'google/gemini-2.5-pro',false,'low','grounded Hebrew wording only'),
  ('extractor','google/gemini-3.6-flash',0.1,800,15000,1,'google/gemini-2.5-flash-lite',true,null,'fast entity extraction'),
  ('fallback','google/gemini-2.5-pro',0.3,900,15000,0,null,false,null,'last-resort stage');

INSERT INTO public.tamar_feature_flags (key, enabled, allowlist, notes) VALUES
  ('tamar_v2_enabled', false, '[]'::jsonb, 'V2 runtime stays in shadow/simulator mode until explicitly enabled')
ON CONFLICT (key) DO NOTHING;

-- ============ seed: agent version 1 (active) + flow ============
INSERT INTO public.tamar_agent_versions (version, status, identity, safety, change_summary, created_by, activated_at)
VALUES (
  1,'active',
  jsonb_build_object(
    'name','תמר',
    'role','העוזרת הדיגיטלית של זוגה',
    'tone','חמה, ישירה, אנושית',
    'warmth','high',
    'verbosity','short',
    'phrases', jsonb_build_array('בשמחה','אשמח לעזור','נשמע לי מתאים'),
    'forbidden_phrases', jsonb_build_array('אני בן אדם','מובטח','זול ביותר','הכי טוב בעולם'),
    'examples', jsonb_build_array('היי, אני תמר, העוזרת הדיגיטלית של זוגה 🙂 בכל שלב אפשר לבקש לדבר עם אדם מהצוות.')
  ),
  jsonb_build_object(
    'min_confidence_state_change',70,
    'min_confidence_marketing',75,
    'ambiguity_limit',2,
    'max_offers',2,
    'max_questions_per_message',1,
    'handoff_on_explicit_request',true,
    'handoff_on_distress',true,
    'optout_requires_explicit',true
  ),
  'Tamar Brain V2 initial version','system',now()
);

INSERT INTO public.tamar_flow_steps (agent_version_id, step_key, field_key, stage, question_text, help_text, presentation, required, skippable, order_index)
SELECT v.id, s.step_key, s.field_key, s.stage, s.question_text, s.help_text, s.presentation, s.required, s.skippable, s.order_index
FROM public.tamar_agent_versions v,
(VALUES
  ('consent','consent_marketing','consent','אפשר להמשיך לשלוח לך כאן עדכונים והצעות מזוגה?','נדרש אישור לפני כל תוכן שיווקי','buttons',true,false,10),
  ('relationship_status','relationship_status','intake','מה המצב המשפחתי שלך כרגע?','ניסוח ניטרלי, אפשר לדלג','list',false,true,20),
  ('goal','goal','intake','מה הכי מעניין אותך בזוגה?',null,'list',false,true,30),
  ('preferred_activity','preferred_activity','intake','איזה סוג חוויה הכי מתאים לך?',null,'list',false,true,40),
  ('region','region','intake','מאיזה אזור בארץ נוח לך לצאת?',null,'list',false,true,50),
  ('first_name','first_name','intake','איך לפנות אליך?','שאלה פתוחה','text',false,true,60),
  ('special_requests','special_requests','intake','יש משהו מיוחד שחשוב לך שאדע?','שאלה פתוחה, עדיפות גבוהה','text',false,true,70),
  ('budget_sensitivity','budget_sensitivity','qualification','מבחינת תקציב — מה מרגיש לך נכון להצעה הזו?','נשאל רק כשיש הצעה קונקרטית על השולחן','list',false,true,80)
) AS s(step_key, field_key, stage, question_text, help_text, presentation, required, skippable, order_index)
WHERE v.version = 1;

INSERT INTO public.tamar_flow_options (step_id, option_id, label, value, order_index)
SELECT st.id, o.option_id, o.label, o.value, o.order_index
FROM public.tamar_flow_steps st
JOIN public.tamar_agent_versions v ON v.id = st.agent_version_id AND v.version = 1
JOIN (VALUES
  ('consent','consent_yes','כן, בשמחה','yes',1),
  ('consent','consent_no','לא, תודה','no',2),
  ('consent','consent_explain','רוצה הסבר','explain',3),
  ('relationship_status','rs_single','פנוי/ה','single',1),
  ('relationship_status','rs_divorced','גרוש/ה','divorced',2),
  ('relationship_status','rs_widowed','אלמן/ה','widowed',3),
  ('relationship_status','rs_couple','בזוגיות','in_relationship',4),
  ('relationship_status','rs_skip','מעדיפ/ה לא לענות','prefer_not_to_say',5),
  ('goal','goal_trips','טיולים וחוויות','trips',1),
  ('goal','goal_people','להכיר אנשים חדשים','new_people',2),
  ('goal','goal_dating','זוגיות','dating',3),
  ('goal','goal_community','קהילה ופעילויות','community',4),
  ('goal','goal_mix','שילוב','mix',5),
  ('preferred_activity','act_culture','תרבות ונופים','culture',1),
  ('preferred_activity','act_social','חוויה חברתית','social',2),
  ('preferred_activity','act_relax','פינוק ורוגע','relax',3),
  ('preferred_activity','act_nature','טבע והרפתקה','nature',4),
  ('preferred_activity','act_unknown','עדיין לא יודע/ת','unknown',5),
  ('region','reg_north','צפון','north',1),
  ('region','reg_center','מרכז','center',2),
  ('region','reg_south','דרום','south',3),
  ('region','reg_jlm','ירושלים והסביבה','jerusalem',4),
  ('region','reg_any','גמיש/ה','any',5),
  ('budget_sensitivity','bud_value','חשוב לי ערך למחיר','value',1),
  ('budget_sensitivity','bud_mid','באמצע','standard',2),
  ('budget_sensitivity','bud_premium','מוכן/ה להשקיע בחוויה','premium',3)
) AS o(step_key, option_id, label, value, order_index) ON o.step_key = st.step_key;