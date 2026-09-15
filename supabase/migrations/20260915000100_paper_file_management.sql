alter table public.paper_workspaces add column revision integer not null default 1;
alter table public.paper_workspaces add column main_file text not null default 'main.tex';
alter table public.paper_files add column kind text not null default 'text' check (kind in ('text','folder','image'));
alter table public.paper_files add column storage_path text;
alter table public.paper_files add column size_bytes integer not null default 0;
alter table public.paper_files add constraint paper_file_payload check (
  (kind = 'text' and storage_path is null) or
  (kind = 'folder' and storage_path is null and content = '' and size_bytes = 0) or
  (kind = 'image' and storage_path is not null and content = '' and size_bytes between 1 and 5242880)
);
create unique index paper_paths_case_insensitive on public.paper_files(project_id, lower(path));

create function public.bump_paper_revision() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if TG_OP = 'DELETE' then
    update public.paper_workspaces set revision = revision + 1 where project_id = OLD.project_id;
    return OLD;
  else
    update public.paper_workspaces set revision = revision + 1 where project_id = NEW.project_id;
    return NEW;
  end if;
end;
$$;
revoke all on function public.bump_paper_revision() from public, anon, authenticated;
create trigger paper_revision after insert or update or delete on public.paper_files for each row execute function public.bump_paper_revision();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('paper-figures','paper-figures',false,5242880,array['image/png','image/jpeg'])
on conflict(id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create function public.paper_storage_allowed(p_name text, p_write boolean) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.projects p join public.project_members m on m.project_id = p.id
    join auth.users u on u.id = m.user_id
    where p.id::text = split_part(p_name,'/',1) and p.deleted_at is null and m.user_id = auth.uid()
    and u.email_confirmed_at is not null
    and (case when p_write then p.status = 'active' and m.access_level in ('owner','member')
      else exists(select 1 from public.paper_files f where f.project_id = p.id and f.storage_path = p_name)
        or (p.status = 'active' and m.access_level in ('owner','member')) end)
  );
$$;
revoke all on function public.paper_storage_allowed(text,boolean) from public, anon;
grant execute on function public.paper_storage_allowed(text,boolean) to authenticated;
create policy paper_figure_read on storage.objects for select to authenticated using (bucket_id = 'paper-figures' and public.paper_storage_allowed(name,false));
create policy paper_figure_upload on storage.objects for insert to authenticated with check (
  bucket_id = 'paper-figures' and name ~ '^[a-f0-9-]{36}/[a-f0-9-]{36}\.(png|jpg|jpeg)$' and public.paper_storage_allowed(name,true)
);
create policy paper_figure_cleanup on storage.objects for delete to authenticated using (
  bucket_id = 'paper-figures' and public.paper_storage_allowed(name,true)
  and not exists(select 1 from public.paper_files f where f.storage_path = name)
);

create function public.apply_paper_manifest(p_project_id uuid, p_revision integer, p_entries jsonb, p_main_file text)
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
revoke all on function public.apply_paper_manifest(uuid,integer,jsonb,text) from public, anon;
grant execute on function public.apply_paper_manifest(uuid,integer,jsonb,text) to authenticated;

-- Prevent the original text-save RPC from treating folders or figures as source.
create function public.guard_paper_content() returns trigger language plpgsql set search_path = '' as $$
begin
  if NEW.kind <> 'text' and NEW.content <> '' then raise exception 'Only text source can be edited.' using errcode = '22023'; end if;
  return NEW;
end;
$$;
revoke all on function public.guard_paper_content() from public, anon, authenticated;
create trigger paper_content_guard before update on public.paper_files for each row execute function public.guard_paper_content();
