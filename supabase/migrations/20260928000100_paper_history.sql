-- PAPER-06. Snapshots are authored inside trusted, project-serialized operations.
create table public.paper_history (
  id bigint generated always as identity primary key,
  project_id uuid not null references public.paper_workspaces(project_id) on delete cascade,
  kind text not null check (kind in ('automatic','named','safety')),
  label text not null default '' check (length(label) <= 120),
  actor_id uuid references auth.users(id) on delete set null,
  actor_name text not null,
  created_at timestamptz not null default clock_timestamp(),
  revision integer not null,
  main_file text not null,
  files jsonb not null check (jsonb_typeof(files) = 'array'),
  size_bytes bigint not null
);
create index paper_history_project_page on public.paper_history(project_id,id desc);
alter table public.paper_history enable row level security;
revoke all on public.paper_history from public, anon, authenticated;
-- Bodies are only returned by the authorized detail RPC, never in the list.

create function public.paper_history_capture(p_project uuid, p_kind text, p_label text, p_force boolean default false, p_keep bigint default null)
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
  if jsonb_array_length(payload) = 0 then return null; end if;
  bytes := octet_length(payload::text);
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
revoke all on function public.paper_history_capture(uuid,text,text,boolean,bigint) from public, anon, authenticated;

-- Preserve existing validators, quotas and authorization inside private implementations.
alter function public.initialize_paper(uuid) rename to paper_initialize_internal;
alter function public.create_paper_file(uuid,text) rename to paper_create_file_internal;
alter function public.save_paper_file(uuid,text,integer) rename to paper_save_file_internal;
alter function public.apply_paper_manifest(uuid,integer,jsonb,text) rename to paper_manifest_internal;
revoke all on function public.paper_initialize_internal(uuid), public.paper_create_file_internal(uuid,text), public.paper_save_file_internal(uuid,text,integer), public.paper_manifest_internal(uuid,integer,jsonb,text) from public, anon, authenticated;

