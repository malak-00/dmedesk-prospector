-- DME Desk Prospector: reviewed NPPES staging lifecycle and transactional apply.
-- MANUAL ONLY. Execute after 004_nppes_refresh_staging.sql and verify with the
-- read-only queries in that file after every operation.

create or replace function public.finalize_nppes_staging(p_run_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.refresh_runs%rowtype; actual integer; expected integer;
begin
  select * into r from public.refresh_runs where id=p_run_id for update;
  if not found then raise exception 'refresh run % does not exist', p_run_id; end if;
  if r.status <> 'staged' or coalesce(r.metadata->>'staging_state','') <> 'uploading' then
    raise exception 'refresh run % is not uploading', p_run_id;
  end if;
  expected := coalesce((r.metadata->>'expected_staged_rows')::integer, r.row_count, -1);
  select count(*) into actual from public.nppes_refresh_staging where refresh_run_id=p_run_id;
  if expected < 0 or actual <> expected then
    raise exception 'refresh run % count mismatch: expected %, actual %', p_run_id, expected, actual;
  end if;
  update public.refresh_runs set row_count=actual,
    completed_at=now(), metadata=metadata || jsonb_build_object('staging_state','complete','staged_rows',actual)
    where id=p_run_id;
  return jsonb_build_object('run_id',p_run_id,'status','complete','staged_rows',actual);
end $$;

create or replace function public.abort_nppes_refresh(p_run_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.refresh_runs%rowtype; removed integer;
begin
  if nullif(trim(p_reason),'') is null then raise exception 'abort reason is required'; end if;
  select * into r from public.refresh_runs where id=p_run_id for update;
  if not found then raise exception 'refresh run % does not exist', p_run_id; end if;
  if r.status not in ('staged','failed') or coalesce(r.metadata->>'staging_state','') = 'complete' then
    raise exception 'refresh run % cannot be aborted in status %', p_run_id, r.status;
  end if;
  delete from public.nppes_refresh_staging where refresh_run_id=p_run_id;
  get diagnostics removed = row_count;
  update public.refresh_runs set status='failed', completed_at=now(),
    metadata=metadata || jsonb_build_object('staging_state','failed','failure_reason',trim(p_reason),'aborted_rows',removed)
    where id=p_run_id;
  return jsonb_build_object('run_id',p_run_id,'status','failed','deleted_rows',removed);
end $$;

create or replace function public.apply_nppes_refresh(p_run_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.refresh_runs%rowtype; s public.nppes_refresh_staging%rowtype;
  old_row public.npi_records%rowtype; old_json jsonb; new_json jsonb; k text; changed integer:=0; inserted integer:=0; updated integer:=0;
  is_deactivation boolean;
begin
  select * into r from public.refresh_runs where id=p_run_id for update;
  if not found then raise exception 'refresh run % does not exist', p_run_id; end if;
  if r.status <> 'staged' or coalesce(r.metadata->>'staging_state','') <> 'complete' then
    raise exception 'refresh run % must be complete before apply', p_run_id;
  end if;
  if (select count(*) from public.nppes_refresh_staging where refresh_run_id=p_run_id) <> coalesce(r.row_count,-1) then
    raise exception 'refresh run % staging count changed after finalization', p_run_id;
  end if;
  if exists (select 1 from public.refresh_runs x where x.id<>p_run_id and x.source='nppes'
             and x.status in ('applied','staged') and x.metadata->>'source_checksum'=r.metadata->>'source_checksum'
             and coalesce(r.metadata->>'operator_override','false') <> 'true') then
    raise exception 'source checksum already completed or staged; operator override required';
  end if;
  for s in select * from public.nppes_refresh_staging where refresh_run_id=p_run_id order by npi for update loop
    select * into old_row from public.npi_records where npi=s.npi for update;
    is_deactivation := coalesce(r.metadata->>'run_type','') = 'deactivation';
    if not found then
      if is_deactivation then continue; end if;
      insert into public.npi_records (npi,name,normalized_name,enumerationtype,isorganization,status,replacement_npi,address_line1,address_line2,address_city,address_state,address_postal_code,phone,fax,taxonomy_code,taxonomy_codes,authorizedofficial_firstname,authorizedofficial_lastname,authorizedofficial_title,authorizedofficial_phone,enumeration_date,lastupdated,deactivation_date,reactivation_date,certification_date)
      values (s.npi,s.name,s.normalized_name,s.enumerationtype,s.isorganization,s.status,s.replacement_npi,s.address_line1,s.address_line2,s.address_city,s.address_state,s.address_postal_code,s.phone,s.fax,s.taxonomy_code,s.taxonomy_codes,s.authorizedofficial_firstname,s.authorizedofficial_lastname,s.authorizedofficial_title,s.authorizedofficial_phone,s.enumeration_date,s.lastupdated,s.deactivation_date,s.reactivation_date,s.certification_date);
      inserted:=inserted+1; continue;
    end if;
    old_json := jsonb_build_object('name',old_row.name,'normalized_name',old_row.normalized_name,'status',old_row.status,'address_line1',old_row.address_line1,'address_line2',old_row.address_line2,'address_city',old_row.address_city,'address_state',old_row.address_state,'address_postal_code',old_row.address_postal_code,'phone',old_row.phone,'fax',old_row.fax,'taxonomy_code',old_row.taxonomy_code,'authorizedofficial_firstname',old_row.authorizedofficial_firstname,'authorizedofficial_lastname',old_row.authorizedofficial_lastname,'authorizedofficial_title',old_row.authorizedofficial_title,'authorizedofficial_phone',old_row.authorizedofficial_phone,'deactivation_date',old_row.deactivation_date,'reactivation_date',old_row.reactivation_date);
    new_json := jsonb_build_object('name',case when is_deactivation then old_row.name else s.name end,'normalized_name',case when is_deactivation then old_row.normalized_name else s.normalized_name end,'status',case when is_deactivation then s.status else s.status end,'address_line1',case when is_deactivation then old_row.address_line1 else s.address_line1 end,'address_line2',case when is_deactivation then old_row.address_line2 else s.address_line2 end,'address_city',case when is_deactivation then old_row.address_city else s.address_city end,'address_state',case when is_deactivation then old_row.address_state else s.address_state end,'address_postal_code',case when is_deactivation then old_row.address_postal_code else s.address_postal_code end,'phone',case when is_deactivation then old_row.phone else s.phone end,'fax',case when is_deactivation then old_row.fax else s.fax end,'taxonomy_code',case when is_deactivation then old_row.taxonomy_code else s.taxonomy_code end,'authorizedofficial_firstname',case when is_deactivation then old_row.authorizedofficial_firstname else s.authorizedofficial_firstname end,'authorizedofficial_lastname',case when is_deactivation then old_row.authorizedofficial_lastname else s.authorizedofficial_lastname end,'authorizedofficial_title',case when is_deactivation then old_row.authorizedofficial_title else s.authorizedofficial_title end,'authorizedofficial_phone',case when is_deactivation then old_row.authorizedofficial_phone else s.authorizedofficial_phone end,'deactivation_date',case when is_deactivation then s.deactivation_date else s.deactivation_date end,'reactivation_date',case when is_deactivation then old_row.reactivation_date else s.reactivation_date end);
    for k in select key from jsonb_each(old_json) loop
      if (old_json->k) is distinct from (new_json->k) then
        insert into public.provider_field_history(npi,field_name,old_value,new_value,source,refresh_run_id) values(s.npi,k,old_json->k,new_json->k,'nppes',p_run_id); changed:=changed+1;
      end if;
    end loop;
    update public.npi_records set name=(new_json->>'name'),normalized_name=(new_json->>'normalized_name'),status=(new_json->>'status'),address_line1=(new_json->>'address_line1'),address_line2=(new_json->>'address_line2'),address_city=(new_json->>'address_city'),address_state=(new_json->>'address_state'),address_postal_code=(new_json->>'address_postal_code'),phone=(new_json->>'phone'),fax=(new_json->>'fax'),taxonomy_code=(new_json->>'taxonomy_code'),authorizedofficial_firstname=(new_json->>'authorizedofficial_firstname'),authorizedofficial_lastname=(new_json->>'authorizedofficial_lastname'),authorizedofficial_title=(new_json->>'authorizedofficial_title'),authorizedofficial_phone=(new_json->>'authorizedofficial_phone'),deactivation_date=(new_json->>'deactivation_date')::date,reactivation_date=(new_json->>'reactivation_date')::date where npi=s.npi;
    updated:=updated+1;
  end loop;
  update public.refresh_runs set status='applied',completed_at=now(),metadata=metadata||jsonb_build_object('apply_changed_fields',changed,'apply_inserted',inserted,'apply_updated',updated) where id=p_run_id;
  return jsonb_build_object('run_id',p_run_id,'status','applied','changed_fields',changed,'inserted',inserted,'updated',updated);
end $$;

revoke all on function public.finalize_nppes_staging(uuid) from public;
revoke all on function public.abort_nppes_refresh(uuid,text) from public;
revoke all on function public.apply_nppes_refresh(uuid) from public;
