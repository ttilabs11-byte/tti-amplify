-- TTI Amplify schema: departments, profiles, posts, engagements, secrets, rate limit.

create table public.departments (
  id smallint generated always as identity primary key,
  name text not null unique check (char_length(name) between 1 and 60),
  sort smallint not null default 0
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (char_length(btrim(full_name)) between 2 and 80),
  department_id smallint references public.departments(id) on delete set null,
  role text not null default 'member' check (role in ('member', 'admin')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index profiles_department_idx on public.profiles (department_id);

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  url text not null check (url ~ '^https://([a-z0-9-]+\.)?linkedin\.com/' and char_length(url) <= 600),
  title text not null check (char_length(btrim(title)) between 3 and 140),
  note text check (char_length(note) <= 400),
  asks text[] not null default '{react,comment,repost}'
    check (asks <@ '{react,comment,repost}'::text[] and cardinality(asks) > 0),
  posted_on date not null default current_date,
  created_by uuid references public.profiles(id) on delete set null,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
create index posts_feed_idx on public.posts (posted_on desc, created_at desc) where not archived;
create index posts_created_by_idx on public.posts (created_by);

create table public.engagements (
  user_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  opened_at timestamptz not null default now(),
  open_count integer not null default 1,
  reacted boolean not null default false,
  commented boolean not null default false,
  reposted boolean not null default false,
  confirmed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, post_id)
);
create index engagements_post_idx on public.engagements (post_id);

create table public.app_secrets (
  key text primary key,
  value text not null
);

create table public.signup_attempts (
  id bigint generated always as identity primary key,
  ip text not null,
  at timestamptz not null default now()
);
create index signup_attempts_ip_at_idx on public.signup_attempts (ip, at);

-- Helpers ---------------------------------------------------------------

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin' and p.active
  );
$$;

create or replace function public.is_active_member()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p where p.id = (select auth.uid()) and p.active
  );
$$;

-- RLS -------------------------------------------------------------------

alter table public.departments enable row level security;
alter table public.profiles enable row level security;
alter table public.posts enable row level security;
alter table public.engagements enable row level security;
alter table public.app_secrets enable row level security;
alter table public.signup_attempts enable row level security;

revoke all on public.app_secrets, public.signup_attempts from anon, authenticated;
revoke all on public.engagements from anon;
revoke all on public.profiles, public.posts from anon;
revoke insert, update, delete on public.engagements from authenticated;
revoke insert, delete, update on public.profiles from authenticated;
grant update (full_name, department_id) on public.profiles to authenticated;
revoke insert, update, delete on public.departments from anon;

create policy "departments readable by all" on public.departments
  for select to anon, authenticated using (true);
create policy "admins manage departments" on public.departments
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "read own profile or admin reads all" on public.profiles
  for select to authenticated using (id = (select auth.uid()) or (select public.is_admin()));
create policy "update own name and department" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "active members read live posts" on public.posts
  for select to authenticated
  using ((not archived and (select public.is_active_member())) or (select public.is_admin()));
create policy "admins insert posts" on public.posts
  for insert to authenticated with check ((select public.is_admin()));
create policy "admins update posts" on public.posts
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admins delete posts" on public.posts
  for delete to authenticated using ((select public.is_admin()));

create policy "read own engagements or admin reads all" on public.engagements
  for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));

-- Engagement RPCs ---------------------------------------------------------

create or replace function public.mark_opened(p_post uuid)
returns public.engagements language plpgsql security definer set search_path = '' as $$
declare
  v_row public.engagements;
begin
  if not public.is_active_member() then
    raise exception 'Account is not active' using errcode = '42501';
  end if;
  if not exists (select 1 from public.posts where id = p_post and not archived) then
    raise exception 'Post not found' using errcode = 'P0002';
  end if;
  insert into public.engagements as e (user_id, post_id)
  values ((select auth.uid()), p_post)
  on conflict (user_id, post_id) do update
    set open_count = e.open_count + 1, updated_at = now()
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.confirm_engagement(
  p_post uuid, p_reacted boolean, p_commented boolean, p_reposted boolean
) returns public.engagements language plpgsql security definer set search_path = '' as $$
declare
  v_row public.engagements;
  v_any boolean := coalesce(p_reacted, false) or coalesce(p_commented, false) or coalesce(p_reposted, false);
