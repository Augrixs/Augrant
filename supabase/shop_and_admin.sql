-- Already applied to the live project (kept for the record / for a fresh project).
-- Needs economy_extras.sql first (creates _add_auru).
update public.shop_items set starts_at = now(), ends_at = now() + interval '3 days' where event = 'halloween';

insert into public.shop_items (id, kind, name_th, name_en, price, bundle_items, sort) values
 ('frame_blue','frame','กรอบน้ำเงิน','Blue Frame',200,'{}',10),
 ('frame_sky','frame','กรอบฟ้าอ่อน','Sky Frame',200,'{}',11),
 ('frame_gold','frame','กรอบทอง','Gold Frame',400,'{}',12),
 ('frame_neon','frame','กรอบนีออน','Neon Frame',350,'{}',13),
 ('frame_rainbow','frame','กรอบสายรุ้ง','Rainbow Frame',450,'{}',14),
 ('name_blue','name_style','ชื่อสีน้ำเงิน','Blue Name',100,'{}',20),
 ('name_sky','name_style','ชื่อฟ้าอ่อนเรืองแสง','Sky Glow Name',250,'{}',21),
 ('name_gold','name_style','ชื่อทองเรืองแสง','Gold Glow Name',300,'{}',22),
 ('name_rainbow','name_style','ชื่อสายรุ้ง','Rainbow Name',400,'{}',23),
 ('bg_blue','background','พื้นหลังน้ำเงิน','Blue Background',200,'{}',30),
 ('bg_sky','background','พื้นหลังฟ้าอ่อน','Sky Background',200,'{}',31),
 ('bg_aurora','background','พื้นหลังออโรรา','Aurora Background',350,'{}',32),
 ('blue_bundle','bundle','Blue Bundle (ขายตลอด)','Blue Bundle',440,'{frame_blue,name_sky,bg_blue}',5),
 ('rainbow_bundle','bundle','Rainbow Bundle (ขายตลอด)','Rainbow Bundle',800,'{frame_rainbow,name_rainbow,bg_aurora}',6)
on conflict (id) do update set price = excluded.price, bundle_items = excluded.bundle_items;

create or replace function public.admin_give_auru(p_username text, p_amount int) returns bigint
language plpgsql security definer set search_path = public as $$
declare target uuid; bal bigint;
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
