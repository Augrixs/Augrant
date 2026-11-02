-- Augrant 1.1 - blue / sky / rainbow cosmetics + two permanent bundles.
-- Run once in the Supabase SQL Editor (safe to run again). Needs the earlier Auru migration.
-- It detects the column names of your existing shop_items / inventory tables.

do $$
declare
  cols text[];
  idc text; pc text; sc text; nc text; tc text;
  r record;
begin
  select array_agg(column_name::text) into cols from information_schema.columns where table_schema='public' and table_name='shop_items';
  idc := (select c from unnest(array['id','item_id','slug','key']) c where c = any(cols) limit 1);
  pc  := (select c from unnest(array['price','cost']) c where c = any(cols) limit 1);
  sc  := (select c from unnest(array['slot']) c where c = any(cols) limit 1);
  nc  := (select c from unnest(array['name','title']) c where c = any(cols) limit 1);
  tc  := (select c from unnest(array['kind','type']) c where c = any(cols) limit 1);
  if idc is null or pc is null then raise exception 'shop_items has no id/price column I recognise: %', cols; end if;

  for r in select * from (values
    ('frame_blue','frame',200,'Blue Frame'), ('frame_sky','frame',200,'Sky Frame'),
    ('frame_gold','frame',400,'Gold Frame'), ('frame_neon','frame',350,'Neon Frame'), ('frame_rainbow','frame',450,'Rainbow Frame'),
    ('name_blue','name_style',100,'Blue Name'), ('name_sky','name_style',250,'Sky Glow Name'),
    ('name_gold','name_style',300,'Gold Glow Name'), ('name_rainbow','name_style',400,'Rainbow Name'),
    ('bg_blue','background',200,'Blue Background'), ('bg_sky','background',200,'Sky Background'), ('bg_aurora','background',350,'Aurora Background')
  ) v(id, slot, price, nm) loop
    execute format('insert into public.shop_items (%I, %I%s%s%s) values ($1, $2%s%s%s) on conflict do nothing',
      idc, pc,
      case when sc is not null then ', '||quote_ident(sc) else '' end,
      case when nc is not null then ', '||quote_ident(nc) else '' end,
      case when tc is not null then ', '||quote_ident(tc) else '' end,
      case when sc is not null then ', $3' else '' end,
      case when nc is not null then ', $4' else '' end,
      case when tc is not null then ', $3' else '' end)
    using r.id, r.price, r.slot, r.nm;
    execute format('update public.shop_items set %I = $2 where %I = $1', pc, idc) using r.id, r.price;
  end loop;
end $$;

-- Permanent bundles. Prices are about 33% below buying the pieces one by one.
--   blue_bundle    = frame_blue + name_sky + bg_blue         (650 separately -> 440)
--   rainbow_bundle = frame_rainbow + name_rainbow + bg_aurora (1200 separately -> 800)
create or replace function public.buy_bundle(p_bundle text) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  items text[]; cost int; bal int; icol text; it text;
begin
  if uid is null then raise exception 'not signed in'; end if;
  if p_bundle = 'blue_bundle' then items := array['frame_blue','name_sky','bg_blue']; cost := 440;
  elsif p_bundle = 'rainbow_bundle' then items := array['frame_rainbow','name_rainbow','bg_aurora']; cost := 800;
  else raise exception 'unknown bundle'; end if;
  select column_name into icol from information_schema.columns
   where table_schema='public' and table_name='inventory' and column_name in ('item_id','item') limit 1;
  if icol is null then raise exception 'inventory has no item column'; end if;
  select balance into bal from public.wallets where user_id = uid for update;
  if coalesce(bal, 0) < cost then raise exception 'not enough Auru'; end if;
  update public.wallets set balance = balance - cost where user_id = uid;
  foreach it in array items loop
    execute format('insert into public.inventory (user_id, %I) values ($1, $2) on conflict do nothing', icol) using uid, it;
  end loop;
end $$;
revoke all on function public.buy_bundle(text) from public, anon;
grant execute on function public.buy_bundle(text) to authenticated;
