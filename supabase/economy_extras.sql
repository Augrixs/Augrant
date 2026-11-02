-- Augrant 1.1 - extras on top of the Auru migration you already ran:
-- daily tasks + monthly claim. Safe to run more than once.
-- Assumes public.wallets has columns (user_id uuid primary key, balance int).

create table if not exists public.task_claims (
  user_id uuid not null references auth.users(id) on delete cascade,
  task text not null,
  day date not null,
  primary key (user_id, task, day)
);
alter table public.task_claims enable row level security;
drop policy if exists task_claims_own on public.task_claims;
create policy task_claims_own on public.task_claims for select to authenticated using (user_id = auth.uid());

create table if not exists public.monthly_claims (
  user_id uuid not null references auth.users(id) on delete cascade,
  month text not null,
  primary key (user_id, month)
);
alter table public.monthly_claims enable row level security;
drop policy if exists monthly_claims_own on public.monthly_claims;
create policy monthly_claims_own on public.monthly_claims for select to authenticated using (user_id = auth.uid());

create or replace function public._add_auru(p_user uuid, p_amount int) returns void
language sql security definer set search_path = public as $$
  insert into public.wallets (user_id, balance) values (p_user, p_amount)
  on conflict (user_id) do update set balance = public.wallets.balance + p_amount;
$$;
revoke all on function public._add_auru(uuid, int) from public, anon, authenticated;

-- Daily tasks are checked on the server, so they cannot be faked.
-- post = made a post today (+20), comment = wrote a comment today (+10), like = liked a post today (+10)
create or replace function public.claim_task(p_task text, p_tz_offset_min int default 0) returns int
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  local_now timestamp := (now() at time zone 'utc') + make_interval(mins => coalesce(p_tz_offset_min, 0));
  today date := local_now::date;
  start_utc timestamptz := (today::timestamp - make_interval(mins => coalesce(p_tz_offset_min, 0))) at time zone 'utc';
  reward int;
  done boolean;
begin
  if uid is null then raise exception 'not signed in'; end if;
  if p_task = 'post' then
    reward := 20; select exists (select 1 from public.posts where author = uid and created_at >= start_utc) into done;
  elsif p_task = 'comment' then
    reward := 10; select exists (select 1 from public.comments where author = uid and created_at >= start_utc) into done;
  elsif p_task = 'like' then
    reward := 10; select exists (select 1 from public.likes where user_id = uid and created_at >= start_utc) into done;
  else
    raise exception 'unknown task';
  end if;
  if not done then raise exception 'task not finished yet'; end if;
  insert into public.task_claims (user_id, task, day) values (uid, p_task, today);
  perform public._add_auru(uid, reward);
  return reward;
exception when unique_violation then
  raise exception 'already claimed';
end $$;
revoke all on function public.claim_task(text, int) from public, anon;
grant execute on function public.claim_task(text, int) to authenticated;

-- Once per calendar month, 500 Auru.
create or replace function public.claim_monthly(p_tz_offset_min int default 0) returns int
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  m text := to_char((now() at time zone 'utc') + make_interval(mins => coalesce(p_tz_offset_min, 0)), 'YYYY-MM');
begin
  if uid is null then raise exception 'not signed in'; end if;
  insert into public.monthly_claims (user_id, month) values (uid, m);
  perform public._add_auru(uid, 500);
  return 500;
exception when unique_violation then
  raise exception 'already claimed';
end $$;
revoke all on function public.claim_monthly(int) from public, anon;
grant execute on function public.claim_monthly(int) to authenticated;
