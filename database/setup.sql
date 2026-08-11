-- This deployed-project copy intentionally matches:
-- editor/examples/supabase/builder-schema.sql
--
-- Lengua de Señas Panameña (LSP) — simplified schema and migration
-- Run this file once in Supabase > SQL Editor. It is safe to run again.

begin;

create schema if not exists private;
revoke all on schema private from public;

-- Preserve display data in Auth metadata before removing profiles.
do $$
begin
  if to_regclass('public.profiles') is not null then
    update auth.users as users
    set raw_user_meta_data = coalesce(users.raw_user_meta_data, '{}'::jsonb)
      || jsonb_strip_nulls(jsonb_build_object(
        'display_name', profiles.display_name,
        'avatar_url', profiles.avatar_url,
        'bio', profiles.bio
      ))
    from public.profiles as profiles
    where profiles.user_id = users.id;
  end if;
end
$$;

-- Preserve the strongest old role in protected app_metadata.
do $$
begin
  if to_regclass('public.user_roles') is not null then
    update auth.users as users
    set raw_app_meta_data = jsonb_set(
      coalesce(users.raw_app_meta_data, '{}'::jsonb),
      '{role}', to_jsonb(roles.role), true
    )
    from (
      select user_id,
        case
          when bool_or(role = 'admin') then 'admin'
          when bool_or(role = 'teacher') then 'teacher'
          else 'student'
        end as role
      from public.user_roles
      group by user_id
    ) as roles
    where roles.user_id = users.id
      and nullif(users.raw_app_meta_data ->> 'role', '') is null;
  end if;
end
$$;

update auth.users
set raw_app_meta_data = jsonb_set(
  coalesce(raw_app_meta_data, '{}'::jsonb),
  '{role}', '"student"'::jsonb, true
)
where nullif(raw_app_meta_data ->> 'role', '') is null;

drop trigger if exists on_auth_user_created on auth.users;
do $$
begin
  if to_regclass('public.profiles') is not null then
    execute 'drop trigger if exists profiles_set_updated_at on public.profiles';
  end if;
  if to_regclass('public.practice_attempts') is not null then
    execute 'drop trigger if exists practice_attempts_refresh_progress on public.practice_attempts';
  end if;
end
$$;

do $$
declare policy_row record;
begin
  for policy_row in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('practices', 'practice_attempts')
  loop
    execute format('drop policy if exists %I on %I.%I',
      policy_row.policyname, policy_row.schemaname, policy_row.tablename);
  end loop;
end
$$;

drop table if exists public.favorite_practices cascade;
do $$
begin
  if exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'practice_progress'
      and c.relkind in ('v', 'm')
  ) then
    execute 'drop view public.practice_progress cascade';
  elsif to_regclass('public.practice_progress') is not null then
    execute 'drop table public.practice_progress cascade';
  end if;
end
$$;
drop table if exists public.user_roles cascade;
drop table if exists public.profiles cascade;
drop function if exists private.handle_new_user() cascade;
drop function if exists private.refresh_practice_progress() cascade;
drop function if exists private.has_role(uuid, text) cascade;
drop function if exists private.builder_has_any_role(text[]) cascade;

-- @builder-access public_read
create table if not exists public.practices (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references auth.users(id) on delete set null,
  title text not null,
  description text,
  media_url text,
  mediapipe_reference jsonb,
  published boolean not null default false,
  difficulty integer not null default 1 check (difficulty between 1 and 5),
  estimated_minutes integer check (estimated_minutes is null or estimated_minutes > 0),
  source text not null default 'teacher' check (source in ('system', 'teacher')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint practices_source_owner_check check (source = 'system' or created_by is not null)
);

alter table public.practices add column if not exists created_by uuid;
alter table public.practices add column if not exists title text;
alter table public.practices add column if not exists description text;
alter table public.practices add column if not exists media_url text;
alter table public.practices add column if not exists mediapipe_reference jsonb;
alter table public.practices add column if not exists published boolean not null default false;
alter table public.practices add column if not exists difficulty integer not null default 1;
alter table public.practices add column if not exists estimated_minutes integer;
alter table public.practices add column if not exists source text not null default 'teacher';
alter table public.practices add column if not exists sort_order integer not null default 0;
alter table public.practices add column if not exists created_at timestamptz not null default now();
alter table public.practices add column if not exists updated_at timestamptz not null default now();

-- @builder-access user_owned
create table if not exists public.practice_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  practice_id uuid not null references public.practices(id) on delete cascade,
  score numeric check (score is null or score between 0 and 100),
  feedback text,
  mediapipe_result jsonb,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  created_at timestamptz not null default now()
);