begin
  if not public.is_active_member() then
    raise exception 'Account is not active' using errcode = '42501';
  end if;
  update public.engagements e
     set reacted = coalesce(p_reacted, false),
         commented = coalesce(p_commented, false),
         reposted = coalesce(p_reposted, false),
         confirmed_at = case when v_any then coalesce(e.confirmed_at, now()) else null end,
         updated_at = now()
   where e.user_id = (select auth.uid()) and e.post_id = p_post
  returning * into v_row;
  if v_row is null then
    raise exception 'Open the post on LinkedIn first' using errcode = 'P0001';
  end if;
  return v_row;
end;
$$;

-- Summaries ---------------------------------------------------------------

create or replace function public.my_summary()
returns json language sql stable security definer set search_path = '' as $$
  with live as (
    select p.id, p.posted_on, p.created_at from public.posts p where not p.archived
  ), mine as (
    select l.id, l.posted_on, l.created_at,
           (e.confirmed_at is not null) as done,
           coalesce(e.reacted::int, 0) + coalesce(e.commented::int, 0) + coalesce(e.reposted::int, 0) as actions
      from live l
      left join public.engagements e on e.post_id = l.id and e.user_id = (select auth.uid())
  ), ordered as (
    select done, row_number() over (order by posted_on desc, created_at desc) as rn from mine
  )
  select json_build_object(
    'live', (select count(*) from live),
    'done', (select count(*) from mine where done),
    'actions', (select coalesce(sum(actions), 0) from mine),
    'streak', coalesce((select min(rn) - 1 from ordered where not done), (select count(*) from ordered))
  );
$$;

create or replace function public.dept_board()
returns table (department text, members bigint, rate numeric)
language sql stable security definer set search_path = '' as $$
  with live as (select id from public.posts where not archived),
  m as (
    select pr.id, pr.department_id from public.profiles pr where pr.active and pr.department_id is not null
  )
  select d.name,
         count(distinct m.id) as members,
         case when count(distinct m.id) = 0 or (select count(*) from live) = 0 then 0
              else round(100.0 * (
                select count(*) from public.engagements e
                  join m m2 on m2.id = e.user_id and m2.department_id = d.id
                 where e.confirmed_at is not null and e.post_id in (select id from live)
              ) / (count(distinct m.id) * (select count(*) from live)), 0)
         end as rate
    from public.departments d
    join m on m.department_id = d.id
   where public.is_active_member()
   group by d.id, d.name
   order by rate desc, d.name;
$$;

-- Admin RPCs ----------------------------------------------------------------

create or replace function public.admin_post_stats()
returns table (post_id uuid, engaged bigint, opened bigint, members bigint)
language sql stable security definer set search_path = '' as $$
  select p.id,
         count(e.user_id) filter (where e.confirmed_at is not null and pr.active),
         count(e.user_id) filter (where pr.active),
         (select count(*) from public.profiles where active)
    from public.posts p
    left join public.engagements e on e.post_id = p.id
    left join public.profiles pr on pr.id = e.user_id
   where public.is_admin()
   group by p.id;
$$;

create or replace function public.admin_post_report(p_post uuid)
returns table (
  user_id uuid, full_name text, department text, opened_at timestamptz,
  reacted boolean, commented boolean, reposted boolean, confirmed_at timestamptz
) language sql stable security definer set search_path = '' as $$
  select pr.id, pr.full_name, d.name, e.opened_at,
         coalesce(e.reacted, false), coalesce(e.commented, false), coalesce(e.reposted, false), e.confirmed_at
    from public.profiles pr
    left join public.departments d on d.id = pr.department_id
    left join public.engagements e on e.user_id = pr.id and e.post_id = p_post
   where pr.active and public.is_admin()
   order by d.sort nulls last, d.name, pr.full_name;
$$;

