-- Record of what was applied to the live database (bans + admin hardening).
create table if not exists public.bans(
  user_id uuid primary key references auth.users on delete cascade,
  until timestamptz, reason text not null, note text,
  created_by uuid, created_at timestamptz not null default now());
alter table public.bans enable row level security;
-- readable by the banned user and admins; written only through the RPCs below
--   policy bans_select_own_or_admin: user_id = auth.uid() or is_admin()
-- RPCs: is_banned(), admin_ban_user(p_user, p_minutes, p_reason, p_note), admin_unban_user(p_user)
-- Restrictive INSERT policy "not_banned_insert" (with check (not is_banned())) on:
--   posts, comments, likes, messages, friendships

-- Admin hardening: only ids listed in admin_ids can ever be admin.
create table if not exists public.admin_ids(user_id uuid primary key);
alter table public.admin_ids enable row level security; -- no policies: invisible to the app
-- is_admin() = profiles.role='admin' AND user_id in admin_ids
-- lock_profile_columns(): role and id can never change from an app session.
-- To add another admin (SQL editor only):
--   insert into public.admin_ids values ('<uuid>');
--   update public.profiles set role='admin' where id='<uuid>';
