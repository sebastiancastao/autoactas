-- 2026-03-20: persist whether an apoderado belongs to acreedor or deudor flows.
ALTER TABLE public.apoderados
  ADD COLUMN IF NOT EXISTS categoria_proceso TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'apoderados_categoria_proceso_check'
  ) THEN
    ALTER TABLE public.apoderados
      ADD CONSTRAINT apoderados_categoria_proceso_check
      CHECK (categoria_proceso IS NULL OR categoria_proceso IN ('acreedor', 'deudor'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_apoderados_categoria_proceso
  ON public.apoderados(categoria_proceso);
