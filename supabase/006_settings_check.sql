-- 006: settings values must have the right shape; a bad value would break setting_int() and the reminder cron.
alter table public.app_settings add constraint app_settings_value_ok check (
  case key
    when 'active_days' then case when jsonb_typeof(value) = 'number' then value::numeric in (7, 14, 30, 60) else false end
    when 'remind_after_hours' then case when jsonb_typeof(value) = 'number' then value::numeric in (2, 4, 8, 24) else false end
    else jsonb_typeof(value) = 'boolean'
  end
);

-- Storage deletes read the object first, so admins also need SELECT (the public URL serves everyone else).
create policy "admins read post images" on storage.objects for select to authenticated
  using (bucket_id = 'post-images' and (select public.is_admin()));
