-- 2026-02-05: add updated_at + trigger for acreencias
-- Needed to display in /lista when an apoderado updated an acreencia.

ALTER TABLE public.acreencias
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();

-- Backfill in case column existed but had NULLs
UPDATE public.acreencias
SET updated_at = NOW()
WHERE updated_at IS NULL;

-- Generic function to keep updated_at in sync (safe to OR REPLACE)
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

DO $$
BEGIN
  -- Recreate trigger to avoid stale definitions.
  DROP TRIGGER IF EXISTS update_acreencias_updated_at ON public.acreencias;

  CREATE TRIGGER update_acreencias_updated_at
    BEFORE UPDATE ON public.acreencias
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();
END $$;
