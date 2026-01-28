-- 2026-01-28: associate apoderados with procesos
ALTER TABLE public.apoderados
  ADD COLUMN IF NOT EXISTS proceso_id UUID REFERENCES public.proceso(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_apoderados_proceso ON public.apoderados(proceso_id);
