begin;
alter table public.ap_survey_entries
  add column if not exists additional_ap_required boolean,
  add column if not exists expansion_cabling text,
  add column if not exists remarks text not null default '';
-- NULL expansion means not recorded, including all existing entries.
do $$
begin
  if not exists (select 1 from pg_constraint where conname='ap_survey_expansion_choices' and conrelid='public.ap_survey_entries'::regclass) then
    alter table public.ap_survey_entries add constraint ap_survey_expansion_choices
      check (expansion_cabling is null or expansion_cabling in ('Yes','No','Not assessed'));
  end if;
  if not exists (select 1 from pg_constraint where conname='ap_survey_expansion_photo' and conrelid='public.ap_survey_entries'::regclass) then
    alter table public.ap_survey_entries add constraint ap_survey_expansion_photo
      check (additional_ap_required is distinct from true or (photo_path is not null and length(trim(photo_path))>0 and expansion_cabling is not null));
  end if;
end;
$$;
commit;
