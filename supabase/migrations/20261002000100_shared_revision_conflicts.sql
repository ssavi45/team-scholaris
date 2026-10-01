-- Expected stale previews are application conflicts, not retryable DB serialization failures.
-- PostgREST maps 40001 to HTTP 500; use explicit HTTP 409 for a fixed stale preview.
create or replace function public.apply_shared_paper_manifest(p_project_id uuid,p_revision integer,p_entries jsonb,p_main_file text,p_confirm_shared boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare ending boolean;
begin
  perform public.require_paper_editor(p_project_id);
  if p_revision is distinct from (select revision from public.paper_workspaces where project_id=p_project_id) then
    raise exception 'Paper changed. Reload the file manager before saving.' using errcode='PT409';
  end if;
  select exists(select 1 from public.paper_shared_documents d join public.paper_files f on f.id=d.file_id
    where f.project_id=p_project_id and not exists(select 1 from jsonb_array_elements(p_entries) e
      where e->>'id'=f.id::text and e->>'kind'='text' and e->>'content'=f.content)) into ending;
  if ending and (not p_confirm_shared or not exists(select 1 from public.project_members where project_id=p_project_id and user_id=auth.uid() and access_level='owner')) then
    raise exception 'Only the owner can confirm replacing or deleting a live file. Other files and unchanged live-file renames remain available.' using errcode='42501';
  end if;
  if ending then perform public.paper_history_capture(p_project_id,'safety','Before replacing live files',true);
  else perform public.paper_history_capture(p_project_id,'automatic','Before file changes',true); end if;
  perform set_config('paper.shared_lifecycle',p_project_id::text,true);
  perform public.paper_manifest_internal(p_project_id,p_revision,p_entries,p_main_file);
  perform set_config('paper.shared_lifecycle','',true);
  perform public.paper_history_capture(p_project_id,'automatic','File changes',true);
end $$;

create or replace function public.restore_shared_paper_history(p_project_id uuid,p_history_id bigint,p_revision integer,p_file_id uuid default null,p_confirm_shared boolean default false)
returns integer language plpgsql security definer set search_path = '' as $$
declare result integer;
begin
  perform public.require_paper_editor(p_project_id);
  if p_revision is distinct from (select revision from public.paper_workspaces where project_id=p_project_id) then
    raise exception 'Paper changed. Refresh history and compare again.' using errcode='PT409';
  end if;
  if exists(select 1 from public.paper_shared_documents d join public.paper_files f on f.id=d.file_id where f.project_id=p_project_id and (p_file_id is null or f.id=p_file_id))
    and (not p_confirm_shared or not exists(select 1 from public.project_members where project_id=p_project_id and user_id=auth.uid() and access_level='owner')) then
    raise exception 'Only the owner can confirm restoring a live file. Download unsent drafts first.' using errcode='42501';
  end if;
  perform set_config('paper.shared_lifecycle',p_project_id::text,true);
  perform set_config('paper.shared_restore',coalesce(p_file_id::text,'*'),true);
  result := public.restore_paper_history(p_project_id,p_history_id,p_revision,p_file_id);
  perform set_config('paper.shared_restore','',true);
  perform set_config('paper.shared_lifecycle','',true);
  return result;
end $$;


create function public.create_shared_paper_checkpoint(p_project_id uuid,p_revision integer,p_label text)
returns bigint language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_paper_editor(p_project_id);
  if p_revision is distinct from (select revision from public.paper_workspaces where project_id=p_project_id) then
    raise exception 'Paper changed. Refresh before creating the checkpoint.' using errcode='PT409';
  end if;
  return public.create_paper_checkpoint(p_project_id,p_revision,p_label);
end $$;
revoke all on function public.create_shared_paper_checkpoint(uuid,integer,text) from public,anon;
grant execute on function public.create_shared_paper_checkpoint(uuid,integer,text) to authenticated;
