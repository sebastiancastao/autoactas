-- Link procesos to public.usuarios for app-level ownership.
ALTER TABLE public.proceso
ADD COLUMN IF NOT EXISTS usuario_id UUID REFERENCES public.usuarios(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_proceso_usuario_id
ON public.proceso(usuario_id);

-- Backfill when created_by_auth_id already exists.
UPDATE public.proceso AS p
SET usuario_id = u.id
FROM public.usuarios AS u
WHERE p.usuario_id IS NULL
  AND p.created_by_auth_id IS NOT NULL
  AND u.auth_id = p.created_by_auth_id;

-- Refresh PostgREST schema cache.
NOTIFY pgrst, 'reload schema';
