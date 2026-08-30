-- Checkpoint schema + RLS
-- Review this before running. Not executed automatically.
--
-- Security note: Checkpoint has no login/account system (by design — see
-- CLAD_PROMPT_LOG.md, "simple name entry" decision), so the Lens talks to
-- Supabase using only the anon key. There is no per-user identity for RLS
-- to scope against. The policies below therefore grant the anon role broad
-- read/write access, scoped only by table (no DELETE policies anywhere —
-- deletion is soft via `deleted = true` on notes, so a leaked anon key
-- can't destroy data, only see/add/edit it). This is acceptable for a
-- hackathon prototype but is NOT how you'd want a real production
-- deployment secured — that would need either Supabase Auth or an Edge
-- Function fronting writes with server-side validation.

create extension if not exists "pgcrypto";

create table if not exists sites (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  latitude double precision not null,
  longitude double precision not null,
  custom_location_id text,
  created_at timestamptz not null default now()
);

create table if not exists notes (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  type text not null check (type in ('plain', 'info', 'warning', 'danger')),
  text_en text not null,
  anchor_offset jsonb not null, -- {x, y, z} relative to the site's LocatedAtComponent node
  created_by text,
  created_at timestamptz not null default now(),
  deleted boolean not null default false
);

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  technician_name text,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create table if not exists session_captures (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  kind text not null check (kind in ('image', 'transcript_chunk')),
  storage_path text,   -- set when kind = 'image'
  text_content text,   -- set when kind = 'transcript_chunk'
  captured_at timestamptz not null default now()
);

create table if not exists summaries (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  session_id uuid not null references sessions(id) on delete cascade,
  version_number int not null,
  summary_text text not null,
  equipment_mentioned text[] not null default '{}',
  parts_changed text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (site_id, version_number)
);

create index if not exists notes_site_id_idx on notes(site_id);
create index if not exists session_captures_session_id_idx on session_captures(session_id);
create index if not exists summaries_site_id_idx on summaries(site_id);

-- RLS

alter table sites enable row level security;
alter table notes enable row level security;
alter table sessions enable row level security;
alter table session_captures enable row level security;
alter table summaries enable row level security;

create policy "anon read sites" on sites for select to anon using (true);
create policy "anon insert sites" on sites for insert to anon with check (true);
create policy "anon update sites" on sites for update to anon using (true) with check (true);

create policy "anon read notes" on notes for select to anon using (true);
create policy "anon insert notes" on notes for insert to anon with check (true);
create policy "anon update notes" on notes for update to anon using (true) with check (true); -- soft delete only

create policy "anon read sessions" on sessions for select to anon using (true);
create policy "anon insert sessions" on sessions for insert to anon with check (true);
create policy "anon update sessions" on sessions for update to anon using (true) with check (true); -- set ended_at

create policy "anon read session_captures" on session_captures for select to anon using (true);
create policy "anon insert session_captures" on session_captures for insert to anon with check (true);

create policy "anon read summaries" on summaries for select to anon using (true);
create policy "anon insert summaries" on summaries for insert to anon with check (true);

-- Storage bucket for reference images captured during sessions.
-- Run once; ignored if it already exists.
insert into storage.buckets (id, name, public)
values ('session-captures', 'session-captures', true)
on conflict (id) do nothing;

create policy "anon read session-captures bucket" on storage.objects for select to anon
  using (bucket_id = 'session-captures');
create policy "anon upload session-captures bucket" on storage.objects for insert to anon
  with check (bucket_id = 'session-captures');