alter table public.practice_attempts add column if not exists user_id uuid;
alter table public.practice_attempts add column if not exists practice_id uuid;
alter table public.practice_attempts add column if not exists score numeric;
alter table public.practice_attempts add column if not exists feedback text;
alter table public.practice_attempts add column if not exists mediapipe_result jsonb;
alter table public.practice_attempts add column if not exists duration_seconds integer;
alter table public.practice_attempts add column if not exists created_at timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.practices'::regclass and conname = 'practices_created_by_fkey') then
    alter table public.practices add constraint practices_created_by_fkey foreign key (created_by) references auth.users(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.practice_attempts'::regclass and conname = 'practice_attempts_user_id_fkey') then
    alter table public.practice_attempts add constraint practice_attempts_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.practice_attempts'::regclass and conname = 'practice_attempts_practice_id_fkey') then
    alter table public.practice_attempts add constraint practice_attempts_practice_id_fkey foreign key (practice_id) references public.practices(id) on delete cascade;
  end if;
end
$$;

create or replace function private.current_user_has_any_role(required_roles text[])
returns boolean
language sql stable security invoker set search_path = ''
as $$
  select coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', 'student') = any(required_roles)
    or coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', 'student') = 'admin';
$$;
revoke all on function private.current_user_has_any_role(text[]) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.current_user_has_any_role(text[]) to authenticated;

create or replace function private.set_updated_at()
returns trigger language plpgsql set search_path = ''
as $$ begin new.updated_at = now(); return new; end; $$;
revoke all on function private.set_updated_at() from public, anon, authenticated;
drop trigger if exists practices_set_updated_at on public.practices;
create trigger practices_set_updated_at before update on public.practices
for each row execute function private.set_updated_at();

alter table public.practices enable row level security;
alter table public.practice_attempts enable row level security;

create policy practices_public_read on public.practices
for select to anon, authenticated using (published = true);
create policy practices_teacher_read_own on public.practices
for select to authenticated using (created_by = (select auth.uid()) and private.current_user_has_any_role(array['teacher']));
create policy practices_teacher_insert on public.practices
for insert to authenticated with check (created_by = (select auth.uid()) and source = 'teacher' and private.current_user_has_any_role(array['teacher']));
create policy practices_teacher_update on public.practices
for update to authenticated
using (created_by = (select auth.uid()) and private.current_user_has_any_role(array['teacher']))
with check (created_by = (select auth.uid()) and source = 'teacher' and private.current_user_has_any_role(array['teacher']));
create policy practices_teacher_delete on public.practices
for delete to authenticated using (created_by = (select auth.uid()) and private.current_user_has_any_role(array['teacher']));
create policy practice_attempts_read_own on public.practice_attempts
for select to authenticated using ((select auth.uid()) = user_id);
create policy practice_attempts_insert_own on public.practice_attempts
for insert to authenticated with check ((select auth.uid()) = user_id);

revoke all on table public.practices from anon, authenticated;
grant select on table public.practices to anon, authenticated;
grant insert, update, delete on table public.practices to authenticated;
revoke all on table public.practice_attempts from anon, authenticated;
grant select, insert on table public.practice_attempts to authenticated;

-- Progress is derived from practice_attempts in application code when needed;
-- no progress table or view is retained.

create index if not exists practices_published_sort_idx on public.practices (published, sort_order);
create index if not exists practices_created_by_idx on public.practices (created_by);
create index if not exists practice_attempts_user_recent_idx on public.practice_attempts (user_id, created_at desc);
create index if not exists practice_attempts_practice_idx on public.practice_attempts (practice_id);
create index if not exists practice_attempts_user_practice_score_idx on public.practice_attempts (user_id, practice_id, score desc);

commit;

-- Teacher assignment example (run only from a trusted SQL/admin environment):
-- update auth.users
-- set raw_app_meta_data = jsonb_set(coalesce(raw_app_meta_data, '{}'::jsonb), '{role}', '"teacher"'::jsonb, true)
-- where email = 'teacher@example.com';
