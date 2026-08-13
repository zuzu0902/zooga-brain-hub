DROP INDEX IF EXISTS public.conversation_turns_inbound_route_uidx;
CREATE UNIQUE INDEX conversation_turns_inbound_route_uidx
  ON public.conversation_turns (inbound_message_id, route);