-- Retained causal checkpoints follow the existing history retention and quota.
create table public.paper_history_shared (
  history_id bigint not null references public.paper_history(id) on delete cascade,
  file_id uuid not null, epoch uuid not null, sequence bigint not null,
  state text not null check (octet_length(state) <= 2796204),
  primary key(history_id,file_id)
);
alter table public.paper_history_shared enable row level security;
revoke all on public.paper_history_shared from public, anon, authenticated, service_role;
create function public.capture_history_shared() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.paper_history_shared(history_id,file_id,epoch,sequence,state)
  select new.id,d.file_id,d.epoch,d.sequence,d.state from public.paper_shared_documents d
  join public.paper_files f on f.id=d.file_id where f.project_id=new.project_id;
  return new;
end $$;
revoke all on function public.capture_history_shared() from public,anon,authenticated;
create trigger paper_causal_history after insert on public.paper_history
for each row execute function public.capture_history_shared();

create or replace function public.guard_shared_paper_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists(select 1 from public.paper_shared_documents where file_id=old.id)
    and current_setting('paper.shared_write',true) is distinct from old.id::text
    and current_setting('paper.shared_lifecycle',true) is distinct from old.project_id::text then
    raise exception 'This file uses live writing. Use the current file manager or history; keep your local draft.' using errcode='PT409';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;

