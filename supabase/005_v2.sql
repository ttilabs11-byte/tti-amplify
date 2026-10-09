-- 005: TTI Amplify v2. HOD role, settings, audit log, images, comment starters, LinkedIn results,
-- insights, top amplifiers, client error log, auto-reminder cron. Secrets are inserted separately, never here.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Roles and onboarding ------------------------------------------------------------
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('member', 'hod', 'admin'));
alter table public.profiles
  add column onboarded_at timestamptz,
  add column checklist text[] not null default '{}' check (checklist <@ '{follow,employer,photo}'::text[]);
grant update (onboarded_at, checklist) on public.profiles to authenticated;

-- Posts -----------------------------------------------------------------------------
create or replace function public.starters_ok(p text[]) returns boolean
language sql immutable set search_path = '' as $$
  select cardinality(p) <= 5 and coalesce(bool_and(char_length(btrim(s)) between 1 and 280), true) from unnest(p) s;
$$;

alter table public.posts
  add column image_path text check (image_path ~ '^[a-z0-9-]{8,64}\.webp$'),
  add column starters text[] not null default '{}' check (public.starters_ok(starters)),
  add column li_impressions integer check (li_impressions >= 0),
  add column li_reactions integer check (li_reactions >= 0),
  add column li_comments integer check (li_comments >= 0),
  add column li_reposts integer check (li_reposts >= 0),
  add column li_recorded_at timestamptz,
  add column auto_reminded_at timestamptz;
create unique index posts_url_live_key on public.posts (url) where not archived;

