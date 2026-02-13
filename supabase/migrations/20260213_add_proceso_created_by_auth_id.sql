-- Track who created each proceso to support user-specific listings.
ALTER TABLE public.proceso
ADD COLUMN IF NOT EXISTS created_by_auth_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_proceso_created_by_auth_id
ON public.proceso(created_by_auth_id);

-- Refresh PostgREST schema cache.
NOTIFY pgrst, 'reload schema';
