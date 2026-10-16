-- Server-only Google token access and idempotent imported task linkage.
drop policy if exists "Users can read own google_connections" on public.google_connections;

drop policy if exists "Users can insert own sources" on public.sources;
create policy "Users can insert own sources" on public.sources for insert with check (
  auth.uid() = user_id and
  (course_id is null or exists (
    select 1 from public.courses c where c.id = course_id and c.user_id = auth.uid()
  ))
);
drop policy if exists "Users can update own sources" on public.sources;
create policy "Users can update own sources" on public.sources for update using (auth.uid() = user_id) with check (
  auth.uid() = user_id and
  (course_id is null or exists (
    select 1 from public.courses c where c.id = course_id and c.user_id = auth.uid()
  ))
);

drop policy if exists "Users can insert own tasks" on public.tasks;
create policy "Users can insert own tasks" on public.tasks for insert with check (
  auth.uid() = user_id and
  (course_id is null or exists (
    select 1 from public.courses c where c.id = course_id and c.user_id = auth.uid()
  )) and
  (source_id is null or exists (
    select 1 from public.sources s where s.id = source_id and s.user_id = auth.uid()
  ))
);
drop policy if exists "Users can update own tasks" on public.tasks;
create policy "Users can update own tasks" on public.tasks for update using (auth.uid() = user_id) with check (
  auth.uid() = user_id and
  (course_id is null or exists (
    select 1 from public.courses c where c.id = course_id and c.user_id = auth.uid()
  )) and
  (source_id is null or exists (
    select 1 from public.sources s where s.id = source_id and s.user_id = auth.uid()
  ))
);

drop policy if exists "Users can insert own schedule blocks" on public.schedule_blocks;
create policy "Users can insert own schedule blocks" on public.schedule_blocks for insert with check (
  auth.uid() = user_id and
  (task_id is null or exists (
    select 1 from public.tasks t where t.id = task_id and t.user_id = auth.uid()
  ))
);
drop policy if exists "Users can update own schedule blocks" on public.schedule_blocks;
create policy "Users can update own schedule blocks" on public.schedule_blocks for update using (auth.uid() = user_id) with check (
  auth.uid() = user_id and
  (task_id is null or exists (
    select 1 from public.tasks t where t.id = task_id and t.user_id = auth.uid()
  ))
);

create unique index if not exists tasks_source_unique
  on public.tasks (source_id);

alter table public.google_connections
  add column if not exists sync_lease_until timestamptz;

alter table public.schedule_blocks
  add column if not exists is_deleted boolean not null default false;

create table if not exists public.ai_request_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_started_at timestamptz not null,
  request_count integer not null default 0
);
alter table public.ai_request_limits enable row level security;
revoke all on public.ai_request_limits from public, anon, authenticated;
grant all on public.ai_request_limits to service_role;

create or replace function public.consume_ai_request(p_user_id uuid, p_max_requests integer default 20)
returns boolean language plpgsql security definer set search_path = public as $$
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

create table if not exists public.progress_snapshots (
  user_id uuid not null references auth.users(id) on delete cascade,
  snapshot_date date not null,
  total_tasks integer not null default 0 check (total_tasks >= 0),
  completed_tasks integer not null default 0 check (completed_tasks >= 0 and completed_tasks <= total_tasks),
  created_at timestamptz not null default now(),
  primary key (user_id, snapshot_date)
);
alter table public.progress_snapshots enable row level security;
drop policy if exists "Users can read own progress snapshots" on public.progress_snapshots;
create policy "Users can read own progress snapshots" on public.progress_snapshots for select using (auth.uid() = user_id);
drop policy if exists "Users can insert own progress snapshots" on public.progress_snapshots;
create policy "Users can insert own progress snapshots" on public.progress_snapshots for insert with check (auth.uid() = user_id);
drop policy if exists "Users can update own progress snapshots" on public.progress_snapshots;
create policy "Users can update own progress snapshots" on public.progress_snapshots for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists sources_provider_published_idx
  on public.sources (user_id, provider, published_at desc);
