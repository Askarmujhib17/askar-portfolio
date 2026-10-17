begin;
create table if not exists public.ap_survey_schools (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 200),
  school_type text not null check (school_type in ('Primary','Secondary','Unassigned')),
  created_at timestamptz not null default now()
);
create unique index if not exists ap_survey_school_name_unique on public.ap_survey_schools(lower(trim(name)));
alter table public.ap_survey_schools enable row level security;
revoke all on public.ap_survey_schools from anon,authenticated;
grant select,insert,update on public.ap_survey_schools to service_role;
insert into public.ap_survey_schools(id,name,school_type)
values('00000000-0000-4000-8000-000000000001','Existing survey — needs school assignment','Unassigned')
on conflict(id) do nothing;
alter table public.ap_survey_entries
  add column if not exists school_id uuid references public.ap_survey_schools(id),
  add column if not exists room_number text not null default '',
  add column if not exists room_name text,
  add column if not exists location_equipment text not null default 'None';
update public.ap_survey_entries set school_id='00000000-0000-4000-8000-000000000001' where school_id is null;
update public.ap_survey_entries set room_name=room where room_name is null;
alter table public.ap_survey_entries alter column school_id set not null;
alter table public.ap_survey_entries alter column school_id set default '00000000-0000-4000-8000-000000000001';
alter table public.ap_survey_entries alter column room_name set not null;
alter table public.ap_survey_entries alter column room_name set default '';
-- Photos are now optional for every AP job. Old scalar columns are retained.
alter table public.ap_survey_entries drop constraint if exists relocation_details_required;
alter table public.ap_survey_entries drop constraint if exists ap_survey_expansion_photo;
create index if not exists ap_survey_entries_school on public.ap_survey_entries(school_id,created_at,id);
alter table public.ap_survey_inventory add column if not exists school_id uuid references public.ap_survey_schools(id);
update public.ap_survey_inventory set school_id='00000000-0000-4000-8000-000000000001' where school_id is null;
alter table public.ap_survey_inventory alter column school_id set not null;
alter table public.ap_survey_inventory alter column school_id set default '00000000-0000-4000-8000-000000000001';
alter table public.ap_survey_inventory drop constraint if exists ap_survey_inventory_pkey;
alter table public.ap_survey_inventory add primary key(school_id,hostname_key);
commit;
