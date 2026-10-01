-- PAPER-13 slice A. Gateway-only pilot; no project is enrolled by this migration.
create table public.paper_shared_documents (
  file_id uuid primary key references public.paper_files(id) on delete cascade,
  epoch uuid not null default gen_random_uuid(),
  sequence bigint not null default 0,
  state text not null check (octet_length(state) <= 2796204),
  updated_at timestamptz not null default now()
);
alter table public.paper_shared_documents enable row level security;
revoke all on public.paper_shared_documents from public, anon, authenticated, service_role;

-- Fence every old mutation path, including private manifest/history implementations.
create function public.guard_shared_paper_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists(select 1 from public.paper_shared_documents where file_id = OLD.id)
    and current_setting('paper.shared_write', true) is distinct from OLD.id::text then
    raise exception 'This file uses shared editing. Reload in a supported editor; keep your local draft.' using errcode = 'PT409';
  end if;
  if TG_OP = 'DELETE' then return OLD; end if;
  return NEW;
end $$;
revoke all on function public.guard_shared_paper_write() from public, anon, authenticated;
create trigger shared_paper_write before update or delete on public.paper_files
for each row execute function public.guard_shared_paper_write();

-- Only a trusted gateway may submit validated CRDT state. Identity is resolved
-- with Auth.getUser(access_token) by that gateway, never accepted from a client.
create function public.paper_shared_session(p_actor uuid, p_file uuid, p_action text,
  p_epoch uuid default null, p_sequence bigint default null, p_state text default null,
  p_content text default null, p_version integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare f public.paper_files; d public.paper_shared_documents; project uuid; role text; active boolean;
begin
  select project_id into project from public.paper_files where id = p_file;
  perform 1 from public.projects where id = project for update;
  select m.access_level, p.status = 'active' into role, active
    from public.project_members m join public.projects p on p.id = m.project_id
    join auth.users u on u.id = m.user_id
    where p.id = project and p.deleted_at is null and m.user_id = p_actor and u.email_confirmed_at is not null;
  if role is null then raise exception 'Paper unavailable.' using errcode = '42501'; end if;
  if p_action not in ('read','enable','commit','disable') then raise exception 'Invalid operation.' using errcode = '22023'; end if;
  if p_action <> 'read' and (not active or role not in ('owner','member')) then
    raise exception 'This paper is read-only.' using errcode = '42501';
  end if;
  if p_action in ('enable','disable') and role <> 'owner' then
    raise exception 'Owner required for pilot enrollment.' using errcode = '42501';
  end if;
  select * into f from public.paper_files where id = p_file for update;
  if f.kind <> 'text' then raise exception 'Only source text supports shared sessions.' using errcode = '22023'; end if;
  select * into d from public.paper_shared_documents where file_id = p_file for update;
  -- History attribution uses the verified actor, not the privileged gateway.
  perform set_config('request.jwt.claim.sub', p_actor::text, true);
  if p_action = 'enable' then
    if d.file_id is not null then raise exception 'Session already enabled.' using errcode = 'PT409'; end if;
    if p_version is distinct from f.version or p_content is distinct from f.content then
      raise exception 'Source changed during enrollment.' using errcode = 'PT409';
    end if;
    if p_state is null or p_state = '' then raise exception 'State required.' using errcode = '22023'; end if;
    perform public.paper_history_capture(project,'safety','Before shared editing',true);
    insert into public.paper_shared_documents(file_id,state) values(p_file,p_state) returning * into d;
  elsif p_action in ('commit','disable') then
    if d.file_id is null or d.epoch is distinct from p_epoch or d.sequence is distinct from p_sequence then
      raise exception 'Shared session changed; fetch current state before retrying.' using errcode = 'PT409';
    end if;
    if p_action = 'disable' then
      perform public.paper_history_capture(project,'safety','Before leaving shared editing',true);
      delete from public.paper_shared_documents where file_id = p_file;
      return jsonb_build_object('disabled',true,'file',to_jsonb(f));
    end if;
    if p_state is null or p_state = '' or p_content is null or octet_length(p_content) > 524288 then
      raise exception 'Invalid shared document.' using errcode = '22023';
    end if;
    if p_state is distinct from d.state then
      perform set_config('paper.shared_write',p_file::text,true);
      -- Existing source quotas, version clock and revision trigger still apply.
      perform public.paper_save_file_internal(p_file,p_content,f.version);
      perform set_config('paper.shared_write','',true);
      update public.paper_shared_documents set state=p_state, sequence=sequence+1, updated_at=now()
        where file_id=p_file returning * into d;
      perform public.paper_history_capture(project,'automatic','Shared editing');
      select * into f from public.paper_files where id=p_file;
    end if;
  end if;
  return jsonb_build_object('file',to_jsonb(f),'session',case when d.file_id is null then null else to_jsonb(d) end,
    'editable',active and role in ('owner','member'));
end $$;
revoke all on function public.paper_shared_session(uuid,uuid,text,uuid,bigint,text,text,integer) from public, anon, authenticated;
grant execute on function public.paper_shared_session(uuid,uuid,text,uuid,bigint,text,text,integer) to service_role;
