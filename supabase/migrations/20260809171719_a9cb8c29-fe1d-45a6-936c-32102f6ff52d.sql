-- 1. questions
CREATE TABLE public.relationship_intake_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_key text NOT NULL UNIQUE,
  label text NOT NULL,
  question_text text NOT NULL,
  order_index integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  skippable boolean NOT NULL DEFAULT true,
  required boolean NOT NULL DEFAULT false,
  is_final_question boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.relationship_intake_questions TO authenticated;
GRANT ALL ON public.relationship_intake_questions TO service_role;
ALTER TABLE public.relationship_intake_questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read relationship questions" ON public.relationship_intake_questions FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth manage relationship questions" ON public.relationship_intake_questions FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER relationship_intake_questions_touch BEFORE UPDATE ON public.relationship_intake_questions FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 2. config (singleton)
CREATE TABLE public.relationship_intake_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  intro_text text NOT NULL,
  completion_text text NOT NULL,
  voice_enabled boolean NOT NULL DEFAULT true,
  voice_rules text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.relationship_intake_config TO authenticated;
GRANT ALL ON public.relationship_intake_config TO service_role;
ALTER TABLE public.relationship_intake_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read relationship config" ON public.relationship_intake_config FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth manage relationship config" ON public.relationship_intake_config FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER relationship_intake_config_touch BEFORE UPDATE ON public.relationship_intake_config FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 3. answers (append-only history, is_current flag)
CREATE TABLE public.relationship_intake_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  question_key text NOT NULL,
  raw_text text,
  structured_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text NOT NULL DEFAULT 'text',
  evidence_message_id text,
  confidence numeric,
  skipped_by_user boolean NOT NULL DEFAULT false,
  is_current boolean NOT NULL DEFAULT true,
  is_correction boolean NOT NULL DEFAULT false,
  asked_at timestamptz,
  answered_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX relationship_answers_current_uniq ON public.relationship_intake_answers (contact_id, question_key) WHERE is_current;
