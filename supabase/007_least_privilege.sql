-- 007: least privilege, from the Supabase advisors (splinter) audit.

-- Internal helpers and trigger functions are only called inside SECURITY DEFINER code, never by clients.
revoke execute on function public.audit_posts(), public.audit_settings(), public.is_reporter(), public.scope_dept(),
  public.setting_bool(text, boolean), public.setting_int(text, integer), public.points_of(boolean, boolean, boolean)
  from public, anon, authenticated;

-- Clients never need TRUNCATE (it bypasses RLS), TRIGGER or REFERENCES.
revoke truncate, trigger, references on all tables in schema public from anon, authenticated;

-- One permissive policy per role and action: "for all" admin policies overlapped the member SELECT policies.
drop policy "admins write settings" on public.app_settings;
create policy "admins insert settings" on public.app_settings for insert to authenticated with check ((select public.is_admin()));
create policy "admins update settings" on public.app_settings for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admins delete settings" on public.app_settings for delete to authenticated using ((select public.is_admin()));

drop policy "admins manage departments" on public.departments;
create policy "admins insert departments" on public.departments for insert to authenticated with check ((select public.is_admin()));
create policy "admins update departments" on public.departments for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admins delete departments" on public.departments for delete to authenticated using ((select public.is_admin()));

-- New objects in public are opt-in (the platform default from late 2026); existing grants stay as they are.
alter default privileges for role postgres in schema public revoke select, insert, update, delete on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated, public;
alter default privileges for role postgres in schema public revoke usage, select on sequences from anon, authenticated;