create function public.initialize_paper(p_project_id uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.paper_initialize_internal(p_project_id);
  perform public.paper_history_capture(p_project_id,'automatic','Initial paper',true);
end $$;
create function public.create_paper_file(p_project_id uuid,p_path text) returns setof public.paper_files language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_paper_editor(p_project_id);
  perform public.paper_history_capture(p_project_id,'automatic','Before file creation',true);
  return query select * from public.paper_create_file_internal(p_project_id,p_path);
  perform public.paper_history_capture(p_project_id,'automatic','File created',true);
end $$;
create function public.save_paper_file(p_file_id uuid,p_content text,p_expected_version integer) returns setof public.paper_files language plpgsql security definer set search_path = '' as $$
declare project uuid;
begin
  select project_id into project from public.paper_files where id = p_file_id;
  perform public.require_paper_editor(project);
  -- Establish a baseline for workspaces predating this migration.
  if not exists(select 1 from public.paper_history where project_id = project) then perform public.paper_history_capture(project,'automatic','History baseline',true); end if;
  return query select * from public.paper_save_file_internal(p_file_id,p_content,p_expected_version);
  perform public.paper_history_capture(project,'automatic','Automatic save');
end $$;
create function public.apply_paper_manifest(p_project_id uuid,p_revision integer,p_entries jsonb,p_main_file text) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_paper_editor(p_project_id);
  perform public.paper_history_capture(p_project_id,'automatic','Before file changes',true);
  perform public.paper_manifest_internal(p_project_id,p_revision,p_entries,p_main_file);
  perform public.paper_history_capture(p_project_id,'automatic','File changes',true);
end $$;
revoke all on function public.initialize_paper(uuid), public.create_paper_file(uuid,text), public.save_paper_file(uuid,text,integer), public.apply_paper_manifest(uuid,integer,jsonb,text) from public, anon;
grant execute on function public.initialize_paper(uuid), public.create_paper_file(uuid,text), public.save_paper_file(uuid,text,integer), public.apply_paper_manifest(uuid,integer,jsonb,text) to authenticated;

create or replace function public.paper_manifest_internal(p_project_id uuid, p_revision integer, p_entries jsonb, p_main_file text)
returns void language plpgsql security definer set search_path = '' as $$
declare item jsonb; other jsonb; old_files jsonb; entry_id uuid; entry_path text; entry_kind text;
  entry_content text; entry_storage text; entry_size integer; source_total bigint := 0; image_total bigint := 0;
  old_entry jsonb; seen_paths text[] := '{}'; seen_ids uuid[] := '{}'; normalized jsonb := '[]'; obj storage.objects;
begin
  perform public.require_paper_editor(p_project_id);
  if p_revision is distinct from (select revision from public.paper_workspaces where project_id = p_project_id) then
    raise exception 'The paper changed in another tab or session. Close this dialog, reload, and try again.' using errcode = '40001';
  end if;
  if jsonb_typeof(p_entries) is distinct from 'array' or jsonb_array_length(p_entries) not between 1 and 100 then
    raise exception 'A workspace must contain between 1 and 100 files and folders.' using errcode = '22023';
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
  if p_main_file is null or not exists(select 1 from jsonb_array_elements(normalized) e where e->>'path' = p_main_file and e->>'kind' = 'text' and p_main_file ~ '\.tex$') then
    raise exception 'Select an existing .tex file as the main file.' using errcode = '22023';
  end if;
  delete from public.paper_files where project_id = p_project_id;
  insert into public.paper_files(id,project_id,path,kind,content,storage_path,size_bytes,version)
  select (e->>'id')::uuid,p_project_id,e->>'path',e->>'kind',e->>'content',e->>'storage_path',(e->>'size_bytes')::integer,(e->>'version')::integer
  from jsonb_array_elements(normalized) e;
  update public.paper_workspaces set main_file = p_main_file, revision = revision + 1 where project_id = p_project_id;
  update public.projects set updated_at = now() where id = p_project_id;
end;
$$;

-- A removed/restored identity must never reuse a version held by a stale client,
-- even after the snapshot containing its newest version has been pruned.
create table public.paper_file_version_clock (
  project_id uuid not null references public.paper_workspaces(project_id) on delete cascade,
  file_id uuid primary key, version integer not null
);
alter table public.paper_file_version_clock enable row level security;
revoke all on public.paper_file_version_clock from public, anon, authenticated;
insert into public.paper_file_version_clock select project_id,id,version from public.paper_files;
create function public.paper_version_clock() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.paper_file_version_clock(project_id,file_id,version) values(new.project_id,new.id,new.version)
  on conflict(file_id) do update set version = greatest(public.paper_file_version_clock.version + 1,excluded.version)
  returning version into new.version;
  return new;
end $$;
revoke all on function public.paper_version_clock() from public,anon,authenticated;
create trigger paper_version_clock before insert or update on public.paper_files for each row execute function public.paper_version_clock();

create function public.list_paper_history(p_project_id uuid,p_before bigint default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.can_access_project(p_project_id) then raise exception 'Paper history is unavailable.' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(to_jsonb(rows) order by id desc) from (
    select id,kind,label,actor_name,created_at,revision,main_file,size_bytes,jsonb_array_length(files) as file_count
    from public.paper_history where project_id = p_project_id and (p_before is null or id < p_before)
    order by id desc limit 21
  ) rows),'[]');
end $$;
create function public.get_paper_history(p_project_id uuid,p_history_id bigint) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not public.can_access_project(p_project_id) then raise exception 'Paper history is unavailable.' using errcode = '42501'; end if;
  select to_jsonb(h) into result from public.paper_history h where project_id = p_project_id and id = p_history_id;
  if result is null then raise exception 'This snapshot was removed or expired. Refresh history.' using errcode = '22023'; end if;
  return result;
end $$;
create function public.create_paper_checkpoint(p_project_id uuid,p_revision integer,p_label text) returns bigint
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_paper_editor(p_project_id);
  if p_label is null or length(btrim(p_label)) not between 1 and 120 then raise exception 'Enter a checkpoint name (1-120 characters).' using errcode = '22023'; end if;
  if p_revision is distinct from (select revision from public.paper_workspaces where project_id = p_project_id) then raise exception 'Paper changed. Refresh before creating the checkpoint.' using errcode = '40001'; end if;
  return public.paper_history_capture(p_project_id,'named',btrim(p_label),true);