-- The old mutation RPC remains fenced. Only this revision-checked operation can
-- preserve enrolled identities through the legacy manifest replacement transaction.
create function public.apply_shared_paper_manifest(p_project_id uuid,p_revision integer,p_entries jsonb,p_main_file text,p_confirm_shared boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare ending boolean;
begin
  perform public.require_paper_editor(p_project_id);
  if p_revision is distinct from (select revision from public.paper_workspaces where project_id=p_project_id) then
    raise exception 'Paper changed. Reload the file manager before saving.' using errcode='40001';
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

create function public.restore_shared_paper_history(p_project_id uuid,p_history_id bigint,p_revision integer,p_file_id uuid default null,p_confirm_shared boolean default false)
returns integer language plpgsql security definer set search_path = '' as $$
declare result integer;
begin
  perform public.require_paper_editor(p_project_id);
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

-- A coherent metadata read avoids bracketing separate reads during live typing.
create function public.read_paper_state(p_project uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.projects where id=p_project for update;
  if not public.can_access_project(p_project) then raise exception 'Paper unavailable.' using errcode='42501'; end if;
  return jsonb_build_object('settings',(select jsonb_build_object('revision',revision,'main_file',main_file) from public.paper_workspaces where project_id=p_project),
    'files',coalesce((select jsonb_agg(to_jsonb(f)||jsonb_build_object('shared_epoch',d.epoch) order by f.path) from public.paper_files f left join public.paper_shared_documents d on d.file_id=f.id where f.project_id=p_project),'[]'));
end $$;
revoke all on function public.apply_shared_paper_manifest(uuid,integer,jsonb,text,boolean),public.restore_shared_paper_history(uuid,bigint,integer,uuid,boolean),public.read_paper_state(uuid) from public,anon;
grant execute on function public.apply_shared_paper_manifest(uuid,integer,jsonb,text,boolean),public.restore_shared_paper_history(uuid,bigint,integer,uuid,boolean),public.read_paper_state(uuid) to authenticated;

create or replace function public.paper_history_capture(p_project uuid, p_kind text, p_label text, p_force boolean default false, p_keep bigint default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare state public.paper_workspaces; payload jsonb; bytes bigint; result bigint; victim bigint; asset_bytes bigint;
begin
  select * into state from public.paper_workspaces where project_id = p_project;
  if not found then return null; end if;
  if p_kind = 'automatic' and not p_force and exists(select 1 from public.paper_history where project_id = p_project and created_at > clock_timestamp() - interval '5 minutes') then return null; end if;
  if p_kind = 'automatic' then
    select id into result from public.paper_history where project_id = p_project and revision = state.revision order by id desc limit 1;
    if result is not null then return result; end if;
  elsif (select count(*) from public.paper_history where project_id = p_project and kind <> 'automatic') >= 20 then
    raise exception 'Checkpoint limit reached (20). Download and explicitly delete an unneeded protected checkpoint first.' using errcode = '54000';
  end if;
  select coalesce(jsonb_agg(to_jsonb(f) order by f.path),'[]') into payload from public.paper_files f where project_id = p_project;
  -- Empty workspaces are valid snapshots and restore safety checkpoints.
  bytes := octet_length(payload::text) + coalesce((select sum(octet_length(d.state)) from public.paper_shared_documents d join public.paper_files f on f.id=d.file_id where f.project_id=p_project),0);
  delete from public.paper_history where project_id = p_project and kind = 'automatic' and created_at < clock_timestamp() - interval '7 days' and id is distinct from p_keep;
  loop
    select coalesce(sum(size_bytes),0) into asset_bytes from (
      select storage_path, max(size_bytes) as size_bytes from (
        select f.storage_path, f.size_bytes from public.paper_files f where project_id = p_project and kind = 'image'
        union all select e->>'storage_path',(e->>'size_bytes')::bigint from public.paper_history h cross join lateral jsonb_array_elements(h.files) e where h.project_id = p_project and e->>'kind' = 'image'
      ) assets group by storage_path
    ) distinct_assets;
    exit when (select coalesce(sum(size_bytes),0) from public.paper_history where project_id = p_project) + bytes <= 52428800
      and asset_bytes <= 104857600
      and (p_kind <> 'automatic' or (select count(*) from public.paper_history where project_id = p_project and kind = 'automatic') < 24);
    select id into victim from public.paper_history where project_id = p_project and kind = 'automatic' and id is distinct from p_keep order by id limit 1;
    if victim is null then
      if p_kind = 'automatic' and not p_force then return null; end if;
      raise exception 'History quota reached (50 MiB snapshot data / 100 MiB referenced figures). Delete an unneeded protected checkpoint first.' using errcode = '54000';
    end if;
    delete from public.paper_history where id = victim;
  end loop;
  insert into public.paper_history(project_id,kind,label,actor_id,actor_name,revision,main_file,files,size_bytes)
  values(p_project,p_kind,p_label,auth.uid(),coalesce((select name from public.profiles where id = auth.uid()),'System'),state.revision,state.main_file,payload,bytes) returning id into result;
  return result;
end $$;

-- Allow empty/support-only manifests; retain auth, revision, history and storage checks.
create or replace function public.paper_manifest_internal(p_project_id uuid, p_revision integer, p_entries jsonb, p_main_file text)
returns void language plpgsql security definer set search_path = '' as $$
declare item jsonb; other jsonb; old_files jsonb; entry_id uuid; entry_path text; entry_kind text;
  entry_content text; entry_storage text; entry_size integer; source_total bigint := 0; image_total bigint := 0;
  old_entry jsonb; seen_paths text[] := '{}'; seen_ids uuid[] := '{}'; normalized jsonb := '[]'; obj storage.objects; retained_shared jsonb := '[]';
begin
  perform public.require_paper_editor(p_project_id);
  if p_revision is distinct from (select revision from public.paper_workspaces where project_id = p_project_id) then
    raise exception 'The paper changed in another tab or session. Close this dialog, reload, and try again.' using errcode = '40001';
  end if;
  if jsonb_typeof(p_entries) is distinct from 'array' or jsonb_array_length(p_entries) not between 0 and 100 then
    raise exception 'A workspace must contain between 0 and 100 files and folders.' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(to_jsonb(f)),'[]') into old_files from public.paper_files f where project_id = p_project_id;
  for item in select value from jsonb_array_elements(p_entries) loop
    entry_path := item->>'path'; entry_kind := item->>'kind'; entry_content := coalesce(item->>'content','');
    entry_storage := null; entry_size := 0;
    if entry_path is null or length(entry_path) > 240 or entry_path !~ '^[A-Za-z0-9_-][A-Za-z0-9_.-]*(/[A-Za-z0-9_-][A-Za-z0-9_.-]*)*$'
      or entry_path ~ '(^|/)([.][.]?|[^/]*[.])(/|$)' or lower(entry_path) = any(seen_paths)
      or entry_kind is null or entry_kind not in ('text','folder','image') then
      raise exception 'Invalid or conflicting file path.' using errcode = '22023';
    end if;
    seen_paths := array_append(seen_paths,lower(entry_path));
    entry_id := nullif(item->>'id','')::uuid;
    old_entry := null;
    if entry_id is not null then
      select value into old_entry from jsonb_array_elements(old_files) where value->>'id' = entry_id::text;
      if old_entry is null then
        select e into old_entry from public.paper_history h cross join lateral jsonb_array_elements(h.files) e
        where h.project_id = p_project_id and e->>'id' = entry_id::text order by (e->>'version')::integer desc limit 1;
      end if;
      if old_entry is null or entry_id = any(seen_ids) then raise exception 'Invalid file identity.' using errcode = '22023'; end if;
    else entry_id := gen_random_uuid(); end if;
    seen_ids := array_append(seen_ids,entry_id);
    if entry_kind = 'text' then
      if entry_path !~ '\.(tex|bib|sty|cls|txt|bst|clo|cfg|def)$' or octet_length(entry_content) > 524288 then
        raise exception 'Invalid source type or source file larger than 512 KiB.' using errcode = '22023';
      end if;
      entry_size := octet_length(entry_content); source_total := source_total + entry_size;
    elsif entry_kind = 'image' then
      entry_content := ''; entry_storage := item->>'storage_path';
      if entry_path !~ '\.(png|jpg|jpeg)$' or split_part(entry_storage,'/',1) is distinct from p_project_id::text then
        raise exception 'Invalid figure path.' using errcode = '22023';
      end if;
      select * into obj from storage.objects where bucket_id = 'paper-figures' and name = entry_storage for key share;
      if not found or obj.metadata->>'mimetype' not in ('image/png','image/jpeg') then
        raise exception 'Upload the figure before applying changes.' using errcode = '22023';
      end if;
      entry_size := (obj.metadata->>'size')::integer;
      if entry_size is null or entry_size not between 1 and 5242880 then raise exception 'Figure exceeds 5 MiB.' using errcode = '22023'; end if;
      image_total := image_total + entry_size;
    else entry_content := ''; end if;
    normalized := normalized || jsonb_build_array(jsonb_build_object('id',entry_id,'path',entry_path,'kind',entry_kind,'content',entry_content,
      'storage_path',entry_storage,'size_bytes',entry_size,'version',coalesce((old_entry->>'version')::integer,0)+1));
  end loop;
  if source_total > 5242880 or image_total > 26214400 then raise exception 'Paper limits: 5 MiB source and 25 MiB figures.' using errcode = '22023'; end if;
  for item in select value from jsonb_array_elements(normalized) loop
    for other in select value from jsonb_array_elements(normalized) loop
      if other->>'kind' <> 'folder' and starts_with(lower(item->>'path'),lower(other->>'path') || '/') then
        raise exception 'A file conflicts with a folder path.' using errcode = '22023';
      end if;
    end loop;
  end loop;
  if p_main_file is null or (p_main_file = '' and exists(select 1 from jsonb_array_elements(normalized) e where e->>'kind' = 'text' and e->>'path' ~ '\.tex$')) or (p_main_file <> '' and not exists(select 1 from jsonb_array_elements(normalized) e where e->>'path' = p_main_file and e->>'kind' = 'text' and p_main_file ~ '\.tex$')) then
    raise exception 'Select an existing .tex file as the main file.' using errcode = '22023';
  end if;
  if current_setting('paper.shared_lifecycle',true) = p_project_id::text then
    select coalesce(jsonb_agg(to_jsonb(d)),'[]') into retained_shared
    from public.paper_shared_documents d join public.paper_files f on f.id=d.file_id
    join jsonb_array_elements(normalized) e on e->>'id'=f.id::text
    where f.project_id=p_project_id and e->>'kind'='text' and e->>'content'=f.content
      and coalesce(current_setting('paper.shared_restore',true),'') not in ('*',f.id::text);
  end if;
  delete from public.paper_files where project_id = p_project_id;
  insert into public.paper_files(id,project_id,path,kind,content,storage_path,size_bytes,version)
  select (e->>'id')::uuid,p_project_id,e->>'path',e->>'kind',e->>'content',e->>'storage_path',(e->>'size_bytes')::integer,(e->>'version')::integer
  from jsonb_array_elements(normalized) e;
  insert into public.paper_shared_documents(file_id,epoch,sequence,state,updated_at)
  select (e->>'file_id')::uuid,(e->>'epoch')::uuid,(e->>'sequence')::bigint,e->>'state',(e->>'updated_at')::timestamptz
  from jsonb_array_elements(retained_shared) e;
  update public.paper_workspaces set main_file = p_main_file, revision = revision + 1 where project_id = p_project_id;
  update public.projects set updated_at = now() where id = p_project_id;
end;
$$;
