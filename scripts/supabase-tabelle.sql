-- Speicher der Website in Supabase. Einmalig im SQL Editor des Projekts ausführen.
create table if not exists public.dateien (
  pfad text primary key,
  inhalt text not null,
  binaer boolean not null default false,
  typ text not null default '',
  geaendert timestamptz not null default now()
);

create index if not exists dateien_pfad_like on public.dateien (pfad text_pattern_ops);

-- Nur die Website mit dem geheimen Schlüssel darf zugreifen, nicht der öffentliche Schlüssel.
alter table public.dateien enable row level security;
revoke all on table public.dateien from anon, authenticated;
grant select, insert, update, delete on table public.dateien to service_role;
