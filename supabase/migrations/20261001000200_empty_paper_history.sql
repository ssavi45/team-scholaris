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
