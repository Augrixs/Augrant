-- Augrant 1.1 fixes. Run once in the Supabase SQL Editor (safe to run again).
-- 1) Halloween items are on sale for 3 days starting NOW (not "start in 3 days").
-- 2) buy_item re-written so it also checks the end date and understands the Halloween bundle.
-- 3) admin_give_auru: admins can give Auru to themselves or anyone by username.
-- Needs economy_extras.sql to have been run first (it creates _add_auru).

alter table public.shop_items add column if not exists ends_at timestamptz;

do $$
declare cols text[]; idc text;
begin
  select array_agg(column_name::text) into cols from information_schema.columns where table_schema='public' and table_name='shop_items';
  idc := (select c from unnest(array['id','item_id','slug','key']) c where c = any(cols) limit 1);
  if idc is null then raise exception 'shop_items has no id column I recognise: %', cols; end if;
  if 'starts_at' = any(cols) then
    execute format('update public.shop_items set starts_at = now(), ends_at = now() + interval ''3 days'' where %I like ''halloween\_%%''', idc);
  else
    execute format('update public.shop_items set ends_at = now() + interval ''3 days'' where %I like ''halloween\_%%''', idc);
  end if;
end $$;

drop function if exists public.buy_item(text);
create function public.buy_item(p_item text) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  cols text[]; idc text; pc text; icol text;
  j jsonb; cost int; s timestamptz; e timestamptz; items text[]; it text; bal int;
begin
  if uid is null then raise exception 'not signed in'; end if;
  select array_agg(column_name::text) into cols from information_schema.columns where table_schema='public' and table_name='shop_items';
  idc := (select c from unnest(array['id','item_id','slug','key']) c where c = any(cols) limit 1);
  pc  := (select c from unnest(array['price','cost']) c where c = any(cols) limit 1);
  execute format('select to_jsonb(s) from public.shop_items s where s.%I = $1', idc) into j using p_item;
  if j is null then raise exception 'unknown item'; end if;
  cost := (j ->> pc)::int;
  s := nullif(j ->> 'starts_at', '')::timestamptz;
  e := nullif(j ->> 'ends_at', '')::timestamptz;
  if s is not null and s > now() then raise exception 'not on sale yet'; end if;
  if e is not null and e < now() then raise exception 'no longer sold'; end if;
  if p_item = 'halloween_bundle' then items := array['halloween_frame','halloween_name','halloween_bg'];
  else items := array[p_item]; end if;
  select column_name into icol from information_schema.columns
   where table_schema='public' and table_name='inventory' and column_name in ('item_id','item') limit 1;
  if icol is null then raise exception 'inventory has no item column'; end if;
  foreach it in array items loop
    if array_length(items, 1) = 1 then
      perform 1 from public.inventory where user_id = uid and (to_jsonb(inventory) ->> icol) = it;
      if found then raise exception 'already owned'; end if;
    end if;
  end loop;
  select balance into bal from public.wallets where user_id = uid for update;
  if coalesce(bal, 0) < cost then raise exception 'not enough Auru'; end if;
  update public.wallets set balance = balance - cost where user_id = uid;
  foreach it in array items loop
    execute format('insert into public.inventory (user_id, %I) values ($1, $2) on conflict do nothing', icol) using uid, it;
  end loop;
end $$;
revoke all on function public.buy_item(text) from public, anon;
grant execute on function public.buy_item(text) to authenticated;

create or replace function public.admin_give_auru(p_username text, p_amount int) returns int
language plpgsql security definer set search_path = public as $$
declare target uuid; bal int;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  if p_amount is null or p_amount = 0 or abs(p_amount) > 1000000 then raise exception 'bad amount'; end if;
  select id into target from public.profiles where username = lower(trim(p_username));
  if target is null then raise exception 'no such username'; end if;
  perform public._add_auru(target, p_amount);
  select balance into bal from public.wallets where user_id = target;
  return bal;
end $$;
revoke all on function public.admin_give_auru(text, int) from public, anon;
grant execute on function public.admin_give_auru(text, int) to authenticated;
