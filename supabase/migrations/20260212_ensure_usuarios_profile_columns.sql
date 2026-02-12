-- Ensure profile-related columns exist in legacy environments.
ALTER TABLE public.usuarios
ADD COLUMN IF NOT EXISTS identificacion VARCHAR(50);

ALTER TABLE public.usuarios
ADD COLUMN IF NOT EXISTS tarjeta_profesional VARCHAR(100);

ALTER TABLE public.usuarios
ADD COLUMN IF NOT EXISTS firma_data_url TEXT;

-- Refresh PostgREST schema cache to avoid transient PGRST204 errors.
NOTIFY pgrst, 'reload schema';
