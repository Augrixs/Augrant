-- Augrant 1.1: self sign-up, birthday, gender, social links.
-- Run once in Supabase > SQL Editor (after setup.sql and social.sql). Safe to run again.

alter table public.profiles add column if not exists birthday date;
alter table public.profiles add column if not exists gender text check (gender in ('male','female'));
alter table public.profiles add column if not exists links jsonb not null default '{}'::jsonb;

-- a signed-in person may create their own profile row (never as admin)
drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert to authenticated
  with check (id = auth.uid() and role = 'user');

-- the sign-in page turns a username into the email the account uses
create or replace function public.login_email(p_username text) returns text
language sql stable security definer set search_path = public, auth as $$
  select u.email::text from auth.users u join public.profiles p on p.id = u.id
  where p.username = lower(p_username) limit 1;
$$;
grant execute on function public.login_email(text) to anon, authenticated;

create or replace function public.username_free(p_username text) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.profiles where username = lower(p_username));
$$;
grant execute on function public.username_free(text) to anon, authenticated;

-- social links: only the real sites are accepted
create or replace function public.validate_profile_links() returns trigger
language plpgsql as $$
declare k text; v text; pat text;
begin
  if new.links is null then new.links := '{}'::jsonb; end if;
  if jsonb_typeof(new.links) <> 'object' then raise exception 'links must be an object'; end if;
  for k, v in select key, value from jsonb_each_text(new.links) loop
    pat := case k
      when 'youtube' then '(youtube\.com|youtu\.be)'
      when 'tiktok' then '(tiktok\.com)'
      when 'instagram' then '(instagram\.com)'
      when 'discord' then '(discord\.gg|discord\.com)'
      when 'x' then '(x\.com|twitter\.com)'
      else null end;
    if pat is null then raise exception 'unknown link type %', k; end if;
    if char_length(v) > 200 or v !~* ('^https://([a-z0-9-]+\.)*' || pat || '([/?#]|$)') then
      raise exception 'invalid % link', k;
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists validate_profile_links on public.profiles;
create trigger validate_profile_links before insert or update on public.profiles
  for each row execute function public.validate_profile_links();
