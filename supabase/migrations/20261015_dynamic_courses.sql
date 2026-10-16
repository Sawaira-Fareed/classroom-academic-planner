-- Dynamic, user-owned courses and custom task support.
-- Apply after the existing schema.sql; this migration preserves existing rows.

alter table public.courses
  alter column google_course_id drop not null,
  add column if not exists course_code text,
  add column if not exists instructor text,
  add column if not exists origin text not null default 'google_classroom',
  add column if not exists is_archived boolean not null default false;

alter table public.courses
  drop constraint if exists courses_origin_check,
  add constraint courses_origin_check check (origin in ('google_classroom', 'custom')),
  drop constraint if exists courses_google_course_id_origin_check,
  add constraint courses_google_course_id_origin_check
    check ((origin = 'google_classroom' and google_course_id is not null) or
           (origin = 'custom' and google_course_id is null));

create unique index if not exists courses_google_external_id_unique
  on public.courses (user_id, google_course_id)
  where google_course_id is not null;

create index if not exists courses_user_active_idx
  on public.courses (user_id, is_archived, name);

-- A task may have no course. If linked, the referenced course must belong to
-- the same authenticated user.
drop policy if exists "Users can insert own tasks" on public.tasks;
create policy "Users can insert own tasks"
  on public.tasks for insert
  with check (
    auth.uid() = user_id and
    (course_id is null or exists (
      select 1 from public.courses c
      where c.id = course_id and c.user_id = auth.uid()
    ))
  );

drop policy if exists "Users can update own tasks" on public.tasks;
create policy "Users can update own tasks"
  on public.tasks for update
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id and
    (course_id is null or exists (
      select 1 from public.courses c
      where c.id = course_id and c.user_id = auth.uid()
    ))
  );