end $$;
create function public.delete_paper_checkpoint(p_project_id uuid,p_history_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_paper_editor(p_project_id);
  delete from public.paper_history where project_id = p_project_id and id = p_history_id;
end $$;
create function public.restore_paper_history(p_project_id uuid,p_history_id bigint,p_revision integer,p_file_id uuid default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare snapshot public.paper_history; entries jsonb; old_file jsonb; current_file public.paper_files; main text; checkpoint bigint; result integer;
begin
  perform public.require_paper_editor(p_project_id);
  if p_revision is distinct from (select revision from public.paper_workspaces where project_id = p_project_id) then raise exception 'Paper changed since preview. Refresh and compare again before restoring.' using errcode = '40001'; end if;
  select * into snapshot from public.paper_history where project_id = p_project_id and id = p_history_id;
  if not found then raise exception 'Snapshot no longer available.' using errcode = '22023'; end if;
  if p_file_id is null then entries := snapshot.files; main := snapshot.main_file;
  else
    select e into old_file from jsonb_array_elements(snapshot.files) e where e->>'id' = p_file_id::text and e->>'kind' <> 'folder';
    if old_file is null then raise exception 'Choose a source file or figure from the snapshot.' using errcode = '22023'; end if;
    select * into current_file from public.paper_files where project_id = p_project_id and id = p_file_id;
    select main_file into main from public.paper_workspaces where project_id = p_project_id;
    if current_file.path = main then main := old_file->>'path'; end if;
    select coalesce(jsonb_agg(to_jsonb(f)),'[]') into entries from public.paper_files f where project_id = p_project_id and id <> p_file_id;
    entries := entries || jsonb_build_array(old_file);
  end if;
  checkpoint := public.paper_history_capture(p_project_id,'safety','Before restore #' || p_history_id,true,p_history_id);
  if checkpoint is null then raise exception 'Unable to preserve the current paper before restore.'; end if;
  perform public.paper_manifest_internal(p_project_id,p_revision,entries,main);
  perform public.paper_history_capture(p_project_id,'automatic','Restored from #' || p_history_id,true,checkpoint);
  select revision into result from public.paper_workspaces where project_id = p_project_id;
  return result;
end $$;
revoke all on function public.list_paper_history(uuid,bigint), public.get_paper_history(uuid,bigint), public.create_paper_checkpoint(uuid,integer,text), public.delete_paper_checkpoint(uuid,bigint), public.restore_paper_history(uuid,bigint,integer,uuid) from public,anon;
grant execute on function public.list_paper_history(uuid,bigint), public.get_paper_history(uuid,bigint), public.create_paper_checkpoint(uuid,integer,text), public.delete_paper_checkpoint(uuid,bigint), public.restore_paper_history(uuid,bigint,integer,uuid) to authenticated;

-- History keeps private, immutable figures alive as long as a snapshot needs them.
create function public.paper_figure_referenced(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.paper_files where storage_path = p_name)
  or exists(select 1 from public.paper_history h cross join lateral jsonb_array_elements(h.files) e where h.project_id::text = split_part(p_name,'/',1) and e->>'storage_path' = p_name);
$$;
revoke all on function public.paper_figure_referenced(text) from public,anon;
grant execute on function public.paper_figure_referenced(text) to authenticated;
create or replace function public.paper_storage_allowed(p_name text,p_write boolean) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.projects p join public.project_members m on m.project_id = p.id join auth.users u on u.id = m.user_id
    where p.id::text = split_part(p_name,'/',1) and p.deleted_at is null and m.user_id = auth.uid() and u.email_confirmed_at is not null
    and (case when p_write then p.status = 'active' and m.access_level in ('owner','member')
      else public.paper_figure_referenced(p_name) or (p.status = 'active' and m.access_level in ('owner','member')) end));
$$;
drop policy paper_figure_cleanup on storage.objects;
create policy paper_figure_cleanup on storage.objects for delete to authenticated using (
  bucket_id = 'paper-figures' and public.paper_storage_allowed(name,true) and not public.paper_figure_referenced(name)
);
create function public.guard_history_figure_delete() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.bucket_id = 'paper-figures' then
    perform 1 from public.projects where id::text = split_part(old.name,'/',1) for update;
    if public.paper_figure_referenced(old.name) then raise exception 'This figure is retained by paper history.' using errcode = '42501'; end if;
  end if;
  return old;
end $$;
revoke all on function public.guard_history_figure_delete() from public,anon,authenticated;
create trigger paper_history_figure_guard before delete on storage.objects for each row execute function public.guard_history_figure_delete();

-- Clean up only objects no longer referenced by either live files or history.
create function public.paper_unused_figures(p_project_id uuid) returns table(path text)
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_paper_editor(p_project_id);
  return query select name from storage.objects where bucket_id = 'paper-figures'
    and split_part(name,'/',1) = p_project_id::text and created_at < now() - interval '1 hour'
    and not public.paper_figure_referenced(name) limit 100;
end $$;
revoke all on function public.paper_unused_figures(uuid) from public,anon;
grant execute on function public.paper_unused_figures(uuid) to authenticated;

-- History begins with the current committed state, never fabricated past versions.
do $$ declare project uuid; begin
  for project in select project_id from public.paper_workspaces loop
    perform 1 from public.projects where id = project for update;
    perform public.paper_history_capture(project,'automatic','History enabled',true);
  end loop;
end $$;
