-- equalizer live feed: run this once in Supabase → SQL Editor → New query → Run.
-- It is safe to run again (everything is "create if not exists" / "or replace").
--
-- Anyone can read the feed and post a beat. Nobody (except you, in the dashboard) can edit or
-- delete beats. Likes and reports go through two small functions, and 3 reports hide a beat.
-- To hide one yourself: Table Editor → beats → set "hidden" to true.

create table if not exists public.beats (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  title      text not null check (char_length(btrim(title)) between 1 and 60),
  author     text not null check (char_length(btrim(author)) between 1 and 30),
  song       jsonb not null check (jsonb_typeof(song) = 'object' and octet_length(song::text) <= 20000),
  likes      integer not null default 0,
  reports    integer not null default 0,
  hidden     boolean not null default false
);
create index if not exists beats_feed on public.beats (created_at desc) where not hidden;

-- Who posted when, for rate limiting. Holds a hash of the IP address, never the address itself,
-- and the web page can't read it.
create table if not exists public.post_log (
  ip_hash    text not null,
  created_at timestamptz not null default now()
);
create index if not exists post_log_recent on public.post_log (ip_hash, created_at desc);

-- Row level security: visitors see beats that aren't hidden and can add new ones. Nothing else.
alter table public.beats enable row level security;
alter table public.post_log enable row level security;

drop policy if exists "read visible beats" on public.beats;
create policy "read visible beats" on public.beats for select to anon, authenticated using (not hidden);
drop policy if exists "post beats" on public.beats;
create policy "post beats" on public.beats for insert to anon, authenticated with check (true);

-- Column privileges: a post can only set its title, author and song (not likes, reports, hidden).
revoke all on public.beats from anon, authenticated;
grant select (id, created_at, title, author, song, likes, hidden) on public.beats to anon, authenticated;
grant insert (title, author, song) on public.beats to anon, authenticated;
revoke all on public.post_log from anon, authenticated;

-- Every new post: at most 5 per IP address per 10 minutes, and server-controlled fields reset.
create or replace function public.beats_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  headers json := nullif(current_setting('request.headers', true), '')::json;
  ip text := coalesce(btrim(split_part(headers->>'x-forwarded-for', ',', 1)), 'unknown');
  h text := md5('equalizer:' || ip);
begin
  if (select count(*) from post_log where ip_hash = h and created_at > now() - interval '10 minutes') >= 5 then
    raise exception 'Slow down: you can post 5 beats every 10 minutes' using errcode = 'P0001';
  end if;
  insert into post_log (ip_hash) values (h);
  delete from post_log where created_at < now() - interval '1 day';
  new.title := btrim(new.title);
  new.author := btrim(new.author);
  new.created_at := now();
  new.likes := 0;
  new.reports := 0;
  new.hidden := false;
  return new;
end $$;

drop trigger if exists beats_before_insert on public.beats;
create trigger beats_before_insert before insert on public.beats
  for each row execute function public.beats_before_insert();

-- Likes and reports. The page also remembers what you liked, so one tap counts once per browser.
create or replace function public.like_beat(beat_id uuid) returns integer
language sql security definer set search_path = public as $$
  update beats set likes = likes + 1 where id = beat_id and not hidden returning likes;
$$;

create or replace function public.report_beat(beat_id uuid) returns void
language sql security definer set search_path = public as $$
  update beats set reports = reports + 1, hidden = (reports + 1 >= 3) where id = beat_id;
$$;

revoke all on function public.like_beat(uuid), public.report_beat(uuid), public.beats_before_insert() from public;
grant execute on function public.like_beat(uuid), public.report_beat(uuid) to anon, authenticated;

-- Live updates: new posts are pushed to everyone who has the feed open.
do $$ begin
  alter publication supabase_realtime add table public.beats;
exception when duplicate_object then null;
end $$;
