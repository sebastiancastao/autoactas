-- Ensure auth signup metadata also populates usuarios.identificacion.
ALTER TABLE public.usuarios
ADD COLUMN IF NOT EXISTS identificacion VARCHAR(50);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  metadata_identificacion TEXT;
BEGIN
  metadata_identificacion := COALESCE(
    NEW.raw_user_meta_data->>'identificacion',
    NEW.raw_user_meta_data->>'cedula',
    NEW.raw_user_meta_data->>'numero_cedula'
  );

  INSERT INTO public.usuarios (auth_id, email, nombre, identificacion)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NEW.raw_user_meta_data->>'nombre',
      NEW.raw_user_meta_data->>'full_name',
      split_part(NEW.email, '@', 1)
    ),
    NULLIF(TRIM(metadata_identificacion), '')
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Backfill missing identificacion values from auth metadata when available.
UPDATE public.usuarios AS u
SET identificacion = NULLIF(
  TRIM(
    COALESCE(
      au.raw_user_meta_data->>'identificacion',
      au.raw_user_meta_data->>'cedula',
      au.raw_user_meta_data->>'numero_cedula'
    )
  ),
  ''
)
FROM auth.users AS au
WHERE u.auth_id = au.id
  AND (u.identificacion IS NULL OR TRIM(u.identificacion) = '')
  AND NULLIF(
    TRIM(
      COALESCE(
        au.raw_user_meta_data->>'identificacion',
        au.raw_user_meta_data->>'cedula',
        au.raw_user_meta_data->>'numero_cedula'
      )
    ),
    ''
  ) IS NOT NULL;
