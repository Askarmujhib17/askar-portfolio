-- Run after the ap_survey_entries table has been created.
-- Only the trusted backend can access these PIN-attempt counters.
begin;
create table if not exists public.ap_survey_login_limits (
  bucket text primary key,
  attempts integer not null default 0,
  window_start timestamptz not null default now()
);
alter table public.ap_survey_login_limits enable row level security;
revoke all on public.ap_survey_login_limits from anon, authenticated;

create or replace function public.ap_survey_take_login_attempt(client_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  ip_count integer;
  total_count integer;
begin
  if client_hash !~ '^[a-f0-9]{64}$' then
    return false;
  end if;
  -- Serialize the two counters, including simultaneous requests from different IPs.
  perform pg_advisory_xact_lock(724139862);
  delete from public.ap_survey_login_limits
    where window_start < now() - interval '15 minutes';
  select attempts into ip_count from public.ap_survey_login_limits
    where bucket = client_hash;
  select attempts into total_count from public.ap_survey_login_limits
    where bucket = 'global';
  if coalesce(ip_count, 0) >= 10 or coalesce(total_count, 0) >= 200 then
    return false;
  end if;
  insert into public.ap_survey_login_limits(bucket, attempts)
    values (client_hash, 1), ('global', 1)
    on conflict (bucket) do update
      set attempts = public.ap_survey_login_limits.attempts + 1;
  return true;
end;
$$;
revoke all on function public.ap_survey_take_login_attempt(text) from public, anon, authenticated;
grant execute on function public.ap_survey_take_login_attempt(text) to service_role;
commit;
