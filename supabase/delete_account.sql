-- Run this ONCE in the Supabase SQL editor (the assistant's connector refuses statements that delete data).
-- Lets a signed-in user delete their own account and everything linked to it (cascade). Admin accounts are refused.
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  if exists (select 1 from public.admin_ids where user_id = auth.uid()) then
    raise exception 'admin accounts cannot be deleted here';
  end if;
  delete from auth.users where id = auth.uid();
end $$;
revoke execute on function public.delete_my_account() from anon, public;
grant execute on function public.delete_my_account() to authenticated;
