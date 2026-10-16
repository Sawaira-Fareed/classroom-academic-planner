-- Apply in Supabase SQL Editor. All user-owned records have RLS.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  google_course_id text,
  name text not null,
  course_code text,
  section text,
  instructor text,
  origin text not null default 'google_classroom' check (origin in ('google_classroom','custom')),
  is_archived boolean not null default false,
  course_state text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, google_course_id),
  check ((origin = 'google_classroom' and google_course_id is not null) or
         (origin = 'custom' and google_course_id is null))
);

create table if not exists public.sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid references public.courses(id) on delete set null,
  provider text not null check (provider in ('classroom_announcement','classroom_coursework','classroom_material','gmail')),
  external_id text not null,
  title text not null,
  body text,
  source_url text,
  published_at timestamptz,
  source_updated_at timestamptz,
  content_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, provider, external_id)
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid references public.courses(id) on delete set null,
  source_id uuid references public.sources(id) on delete set null,
  title text not null check (char_length(title) <= 240),
  description text,
  task_type text not null default 'other' check (task_type in ('assignment','lecture_topic','quiz_exam','lab_demo','revision','other')),
  due_at timestamptz,
  due_date_explicit boolean not null default false,
  confidence numeric(4,3) check (confidence between 0 and 1),
  status text not null default 'pending_review' check (status in ('pending_review','approved','in_progress','completed','dismissed')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  is_ai_generated boolean not null default false,
  user_notes text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.schedule_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete cascade,
  title text not null,
  block_type text not null check (block_type in ('lecture','lab','deadline','revision','study','other')),
  start_at timestamptz not null,
  end_at timestamptz not null,
  timezone text not null default 'Asia/Karachi',
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_at > start_at)
);

create table if not exists public.google_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  google_subject text,
  google_email text,
  -- Store only encrypted tokens here; encryption/decryption belongs in a server-only vault.
  refresh_token_ciphertext text,
  token_key_version text,
  scopes text[] not null default '{}',
  study_calendar_id text,
  sync_lease_until timestamptz,
  connected_at timestamptz,
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.calendar_sync (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete cascade,
  schedule_block_id uuid references public.schedule_blocks(id) on delete cascade,
  google_event_id text not null,
  calendar_id text not null,
  payload_hash text,
  sync_status text not null default 'synced' check (sync_status in ('pending','synced','failed','deleted')),
  last_error text,
  updated_at timestamptz not null default now(),
  unique(user_id, calendar_id, google_event_id)
);

create table if not exists public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  provider text not null,
  status text not null check (status in ('running','success','partial','failed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  imported_count integer not null default 0,
  updated_count integer not null default 0,
  error_code text,
  error_summary text
);

create table if not exists public.ai_request_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_started_at timestamptz not null,
  request_count integer not null default 0
);

create table if not exists public.progress_snapshots (
  user_id uuid not null references auth.users(id) on delete cascade,
  snapshot_date date not null,
  total_tasks integer not null default 0 check (total_tasks >= 0),
  completed_tasks integer not null default 0 check (completed_tasks >= 0 and completed_tasks <= total_tasks),
  created_at timestamptz not null default now(),
  primary key (user_id, snapshot_date)
);

create index if not exists sources_user_updated_idx on public.sources(user_id, updated_at desc);
create index if not exists courses_google_external_id_unique on public.courses(user_id, google_course_id) where google_course_id is not null;
create index if not exists courses_user_active_idx on public.courses(user_id, is_archived, name);
create index if not exists tasks_user_status_due_idx on public.tasks(user_id, status, due_at);
create unique index if not exists tasks_source_unique on public.tasks(source_id);
create index if not exists blocks_user_start_idx on public.schedule_blocks(user_id, start_at);
create index if not exists sync_runs_user_started_idx on public.sync_runs(user_id, started_at desc);

alter table public.profiles enable row level security;
alter table public.courses enable row level security;
alter table public.sources enable row level security;
alter table public.tasks enable row level security;
alter table public.schedule_blocks enable row level security;
alter table public.google_connections enable row level security;
alter table public.calendar_sync enable row level security;
alter table public.sync_runs enable row level security;
alter table public.ai_request_limits enable row level security;
alter table public.progress_snapshots enable row level security;
revoke all on public.ai_request_limits from public, anon, authenticated;
grant all on public.ai_request_limits to service_role;

