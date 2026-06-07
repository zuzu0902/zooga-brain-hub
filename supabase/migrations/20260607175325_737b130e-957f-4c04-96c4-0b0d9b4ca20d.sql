ALTER TABLE public.offers ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'ILS';
ALTER TABLE public.offers DROP CONSTRAINT IF EXISTS offers_currency_check;
ALTER TABLE public.offers ADD CONSTRAINT offers_currency_check CHECK (currency IN ('ILS','USD','EUR'));
UPDATE public.offers SET currency = 'USD' WHERE id = '1afaec91-4c77-4715-aceb-633f5bbe6093';