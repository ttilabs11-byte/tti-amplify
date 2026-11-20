-- 008: "new post" alerts go out in waves, not all at once (2026-11-20).
-- 15+ comments landing within a minute or two reads to LinkedIn as a coordinated pod and can cut the post's reach.
-- notify sends the first wave at once and queues the rest here; the 10-minute cron (cron_auto_remind -> notify)
-- sends each queued person when send_at has passed, skipping anyone who has already ticked the post.
create table public.push_queue (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  send_at timestamptz not null,
  primary key (post_id, user_id)
);
create index push_queue_send_at on public.push_queue (send_at);
create index push_queue_user on public.push_queue (user_id);

-- Only the service role (the notify Edge Function) touches it: RLS on, no policies, no client grants.
alter table public.push_queue enable row level security;
revoke all on public.push_queue from public, anon, authenticated;

-- The cron also calls notify when a queued wave is due (before, it only called when an auto-reminder was due).
create or replace function public.cron_auto_remind() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.due_auto_reminders())
     and not exists (select 1 from public.push_queue where send_at <= now()) then
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
