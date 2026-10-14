begin;
alter table public.ap_survey_entries
  add column if not exists new_cabling text default 'Not assessed';
-- Existing records default to Not assessed, without inferring Yes or No.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ap_survey_new_cabling_choices'
      and conrelid = 'public.ap_survey_entries'::regclass
  ) then
    alter table public.ap_survey_entries
      add constraint ap_survey_new_cabling_choices
      check (new_cabling is null or new_cabling in ('Yes', 'No', 'Not assessed'));
  end if;
end;
$$;
commit;
