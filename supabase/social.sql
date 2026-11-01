-- Augrant social features: friends, chat, posts, likes, comments, notifications.
-- Paste this whole file into Supabase > SQL Editor > New query > Run. Safe to run more than once.
-- Run supabase/setup.sql first.

-- 1) every signed-in user can see basic profile info (needed for Social, posts and chat)
alter table public.profiles add column if not exists avatar_data text;
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (true);

-- 2) friendships
create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester uuid not null references public.profiles(id) on delete cascade,
  addressee uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted')),
  created_at timestamptz not null default now(),
  check (requester <> addressee)
);
create unique index if not exists friendships_pair on public.friendships (least(requester, addressee), greatest(requester, addressee));
alter table public.friendships enable row level security;
drop policy if exists fr_select on public.friendships;
create policy fr_select on public.friendships for select to authenticated using (auth.uid() in (requester, addressee));
drop policy if exists fr_insert on public.friendships;
create policy fr_insert on public.friendships for insert to authenticated with check (requester = auth.uid() and status = 'pending');
drop policy if exists fr_update on public.friendships;
create policy fr_update on public.friendships for update to authenticated using (addressee = auth.uid()) with check (addressee = auth.uid());
drop policy if exists fr_delete on public.friendships;
create policy fr_delete on public.friendships for delete to authenticated using (auth.uid() in (requester, addressee));

create or replace function public.lock_friendship_columns() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.requester := old.requester;
  new.addressee := old.addressee;
  new.id := old.id;
  new.created_at := old.created_at;
  return new;
end $$;
drop trigger if exists lock_friendship_columns on public.friendships;
create trigger lock_friendship_columns before update on public.friendships
  for each row execute function public.lock_friendship_columns();

create or replace function public.are_friends(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.friendships
    where status = 'accepted' and ((requester = a and addressee = b) or (requester = b and addressee = a))
  );
$$;

-- 3) chat messages (friends only)
create table if not exists public.messages (
  id bigint generated always as identity primary key,
  sender uuid not null references public.profiles(id) on delete cascade,
  recipient uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists messages_pair on public.messages (sender, recipient, created_at desc);
create index if not exists messages_unread on public.messages (recipient) where read_at is null;
alter table public.messages enable row level security;
drop policy if exists msg_select on public.messages;
create policy msg_select on public.messages for select to authenticated using (auth.uid() in (sender, recipient));
drop policy if exists msg_insert on public.messages;
create policy msg_insert on public.messages for insert to authenticated
  with check (sender = auth.uid() and public.are_friends(sender, recipient));
drop policy if exists msg_update on public.messages;
create policy msg_update on public.messages for update to authenticated using (recipient = auth.uid()) with check (recipient = auth.uid());

-- 4) posts, likes, comments
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  author uuid not null references public.profiles(id) on delete cascade,
  kind text not null default 'text' check (kind in ('text','image','video')),
  body text not null default '' check (char_length(body) <= 3000),
  bg text,
  media_path text,
  created_at timestamptz not null default now()
);
create index if not exists posts_created on public.posts (created_at desc);
create index if not exists posts_author on public.posts (author, created_at desc);
alter table public.posts enable row level security;
drop policy if exists posts_select on public.posts;
create policy posts_select on public.posts for select to authenticated using (true);
drop policy if exists posts_insert on public.posts;
create policy posts_insert on public.posts for insert to authenticated with check (author = auth.uid());
drop policy if exists posts_delete on public.posts;
create policy posts_delete on public.posts for delete to authenticated using (author = auth.uid() or public.is_admin());

create table if not exists public.likes (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
alter table public.likes enable row level security;
drop policy if exists likes_select on public.likes;
create policy likes_select on public.likes for select to authenticated using (true);
drop policy if exists likes_insert on public.likes;
create policy likes_insert on public.likes for insert to authenticated with check (user_id = auth.uid());
drop policy if exists likes_delete on public.likes;
create policy likes_delete on public.likes for delete to authenticated using (user_id = auth.uid());

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists comments_post on public.comments (post_id, created_at);
alter table public.comments enable row level security;
drop policy if exists comments_select on public.comments;
create policy comments_select on public.comments for select to authenticated using (true);
drop policy if exists comments_insert on public.comments;
create policy comments_insert on public.comments for insert to authenticated with check (author = auth.uid());
drop policy if exists comments_delete on public.comments;
create policy comments_delete on public.comments for delete to authenticated
  using (author = auth.uid() or public.is_admin() or exists (select 1 from public.posts p where p.id = post_id and p.author = auth.uid()));

-- 5) notifications (written only by the triggers below, so nobody can fake one)
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  actor uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('friend_request','friend_accept','like','comment','share')),
  post_id uuid references public.posts(id) on delete cascade,
  body text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user on public.notifications (user_id, created_at desc);
alter table public.notifications enable row level security;
drop policy if exists notif_select on public.notifications;
create policy notif_select on public.notifications for select to authenticated using (user_id = auth.uid());
drop policy if exists notif_update on public.notifications;
create policy notif_update on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists notif_delete on public.notifications;
create policy notif_delete on public.notifications for delete to authenticated using (user_id = auth.uid());

create or replace function public.notify_friendship() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.notifications (user_id, actor, type) values (new.addressee, new.requester, 'friend_request');
  elsif tg_op = 'UPDATE' and new.status = 'accepted' and old.status <> 'accepted' then
    insert into public.notifications (user_id, actor, type) values (new.requester, new.addressee, 'friend_accept');
  end if;
  return new;
end $$;
drop trigger if exists notify_friendship on public.friendships;
create trigger notify_friendship after insert or update on public.friendships
  for each row execute function public.notify_friendship();

create or replace function public.notify_like() returns trigger
language plpgsql security definer set search_path = public as $$
declare owner uuid;
begin
  select author into owner from public.posts where id = new.post_id;
  if owner is not null and owner <> new.user_id then
    insert into public.notifications (user_id, actor, type, post_id) values (owner, new.user_id, 'like', new.post_id);
  end if;
  return new;
end $$;
drop trigger if exists notify_like on public.likes;
create trigger notify_like after insert on public.likes for each row execute function public.notify_like();

create or replace function public.notify_comment() returns trigger
language plpgsql security definer set search_path = public as $$
declare owner uuid;
begin
  select author into owner from public.posts where id = new.post_id;
  if owner is not null and owner <> new.author then
    insert into public.notifications (user_id, actor, type, post_id, body) values (owner, new.author, 'comment', new.post_id, left(new.body, 120));
  end if;
  return new;
end $$;
drop trigger if exists notify_comment on public.comments;
create trigger notify_comment after insert on public.comments for each row execute function public.notify_comment();

create or replace function public.share_post(p_post uuid) returns void
language plpgsql security definer set search_path = public as $$
declare owner uuid;
begin
  select author into owner from public.posts where id = p_post;
  if owner is not null and owner <> auth.uid() then
    insert into public.notifications (user_id, actor, type, post_id) values (owner, auth.uid(), 'share', p_post);
  end if;
end $$;
grant execute on function public.share_post(uuid) to authenticated;

-- 6) storage for post pictures and videos (public link, only the owner can upload or delete)
insert into storage.buckets (id, name, public, file_size_limit)
values ('posts', 'posts', true, 52428800)
on conflict (id) do update set public = true, file_size_limit = 52428800;
drop policy if exists posts_media_insert on storage.objects;
create policy posts_media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'posts' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists posts_media_delete on storage.objects;
create policy posts_media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'posts' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
