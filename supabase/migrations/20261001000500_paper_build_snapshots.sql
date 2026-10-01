-- A short project lock captures one materialized revision without stopping a session.
-- Temporary asset leases bridge the DB/Storage read; manuscript copies stay in memory.
create table public.paper_snapshot_leases (
  id uuid primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_paths text[] not null check (cardinality(storage_paths) <= 100),
  expires_at timestamptz not null
);
create index paper_snapshot_leases_project on public.paper_snapshot_leases(project_id, expires_at);
alter table public.paper_snapshot_leases enable row level security;
revoke all on public.paper_snapshot_leases from public, anon, authenticated;

create function public.capture_paper_snapshot(p_project uuid, p_file uuid default null,
  p_epoch uuid default null, p_sequence bigint default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare snapshot_id uuid := gen_random_uuid(); files jsonb; clocks jsonb; assets text[];
  workspace public.paper_workspaces; project public.projects; expiry timestamptz := clock_timestamp() + interval '5 minutes';
begin
  select * into project from public.projects where id = p_project for update;
  if project.id is null or project.deleted_at is not null or not exists (
    select 1 from public.project_members m join auth.users u on u.id = m.user_id
    where m.project_id = p_project and m.user_id = auth.uid() and u.email_confirmed_at is not null
  ) then raise exception 'Paper unavailable.' using errcode = '42501'; end if;
  if (p_file is not null or p_epoch is not null or p_sequence is not null) and not exists (
    select 1 from public.paper_shared_documents d join public.paper_files f on f.id = d.file_id
    where f.project_id = p_project and d.file_id = p_file and d.epoch = p_epoch and d.sequence >= p_sequence and p_sequence >= 0
  ) then raise exception 'Shared session changed. Reconnect before capturing this paper.' using errcode = 'PT409'; end if;
  select * into workspace from public.paper_workspaces where project_id = p_project;
  if workspace.project_id is null then raise exception 'Initialize this paper first.' using errcode = '22023'; end if;
  select coalesce(jsonb_agg(to_jsonb(f) || jsonb_build_object('shared_epoch', d.epoch) order by f.path), '[]'::jsonb),
    coalesce(array_agg(f.storage_path) filter (where f.storage_path is not null), '{}'::text[])
    into files, assets from public.paper_files f left join public.paper_shared_documents d on d.file_id = f.id where f.project_id = p_project;
  select coalesce(jsonb_agg(jsonb_build_object('fileId', d.file_id, 'epoch', d.epoch, 'sequence', d.sequence)), '[]'::jsonb)
    into clocks from public.paper_shared_documents d join public.paper_files f on f.id = d.file_id where f.project_id = p_project;
  delete from public.paper_snapshot_leases where project_id = p_project and expires_at <= clock_timestamp();
  if cardinality(assets) > 0 then
    if (select count(*) from public.paper_snapshot_leases where project_id = p_project and user_id = auth.uid()) >= 60 then
      raise exception 'Too many snapshots preparing. Wait a moment, then retry.' using errcode = '54000';
    end if;
    insert into public.paper_snapshot_leases values(snapshot_id, p_project, auth.uid(), assets, expiry);
  end if;
  return jsonb_build_object('id', snapshot_id, 'title', project.name, 'files', files, 'shared', clocks,
    'main', workspace.main_file, 'revision', workspace.revision, 'expiresAt', expiry);
end $$;
revoke all on function public.capture_paper_snapshot(uuid,uuid,uuid,bigint) from public,anon;
grant execute on function public.capture_paper_snapshot(uuid,uuid,uuid,bigint) to authenticated;

create function public.release_paper_snapshot(p_snapshot uuid) returns void
language sql security definer set search_path = '' as $$
  delete from public.paper_snapshot_leases where id = p_snapshot and user_id = auth.uid();
$$;
revoke all on function public.release_paper_snapshot(uuid) from public,anon;
grant execute on function public.release_paper_snapshot(uuid) to authenticated;

-- Reuse the existing read/delete policies and deletion trigger. A lease grants no
-- access: the storage policy still requires current verified project membership.
create or replace function public.paper_figure_referenced(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.paper_files where storage_path = p_name)
  or exists(select 1 from public.paper_history h cross join lateral jsonb_array_elements(h.files) e
    where h.project_id::text = split_part(p_name,'/',1) and e->>'storage_path' = p_name)
  or exists(select 1 from public.paper_snapshot_leases l where l.project_id::text = split_part(p_name,'/',1)
    and l.expires_at > now() and p_name = any(l.storage_paths));
$$;
