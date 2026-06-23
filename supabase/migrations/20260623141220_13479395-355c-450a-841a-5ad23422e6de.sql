ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS last_presented_offers jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS last_presented_offers_at timestamptz;