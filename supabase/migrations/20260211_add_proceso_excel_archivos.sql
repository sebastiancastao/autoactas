-- 2026-02-11: persist uploaded Excel files per proceso
CREATE TABLE IF NOT EXISTS public.proceso_excel_archivos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  proceso_id UUID NOT NULL REFERENCES public.proceso(id) ON DELETE CASCADE,
  original_file_name TEXT NOT NULL,
  drive_file_id TEXT NOT NULL,
  drive_file_name TEXT NOT NULL,
  drive_web_view_link TEXT NULL,
  drive_web_content_link TEXT NULL,
  mime_type TEXT NOT NULL,
  uploaded_by_auth_id UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proceso_excel_archivos_proceso_created_at
  ON public.proceso_excel_archivos (proceso_id, created_at DESC);

ALTER TABLE public.proceso_excel_archivos ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'proceso_excel_archivos'
      AND policyname = 'Allow all for authenticated users'
  ) THEN
    CREATE POLICY "Allow all for authenticated users" ON public.proceso_excel_archivos
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

