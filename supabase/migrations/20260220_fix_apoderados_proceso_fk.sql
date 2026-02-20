-- 2026-02-20: normalize apoderados -> proceso foreign keys to ON DELETE SET NULL.
-- Some environments still have a legacy FK (apoderados_proceso_fkey) that blocks
-- deleting procesos even after logical cleanup.
DO $$
DECLARE
  fk RECORD;
BEGIN
  FOR fk IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'apoderados'
      AND c.contype = 'f'
      AND c.confrelid = 'public.proceso'::regclass
  LOOP
    EXECUTE format('ALTER TABLE public.apoderados DROP CONSTRAINT IF EXISTS %I', fk.conname);
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'apoderados'
      AND column_name = 'proceso_id'
  ) THEN
    EXECUTE '
      ALTER TABLE public.apoderados
      ADD CONSTRAINT apoderados_proceso_id_fkey
      FOREIGN KEY (proceso_id)
      REFERENCES public.proceso(id)
      ON DELETE SET NULL
    ';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'apoderados'
      AND column_name = 'proceso'
  ) THEN
    EXECUTE '
      ALTER TABLE public.apoderados
      ADD CONSTRAINT apoderados_proceso_fkey
      FOREIGN KEY (proceso)
      REFERENCES public.proceso(id)
      ON DELETE SET NULL
    ';
  END IF;
END $$;
