-- 2026-02-04: support upsert on acreencias (proceso_id, apoderado_id, acreedor_id)
-- Required for Postgres `ON CONFLICT (proceso_id, apoderado_id, acreedor_id)`.
CREATE UNIQUE INDEX IF NOT EXISTS acreencias_proceso_apoderado_acreedor_uidx
  ON public.acreencias (proceso_id, apoderado_id, acreedor_id);

