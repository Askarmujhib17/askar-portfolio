begin;
alter table public.ap_survey_entries
  add column if not exists ap_jobs jsonb,
  add column if not exists photo_paths text[],
  add column if not exists expansion_unrecorded boolean not null default false;
-- Existing scalar fields and photo_path are retained for compatibility/rollback.
update public.ap_survey_entries
set photo_paths=case when photo_path is null then array[]::text[] else array[photo_path] end
where photo_paths is null;
-- AP-job conversion is performed by the API on read, without assuming equipment.
-- NULL ap_jobs identifies legacy entries until their first save in the new app.
create table if not exists public.ap_survey_inventory (
  hostname_key text primary key,
  hostname text not null,
  model text not null default '',
  serial text not null default '',
  mac text not null default ''
);
alter table public.ap_survey_inventory enable row level security;
revoke all on public.ap_survey_inventory from anon, authenticated;
grant select,insert,update,delete on public.ap_survey_inventory to service_role;
commit;
