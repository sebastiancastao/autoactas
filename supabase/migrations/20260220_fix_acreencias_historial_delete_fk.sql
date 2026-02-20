-- 2026-02-20: allow acreencias delete history inserts.
-- The delete trigger writes a historial row after deleting acreencias.
-- Keeping a hard FK from historial.acreencia_id -> acreencias.id makes that impossible.
ALTER TABLE IF EXISTS public.acreencias_historial
  DROP CONSTRAINT IF EXISTS acreencias_historial_acreencia_id_fkey;
