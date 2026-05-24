
DROP POLICY IF EXISTS "public read api_settings" ON public.api_settings;
DROP POLICY IF EXISTS "public write api_settings" ON public.api_settings;
DROP POLICY IF EXISTS "public read campaign_contacts" ON public.campaign_contacts;
DROP POLICY IF EXISTS "public write campaign_contacts" ON public.campaign_contacts;
DROP POLICY IF EXISTS "public read campaigns" ON public.campaigns;
DROP POLICY IF EXISTS "public write campaigns" ON public.campaigns;
DROP POLICY IF EXISTS "public read contact_memories" ON public.contact_memories;
DROP POLICY IF EXISTS "public write contact_memories" ON public.contact_memories;
DROP POLICY IF EXISTS "public read contact_profile_history" ON public.contact_profile_history;
DROP POLICY IF EXISTS "public write contact_profile_history" ON public.contact_profile_history;
DROP POLICY IF EXISTS "public read contacts" ON public.contacts;
DROP POLICY IF EXISTS "public write contacts" ON public.contacts;
DROP POLICY IF EXISTS "public read extracted_attributes" ON public.extracted_attributes;
DROP POLICY IF EXISTS "public write extracted_attributes" ON public.extracted_attributes;

DROP POLICY IF EXISTS "public read imported_leads" ON public.imported_leads;
DROP POLICY IF EXISTS "public write imported_leads" ON public.imported_leads;
CREATE POLICY "admins read imported_leads" ON public.imported_leads
  FOR SELECT USING (public.is_admin());
CREATE POLICY "admins write imported_leads" ON public.imported_leads
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "public read intake_campaigns" ON public.intake_campaigns;
DROP POLICY IF EXISTS "public write intake_campaigns" ON public.intake_campaigns;
CREATE POLICY "admins read intake_campaigns" ON public.intake_campaigns
  FOR SELECT USING (public.is_admin());
CREATE POLICY "admins write intake_campaigns" ON public.intake_campaigns
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "public read intake_inbox" ON public.intake_inbox;
DROP POLICY IF EXISTS "public write intake_inbox" ON public.intake_inbox;
DROP POLICY IF EXISTS "public read interactions" ON public.interactions;
DROP POLICY IF EXISTS "public write interactions" ON public.interactions;
DROP POLICY IF EXISTS "public read messages" ON public.messages;
DROP POLICY IF EXISTS "public write messages" ON public.messages;

DROP POLICY IF EXISTS "public write offers" ON public.offers;

DROP POLICY IF EXISTS "public read pending_ai_insights" ON public.pending_ai_insights;
DROP POLICY IF EXISTS "public write pending_ai_insights" ON public.pending_ai_insights;

DROP POLICY IF EXISTS "public read tasks" ON public.tasks;
DROP POLICY IF EXISTS "public write tasks" ON public.tasks;
CREATE POLICY "admins read tasks" ON public.tasks
  FOR SELECT USING (public.is_admin());
CREATE POLICY "admins write tasks" ON public.tasks
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "public read webhook_logs" ON public.webhook_logs;
DROP POLICY IF EXISTS "public write webhook_logs" ON public.webhook_logs;