-- Settings --------------------------------------------------------------------------
create table public.app_settings (
  key text primary key check (key in ('active_days', 'remind_after_hours', 'quiet_hours', 'show_top')),
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon;
create policy "members read settings" on public.app_settings for select to authenticated using (true);
create policy "admins write settings" on public.app_settings for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
insert into public.app_settings (key, value) values
  ('active_days', '14'), ('remind_after_hours', '4'), ('quiet_hours', 'true'), ('show_top', 'false');

create or replace function public.setting_int(p_key text, p_default integer) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce((select (value #>> '{}')::integer from public.app_settings where key = p_key), p_default);
$$;
create or replace function public.setting_bool(p_key text, p_default boolean) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select (value #>> '{}')::boolean from public.app_settings where key = p_key), p_default);
$$;

-- Audit log -------------------------------------------------------------------------
create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid references public.profiles(id) on delete set null,
  action text not null,
  target text,
  detail jsonb
);
create index audit_log_at_idx on public.audit_log (at desc);
create index audit_log_actor_idx on public.audit_log (actor);
alter table public.audit_log enable row level security;
revoke all on public.audit_log from anon;
revoke insert, update, delete on public.audit_log from authenticated;
create policy "admins read audit" on public.audit_log for select to authenticated using ((select public.is_admin()));

create or replace function public.audit_posts() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log (actor, action, target, detail) values ((select auth.uid()), 'post.create', new.id::text, jsonb_build_object('title', new.title));
  elsif new.archived is distinct from old.archived then
    insert into public.audit_log (actor, action, target, detail)
    values ((select auth.uid()), case when new.archived then 'post.archive' else 'post.restore' end, new.id::text, jsonb_build_object('title', new.title));
  end if;
  return new;
end;
$$;
create trigger posts_audit after insert or update on public.posts for each row execute function public.audit_posts();

create or replace function public.audit_settings() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_log (actor, action, target, detail) values ((select auth.uid()), 'settings.update', new.key, jsonb_build_object('value', new.value));
  return new;
end;
$$;
create trigger settings_audit after update on public.app_settings for each row execute function public.audit_settings();

-- Client error log ------------------------------------------------------------------
create table public.client_errors (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid,
  message text not null,
  stack text,
  url text,
  ua text
);
create index client_errors_user_at_idx on public.client_errors (user_id, at);
alter table public.client_errors enable row level security;
revoke all on public.client_errors from anon, authenticated;

create or replace function public.log_client_error(p_message text, p_stack text, p_url text, p_ua text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.client_errors where user_id = (select auth.uid()) and at > now() - interval '1 day') >= 20 then
    return;
  end if;
  insert into public.client_errors (user_id, message, stack, url, ua)
  values ((select auth.uid()), left(coalesce(p_message, ''), 500), left(p_stack, 2000), left(p_url, 300), left(p_ua, 300));
end;
$$;

-- Reporting scope: admins see everyone, HODs only their own department ----------------
create or replace function public.is_reporter() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = (select auth.uid()) and active and role in ('admin', 'hod'));
$$;
create or replace function public.scope_dept() returns smallint
language sql stable security definer set search_path = '' as $$
  select case when role = 'admin' then null else coalesce(department_id, -1) end
    from public.profiles where id = (select auth.uid()) and active and role in ('admin', 'hod');
$$;

create or replace function public.points_of(r boolean, c boolean, p boolean) returns integer
language sql immutable set search_path = '' as $$
  select coalesce(r::int, 0) * 1 + coalesce(c::int, 0) * 3 + coalesce(p::int, 0) * 3;
$$;

drop function public.admin_post_stats();
create function public.admin_post_stats()
returns table (post_id uuid, engaged bigint, opened bigint, members bigint)
language sql stable security definer set search_path = '' as $$
  with s as (select public.scope_dept() as d),
  m as (select pr.id from public.profiles pr, s where pr.active and (s.d is null or pr.department_id = s.d))
  select p.id,
         count(e.user_id) filter (where e.confirmed_at is not null),
         count(e.user_id),
         (select count(*) from m)
    from public.posts p
    left join public.engagements e on e.post_id = p.id and e.user_id in (select id from m)
   where public.is_reporter()
   group by p.id;
$$;

drop function public.admin_post_report(uuid);
create function public.admin_post_report(p_post uuid)
returns table (
  user_id uuid, full_name text, department text, opened_at timestamptz,
  reacted boolean, commented boolean, reposted boolean, confirmed_at timestamptz
) language sql stable security definer set search_path = '' as $$
  select pr.id, pr.full_name, d.name, e.opened_at,
         coalesce(e.reacted, false), coalesce(e.commented, false), coalesce(e.reposted, false), e.confirmed_at
    from public.profiles pr
    left join public.departments d on d.id = pr.department_id
    left join public.engagements e on e.user_id = pr.id and e.post_id = p_post
   where pr.active and public.is_reporter()
     and (public.scope_dept() is null or pr.department_id = public.scope_dept())
   order by d.sort nulls last, d.name, pr.full_name;
$$;

drop function public.admin_people();
create function public.admin_people()
returns table (
  user_id uuid, full_name text, email text, department_id smallint, department text, role text, active boolean,
  created_at timestamptz, engaged bigint, actions bigint, last_confirmed timestamptz, push_devices bigint, points bigint
) language sql stable security definer set search_path = '' as $$
  select pr.id, pr.full_name, u.email::text, pr.department_id, d.name, pr.role, pr.active, pr.created_at,
         count(e.post_id) filter (where e.confirmed_at is not null),
         coalesce(sum(e.reacted::int + e.commented::int + e.reposted::int), 0),
         max(e.confirmed_at),
         (select count(*) from public.push_subscriptions s where s.user_id = pr.id),
         coalesce(sum(public.points_of(e.reacted, e.commented, e.reposted)), 0)
    from public.profiles pr
    join auth.users u on u.id = pr.id
    left join public.departments d on d.id = pr.department_id
    left join public.engagements e on e.user_id = pr.id
   where public.is_reporter() and (public.scope_dept() is null or pr.department_id = public.scope_dept())
   group by pr.id, u.email, d.name
   order by pr.active desc, pr.full_name;
$$;

-- Insights (reporters, scoped) --------------------------------------------------------
create or replace function public.insights() returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  v_scope smallint := public.scope_dept();
  v_result json;
begin
  if not public.is_reporter() then
    return null;
  end if;
  with m as (
    select pr.id, pr.full_name, pr.department_id, pr.created_at from public.profiles pr
     where pr.active and (v_scope is null or pr.department_id = v_scope)
  ), recent as (
    select p.* from public.posts p order by p.posted_on desc, p.created_at desc limit 12
  ), trend as (
    select r.id, r.title, r.posted_on, r.li_impressions, r.li_reactions, r.li_comments, r.li_reposts,
           (select count(*) from public.engagements e where e.post_id = r.id and e.confirmed_at is not null and e.user_id in (select id from m)) as done,
           (select count(*) from m) as members
      from recent r
  ), heat as (
    select d.name as department, r.id as post_id,
           count(m.id) as members,
           count(e.user_id) filter (where e.confirmed_at is not null) as done
      from (select * from recent order by posted_on desc, created_at desc limit 8) r
      cross join public.departments d
      join m on m.department_id = d.id
      left join public.engagements e on e.post_id = r.id and e.user_id = m.id
     group by d.name, d.sort, r.id
  ), last_tick as (
    select m.id, m.full_name, d.name as department, m.created_at, max(e.confirmed_at) as last_confirmed
      from m left join public.departments d on d.id = m.department_id
      left join public.engagements e on e.user_id = m.id and e.confirmed_at is not null
     group by m.id, m.full_name, d.name, m.created_at
  ), month_points as (
    select m.id, m.full_name, d.name as department,
           sum(public.points_of(e.reacted, e.commented, e.reposted)) as points
      from m join public.engagements e on e.user_id = m.id
      left join public.departments d on d.id = m.department_id
     where e.confirmed_at >= date_trunc('month', now() at time zone 'Asia/Karachi') at time zone 'Asia/Karachi'
     group by m.id, m.full_name, d.name
  )
  select json_build_object(
    'trend', coalesce((select json_agg(t order by t.posted_on, t.id) from trend t), '[]'),
    'heat', coalesce((select json_agg(x) from heat x), '[]'),
    'inactive', coalesce((select json_agg(l order by l.last_confirmed nulls first, l.full_name) from last_tick l
                          where (l.last_confirmed is null or l.last_confirmed < now() - interval '30 days')), '[]'),
    'top', coalesce((select json_agg(mp order by mp.points desc, mp.full_name) from (select * from month_points order by points desc, full_name limit 5) mp), '[]')
  ) into v_result;
  return v_result;
end;
$$;

-- Staff-visible top amplifiers: positive only, first name, only when an admin enables it ---
create or replace function public.top_amplifiers()
returns table (first_name text, department text, points bigint)
language sql stable security definer set search_path = '' as $$
  select split_part(pr.full_name, ' ', 1), d.name, sum(public.points_of(e.reacted, e.commented, e.reposted))::bigint
    from public.engagements e
    join public.profiles pr on pr.id = e.user_id and pr.active
    left join public.departments d on d.id = pr.department_id
   where e.confirmed_at >= date_trunc('month', now() at time zone 'Asia/Karachi') at time zone 'Asia/Karachi'
     and public.is_active_member()
     and (public.setting_bool('show_top', false) or public.is_reporter())
   group by pr.id, pr.full_name, d.name
  having sum(public.points_of(e.reacted, e.commented, e.reposted)) > 0
   order by 3 desc, 1
   limit 5;
$$;

-- Auto reminders ------------------------------------------------------------------------
create or replace function public.due_auto_reminders() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select p.id from public.posts p
   where not p.archived and p.auto_reminded_at is null
     and p.created_at <= now() - make_interval(hours => public.setting_int('remind_after_hours', 4))
     and p.created_at > now() - interval '3 days'
     and (not public.setting_bool('quiet_hours', true)
          or extract(hour from now() at time zone 'Asia/Karachi') between 8 and 20);
$$;

create or replace function public.cron_auto_remind() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.due_auto_reminders()) then
    return;
  end if;
  perform net.http_post(
    url := 'https://fuhnyjmbjzjflxylxakw.supabase.co/functions/v1/notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select value from public.app_secrets where key = 'anon_jwt'),
      'x-cron-secret', (select value from public.app_secrets where key = 'cron_secret')),
    body := '{"kind":"auto"}'::jsonb);
end;
$$;

-- Storage for post images: public read, admin write -----------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('post-images', 'post-images', true, 2097152, '{image/webp}')
on conflict (id) do nothing;
create policy "admins upload post images" on storage.objects for insert to authenticated
  with check (bucket_id = 'post-images' and (select public.is_admin()));
create policy "admins update post images" on storage.objects for update to authenticated
  using (bucket_id = 'post-images' and (select public.is_admin()));
create policy "admins delete post images" on storage.objects for delete to authenticated
  using (bucket_id = 'post-images' and (select public.is_admin()));

-- Grants ----------------------------------------------------------------------------------
revoke execute on function public.starters_ok(text[]), public.setting_int(text, integer), public.setting_bool(text, boolean),
  public.audit_posts(), public.audit_settings(), public.log_client_error(text, text, text, text), public.is_reporter(),
  public.scope_dept(), public.points_of(boolean, boolean, boolean), public.admin_post_stats(), public.admin_post_report(uuid),
  public.admin_people(), public.insights(), public.top_amplifiers(), public.due_auto_reminders(), public.cron_auto_remind()
  from anon, public;
revoke execute on function public.due_auto_reminders(), public.cron_auto_remind() from authenticated;
grant execute on function public.due_auto_reminders() to service_role;
-- starters_ok runs inside a CHECK constraint, so the inserting role needs EXECUTE.
grant execute on function public.starters_ok(text[]), public.log_client_error(text, text, text, text), public.is_reporter(), public.admin_post_stats(),
  public.admin_post_report(uuid), public.admin_people(), public.insights(), public.top_amplifiers() to authenticated;

select cron.schedule('amplify-auto-remind', '*/10 * * * *', 'select public.cron_auto_remind()');