CREATE INDEX relationship_answers_contact_idx ON public.relationship_intake_answers (contact_id, created_at DESC);
CREATE UNIQUE INDEX relationship_answers_evidence_uniq ON public.relationship_intake_answers (contact_id, question_key, evidence_message_id) WHERE evidence_message_id IS NOT NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.relationship_intake_answers TO authenticated;
GRANT ALL ON public.relationship_intake_answers TO service_role;
ALTER TABLE public.relationship_intake_answers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read relationship answers" ON public.relationship_intake_answers FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth manage relationship answers" ON public.relationship_intake_answers FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER relationship_intake_answers_touch BEFORE UPDATE ON public.relationship_intake_answers FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 4. per-contact questionnaire state
CREATE TABLE public.relationship_intake_state (
  contact_id uuid PRIMARY KEY REFERENCES public.contacts(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'not_started',
  current_question_key text,
  intro_sent_at timestamptz,
  started_at timestamptz,
  last_answered_at timestamptz,
  completed_at timestamptz,
  completion_sent_at timestamptz,
  pending_confirmation jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.relationship_intake_state TO authenticated;
GRANT ALL ON public.relationship_intake_state TO service_role;
ALTER TABLE public.relationship_intake_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read relationship state" ON public.relationship_intake_state FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth manage relationship state" ON public.relationship_intake_state FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER relationship_intake_state_touch BEFORE UPDATE ON public.relationship_intake_state FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 5. voice transcripts (no raw audio ever persisted)
CREATE TABLE public.voice_transcripts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid REFERENCES public.contacts(id) ON DELETE CASCADE,
  wa_message_id text NOT NULL UNIQUE,
  media_id text,
  mime_type text,
  size_bytes integer,
  duration_seconds integer,
  language text,
  provider text,
  model text,
  transcript text,
  confidence numeric,
  status text NOT NULL DEFAULT 'pending',
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX voice_transcripts_contact_idx ON public.voice_transcripts (contact_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.voice_transcripts TO authenticated;
GRANT ALL ON public.voice_transcripts TO service_role;
ALTER TABLE public.voice_transcripts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read voice transcripts" ON public.voice_transcripts FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth manage voice transcripts" ON public.voice_transcripts FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER voice_transcripts_touch BEFORE UPDATE ON public.voice_transcripts FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 6. seed config + the 18 approved questions + closing question
INSERT INTO public.relationship_intake_config (id, intro_text, completion_text, voice_rules)
VALUES (
  true,
  'מעולה, אשמח להכיר אותך קצת יותר. אשאל בכל פעם שאלה אחת, ואפשר לענות בחופשיות ובכמה מילים שנוח לך. אפשר לענות בכתיבה או בהודעה קולית — מה שנוח לך. אם יש שאלה שפחות נוח לענות עליה, אפשר לדלג ולהמשיך.',
  'תודה ששיתפת אותי. הדברים שסיפרת עוזרים לי להכיר אותך טוב יותר, ובהמשך אוכל לעדכן אותך על היכרויות ואירועים שעשויים להתאים לך. תמיד אפשר לחזור אליי, להוסיף מידע או לתקן משהו.',
  'הודעות קוליות מתומללות בשרת בלבד. קובץ האודיו אינו נשמר. תמלול לא ודאי מחייב שאלת אימות ממוקדת לפני שמירת ערך מובנה.'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.relationship_intake_questions (question_key, label, question_text, order_index, is_final_question) VALUES
('relationship_status','סטטוס זוגי','מה הסטטוס הזוגי שלך כיום? לדוגמה: רווקות, גירושין, אלמנות, זוגיות או מצב אחר.',10,false),
('last_relationship','מערכת היחסים האחרונה','כמה זמן נמשכה מערכת היחסים המשמעותית האחרונה שלך, ומתי היא הסתיימה?',20,false),
('readiness_feeling','תחושה לגבי קשר חדש','איך מרגיש לך היום להיכנס למערכת יחסים חדשה?',30,false),
('desired_relationship_type','סוג הקשר הרצוי','איזה סוג של מערכת יחסים היית רוצה לבנות בתקופה הזו?',40,false),
('desired_partner_gender','את מי להכיר','את מי היית רוצה להכיר? אפשר לציין מגדר או כל העדפה אחרת שרלוונטית עבורך.',50,false),
('age_range','טווח גילאים','באיזה טווח גילאים היית רוצה להכיר?',60,false),
('geography','אזורים וגמישות','באילו אזורים בארץ מתאים לך להכיר, ועד כמה יש מבחינתך גמישות גיאוגרפית?',70,false),
('important_traits','תכונות וערכים חשובים','אילו תכונות וערכים חשוב לך למצוא באדם שאיתו תיבנה מערכת יחסים?',80,false),
('dealbreakers','דברים להימנע מהם','האם יש תכונות, הרגלים או פערים שחשוב לך להימנע מהם בקשר?',90,false),
('height','גובה','מה הגובה שלך?',100,false),
('education','השכלה','מהי רמת ההשכלה שלך, ובאילו תחומים למדת?',110,false),
('children','ילדים','האם יש לך ילדים? אם כן, כמה ובאילו גילאים — רק אם נוח לך לשתף.',120,false),
('occupation','מקצוע ותעסוקה','מה המקצוע שלך ובאיזה תחום נמצאת העבודה שלך כיום?',130,false),
('lifestyle','אורח חיים','איך נראה אורח החיים שלך ביום־יום, ומה אוהבים לעשות בזמן הפנוי?',140,false),
('religiosity','אורח חיים בקשר','האם יש אורח חיים מסוים שחשוב לך בקשר, למשל חילוני, מסורתי, דתי או משהו אחר?',150,false),
('habits_preferences','העדפות והרגלים','האם יש העדפות חשובות בנוגע לעישון, תזונה, בעלי חיים או הרגלי חיים אחרים?',160,false),
('future_plans','נישואין ומגורים','עד כמה חשובים לך נישואין, מגורים משותפים או ילדים בעתיד?',170,false),
('relationship_values','מה עושה קשר טוב','מה לדעתך הופך מערכת יחסים למערכת יחסים טובה ומצליחה?',180,false),
('anything_else','משהו נוסף','האם יש עוד משהו שהיית רוצה לספר על עצמך, על האדם שהיית רוצה להכיר או על הציפיות שלך ממערכת יחסים וזוגיות?',190,true)
ON CONFLICT (question_key) DO NOTHING;