-- User-scoped access policies. Service-role operations bypass RLS and must remain server-only.
do $$
declare t text;
begin
  foreach t in array array['courses','sources','tasks','schedule_blocks','google_connections','calendar_sync','sync_runs']
  loop
    execute format('drop policy if exists "Users can read own %I" on public.%I', t, t);
    execute format('create policy "Users can read own %I" on public.%I for select using (auth.uid() = user_id)', t, t);
  end loop;
end $$;

-- Profiles use id rather than user_id.
drop policy if exists "Users can read own profile" on public.profiles;
create policy "Users can read own profile" on public.profiles for select using (auth.uid() = id);
drop policy if exists "Users can read own progress snapshots" on public.progress_snapshots;
create policy "Users can read own progress snapshots" on public.progress_snapshots for select using (auth.uid() = user_id);
drop policy if exists "Users can insert own progress snapshots" on public.progress_snapshots;
create policy "Users can insert own progress snapshots" on public.progress_snapshots for insert with check (auth.uid() = user_id);
drop policy if exists "Users can update own progress snapshots" on public.progress_snapshots;
create policy "Users can update own progress snapshots" on public.progress_snapshots for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Browser CRUD is enabled for normal user-owned planner data. Google tokens are server-only;
-- do not expose google_connections to browser queries in the app.
create policy "Users can insert own courses" on public.courses for insert with check (auth.uid() = user_id);
create policy "Users can update own courses" on public.courses for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can delete own courses" on public.courses for delete using (auth.uid() = user_id);

create policy "Users can insert own sources" on public.sources for insert with check (
  auth.uid() = user_id and
  (course_id is null or exists (
    select 1 from public.courses c where c.id = course_id and c.user_id = auth.uid()
  ))
);
create policy "Users can update own sources" on public.sources for update using (auth.uid() = user_id) with check (
  auth.uid() = user_id and
  (course_id is null or exists (
    select 1 from public.courses c where c.id = course_id and c.user_id = auth.uid()
  ))
);

create policy "Users can insert own tasks" on public.tasks for insert with check (
  auth.uid() = user_id and
  (course_id is null or exists (
    select 1 from public.courses c where c.id = course_id and c.user_id = auth.uid()
  )) and
  (source_id is null or exists (
    select 1 from public.sources s where s.id = source_id and s.user_id = auth.uid()
  ))
);
create policy "Users can update own tasks" on public.tasks for update using (auth.uid() = user_id) with check (
  auth.uid() = user_id and
  (course_id is null or exists (
    select 1 from public.courses c where c.id = course_id and c.user_id = auth.uid()
  )) and
  (source_id is null or exists (
    select 1 from public.sources s where s.id = source_id and s.user_id = auth.uid()
  ))
);
create policy "Users can delete own tasks" on public.tasks for delete using (auth.uid() = user_id);

create policy "Users can insert own schedule blocks" on public.schedule_blocks for insert with check (
  auth.uid() = user_id and
  (task_id is null or exists (
    select 1 from public.tasks t where t.id = task_id and t.user_id = auth.uid()
  ))
);
create policy "Users can update own schedule blocks" on public.schedule_blocks for update using (auth.uid() = user_id) with check (
  auth.uid() = user_id and
  (task_id is null or exists (
    select 1 from public.tasks t where t.id = task_id and t.user_id = auth.uid()
  ))
);
create policy "Users can delete own schedule blocks" on public.schedule_blocks for delete using (auth.uid() = user_id);

-- Google connection secrets and sync metadata are accessed only by server routes.
drop policy if exists "Users can read own google_connections" on public.google_connections;

-- AI rate-limit updates are only available through the server-side service role.
create or replace function public.consume_ai_request(p_user_id uuid, p_max_requests integer default 20)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_window timestamptz := date_trunc('minute', now());
  current_count integer;
begin
  insert into public.ai_request_limits(user_id, window_started_at, request_count)
  values (p_user_id, current_window, 1)
  on conflict (user_id) do update
    set request_count = case
      when public.ai_request_limits.window_started_at < current_window then 1
      else public.ai_request_limits.request_count + 1
    end,
    window_started_at = current_window
  returning request_count into current_count;
  return current_count <= p_max_requests;
end;
$$;
revoke all on function public.consume_ai_request(uuid, integer) from public, anon, authenticated;
grant execute on function public.consume_ai_request(uuid, integer) to service_role;
