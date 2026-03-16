alter table public.eventos
  add column if not exists google_calendar_event_id text,
  add column if not exists google_calendar_html_link text,
  add column if not exists google_meet_url text,
  add column if not exists google_sync_status text,
  add column if not exists google_sync_error text,
  add column if not exists google_sync_updated_at timestamptz;

create index if not exists eventos_google_calendar_event_id_idx
  on public.eventos (google_calendar_event_id)
  where google_calendar_event_id is not null;
