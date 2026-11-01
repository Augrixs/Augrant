-- Augrant database. Paste this whole file into Supabase > SQL Editor > New query > Run.
-- Safe to run more than once.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_.-]{3,24}$'),
  display_name text not null default '',
  role text not null default 'user' check (role in ('user','admin')),
  cover_data text,
  created_at timestamptz not null default now()
);

create table if not exists public.sessions (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  ended_at timestamptz
);
create index if not exists sessions_user_idx on public.sessions(user_id, started_at desc);

create table if not exists public.activity (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists activity_user_idx on public.activity(user_id, created_at desc);

create table if not exists public.clips (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text,
  duration_s numeric,
  quality text,
  format text,
  transcript text,
  created_at timestamptz not null default now()
);
create index if not exists clips_user_idx on public.clips(user_id, created_at desc);

-- Is the signed-in user an admin? security definer avoids a loop inside the profiles policy.
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

alter table public.profiles enable row level security;
alter table public.sessions enable row level security;
alter table public.activity enable row level security;
alter table public.clips enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());

-- Users may change their own row, but role and username are locked by the trigger below.
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create or replace function public.lock_profile_columns() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    new.role := old.role;
    new.username := old.username;
    new.id := old.id;
  end if;
  return new;
end $$;
drop trigger if exists lock_profile_columns on public.profiles;
create trigger lock_profile_columns before update on public.profiles
  for each row execute function public.lock_profile_columns();

drop policy if exists sessions_select on public.sessions;
create policy sessions_select on public.sessions for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists sessions_insert on public.sessions;
create policy sessions_insert on public.sessions for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists sessions_update on public.sessions;
create policy sessions_update on public.sessions for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists activity_select on public.activity;
create policy activity_select on public.activity for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists activity_insert on public.activity;
create policy activity_insert on public.activity for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists clips_select on public.clips;
create policy clips_select on public.clips for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists clips_insert on public.clips;
create policy clips_insert on public.clips for insert to authenticated
  with check (user_id = auth.uid());

-- Overview for the admin panel. Returns rows only to admins; everyone else gets nothing.
create or replace view public.admin_overview with (security_invoker = false) as
select
  p.id, p.username, p.display_name, p.role, p.created_at,
  (select max(a.created_at) from public.activity a where a.user_id = p.id and a.type = 'login') as last_login,
  (select max(s.last_seen_at) from public.sessions s where s.user_id = p.id) as last_seen,
  (select case a.type
            when 'login' then 'เข้าสู่ระบบ'
            when 'logout' then 'ออกจากระบบ'
            when 'clip_created' then 'สร้างคลิป ' || coalesce(a.detail->>'title', '')
            when 'profile_update' then 'แก้โปรไฟล์'
            else a.type end
     from public.activity a where a.user_id = p.id order by a.created_at desc limit 1) as last_action,
  (select count(*) from public.clips c where c.user_id = p.id) as clip_count
from public.profiles p
where public.is_admin();

revoke all on public.admin_overview from public, anon;
grant select on public.admin_overview to authenticated;

-- Close sessions that were left open (phone died, app killed): called by the admin panel is not needed;
-- the app sends a heartbeat every 45 s, so last_seen_at already shows when the app was last used.

-- ====================================================================================
-- FIRST ADMIN. Do these two steps once, after running the script above:
-- 1) Supabase > Authentication > Users > Add user > Create new user
--      Email:    <your username>@augrant.app      (example: augrixs@augrant.app)
--      Password: your password
--      Tick "Auto Confirm User".
-- 2) Run the line below in the SQL Editor, with your username in both places:
--
-- insert into public.profiles (id, username, display_name, role)
--   select id, 'augrixs', 'Augrixs', 'admin' from auth.users where email = 'augrixs@augrant.app'
--   on conflict (id) do update set role = 'admin';
-- ====================================================================================
