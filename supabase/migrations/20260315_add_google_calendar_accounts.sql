create table if not exists public.google_calendar_accounts (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null unique references public.usuarios(id) on delete cascade,
  google_email text not null,
  refresh_token text not null,
  scope text null,
  token_type text null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists google_calendar_accounts_usuario_id_idx
  on public.google_calendar_accounts (usuario_id);

alter table public.google_calendar_accounts enable row level security;