create or replace function public.admin_people()
returns table (
  user_id uuid, full_name text, department_id smallint, department text, role text, active boolean,
  created_at timestamptz, engaged bigint, actions bigint, last_confirmed timestamptz
) language sql stable security definer set search_path = '' as $$
  select pr.id, pr.full_name, pr.department_id, d.name, pr.role, pr.active, pr.created_at,
         count(e.post_id) filter (where e.confirmed_at is not null),
         coalesce(sum(e.reacted::int + e.commented::int + e.reposted::int), 0),
         max(e.confirmed_at)
    from public.profiles pr
    left join public.departments d on d.id = pr.department_id
    left join public.engagements e on e.user_id = pr.id
   where public.is_admin()
   group by pr.id, d.name
   order by pr.active desc, pr.full_name;
$$;

revoke execute on all functions in schema public from anon, public;
grant execute on function public.is_admin(), public.is_active_member(), public.mark_opened(uuid),
  public.confirm_engagement(uuid, boolean, boolean, boolean), public.my_summary(), public.dept_board(),
  public.admin_post_stats(), public.admin_post_report(uuid), public.admin_people() to authenticated;

-- Realtime: new and edited posts reach open apps live.
alter publication supabase_realtime add table public.posts;

-- Seed ----------------------------------------------------------------------

insert into public.departments (name, sort) values
  ('Management', 1), ('HR & Admin', 2), ('Finance', 3), ('Sales & Marketing', 4),
  ('Customer Service', 5), ('Chemical Lab', 6), ('Physical Lab', 7), ('Quality', 8),
  ('IT', 9), ('Operations', 10);

-- 002: admin_people also returns the sign-in email (admins only).
drop function public.admin_people();
create function public.admin_people()
returns table (
  user_id uuid, full_name text, email text, department_id smallint, department text, role text, active boolean,
  created_at timestamptz, engaged bigint, actions bigint, last_confirmed timestamptz
) language sql stable security definer set search_path = '' as $$
  select pr.id, pr.full_name, u.email::text, pr.department_id, d.name, pr.role, pr.active, pr.created_at,
         count(e.post_id) filter (where e.confirmed_at is not null),
         coalesce(sum(e.reacted::int + e.commented::int + e.reposted::int), 0),
         max(e.confirmed_at)
    from public.profiles pr
    join auth.users u on u.id = pr.id
    left join public.departments d on d.id = pr.department_id
    left join public.engagements e on e.user_id = pr.id
   where public.is_admin()
   group by pr.id, u.email, d.name
   order by pr.active desc, pr.full_name;
$$;
revoke execute on function public.admin_people() from anon, public;
grant execute on function public.admin_people() to authenticated;

-- 003: my_summary() dropped; the app computes the summary on the device.
drop function if exists public.my_summary();

-- 004: Web Push. VAPID keys live in app_secrets (vapid_public, vapid_private), never in this repo.
create table public.push_subscriptions (
  endpoint text primary key check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  user_id uuid not null references public.profiles(id) on delete cascade,
  p256dh text not null check (char_length(p256dh) between 20 and 200),
  auth text not null check (char_length(auth) between 8 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon;
revoke insert, update, delete on public.push_subscriptions from authenticated;
create policy "read own push devices" on public.push_subscriptions
  for select to authenticated using (user_id = (select auth.uid()));

alter table public.posts add column last_reminded_at timestamptz;

-- A device endpoint belongs to whoever is signed in on that device now.
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_active_member() then
    raise exception 'Account is not active' using errcode = '42501';
  end if;
  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth)
  values (p_endpoint, (select auth.uid()), p_p256dh, p_auth)
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, updated_at = now();
end;
$$;

create or replace function public.delete_push_subscription(p_endpoint text)
returns void language sql security definer set search_path = '' as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = (select auth.uid());
$$;

revoke execute on function public.save_push_subscription(text, text, text), public.delete_push_subscription(text) from anon, public;
grant execute on function public.save_push_subscription(text, text, text), public.delete_push_subscription(text) to authenticated;
-- admin_people() also gained a push_devices column (count of a person's subscribed devices).
