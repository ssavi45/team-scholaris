alter table public.activity_events add column visibility text not null default 'project' check (visibility in ('project','owner'));
alter table public.activity_events add column dedupe_key text;
create unique index activity_event_dedupe on public.activity_events(project_id,dedupe_key) where dedupe_key is not null;
create index activity_event_actor_time on public.activity_events(project_id,actor_id,created_at desc,id desc);
create index activity_event_type_time on public.activity_events(project_id,entity_type,created_at desc,id desc);
drop policy activity_read on public.activity_events;
create policy activity_read on public.activity_events for select to authenticated using (
  public.can_access_project(project_id) and (visibility = 'project' or exists (
    select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()
  ))
);

create function public.record_project_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r jsonb; before_row jsonb; target uuid; entity uuid; kind text; event text;
  details jsonb := '{}'::jsonb; audience text := 'project'; dedupe text;
begin
  if TG_OP = 'DELETE' then r := to_jsonb(old); else r := to_jsonb(new); end if;
  if TG_OP = 'UPDATE' then before_row := to_jsonb(old); end if;
  target := coalesce((r->>'project_id')::uuid,(r->>'id')::uuid);
  -- Physical parent deletion cascades history too; never recreate child events.
  if not exists (select 1 from public.projects p where p.id = target) then return null; end if;
  entity := (r->>'id')::uuid;
  case TG_TABLE_NAME
    when 'projects' then
      kind := 'project';
      if TG_OP = 'INSERT' then event := 'project.created';
      elsif before_row->>'deleted_at' is null and r->>'deleted_at' is not null then event := 'project.deleted';
      elsif before_row->>'deleted_at' is not null and r->>'deleted_at' is null then event := 'project.restored';
      elsif r->>'owner_id' is distinct from before_row->>'owner_id' then event := 'project.ownership_transferred';
      elsif r->>'status' is distinct from before_row->>'status' then event := case when r->>'status' = 'archived' then 'project.archived' else 'project.unarchived' end;
      elsif r->>'name' is distinct from before_row->>'name' or r->>'description' is distinct from before_row->>'description' then event := 'project.updated';
      else return null; end if;
      details := jsonb_build_object('title',r->>'name');
    when 'project_members' then
      kind := 'team'; entity := (r->>'user_id')::uuid;
      if TG_OP = 'INSERT' then event := 'team.joined';
      elsif TG_OP = 'DELETE' then event := case when entity = auth.uid() then 'team.left' else 'team.removed' end;
      elsif r->>'access_level' is distinct from before_row->>'access_level' then event := 'team.access_changed';
      elsif r->>'display_role' is distinct from before_row->>'display_role' then event := 'team.role_changed';
      else return null; end if;
      details := jsonb_build_object('title',(select p.name from public.profiles p where p.id = entity),'access',r->>'access_level');
    when 'project_invitations' then
      kind := 'invitation'; audience := 'owner';
      if TG_OP = 'INSERT' then event := 'invitation.created';
      elsif before_row->>'accepted_at' is null and r->>'accepted_at' is not null then event := 'invitation.accepted';
      elsif before_row->>'revoked_at' is null and r->>'revoked_at' is not null then event := 'invitation.revoked';
      else return null; end if;
      -- Never store email addresses, raw tokens, or token hashes in history.
    when 'project_files' then
      kind := 'files';
      if TG_OP = 'INSERT' then event := 'file.added';
      elsif TG_OP = 'DELETE' then event := 'file.deleted';
      elsif r->>'name' is distinct from before_row->>'name' then event := 'file.renamed';
      else return null; end if;
      details := jsonb_build_object('title',r->>'name');
    when 'project_messages' then
      kind := 'chat';
      event := case when TG_OP = 'INSERT' then 'chat.posted' else 'chat.deleted' end;
      details := jsonb_build_object('channel',r->>'channel');
    when 'paper_workspaces' then
      kind := 'paper'; entity := target;
      if TG_OP = 'INSERT' then event := 'paper.initialized';
      elsif r->>'revision' is distinct from before_row->>'revision' or r->>'main_file' is distinct from before_row->>'main_file' then event := 'paper.updated';
      else return null; end if;
      -- A manifest replaces rows and bumps revision repeatedly. Log one truthful
      -- workspace event for the transaction, including ordinary explicit saves.
      dedupe := 'paper:' || txid_current()::text;
    else return null;
  end case;
  insert into public.activity_events(project_id,actor_id,event_type,entity_type,entity_id,metadata,visibility,dedupe_key)
    values(target,auth.uid(),event,kind,entity,details,audience,dedupe)
    on conflict (project_id,dedupe_key) where dedupe_key is not null do nothing;
  return null;
end;
$$;
revoke all on function public.record_project_activity() from public, anon, authenticated;
create trigger project_activity after insert or update on public.projects for each row execute function public.record_project_activity();
create trigger team_activity after insert or update or delete on public.project_members for each row execute function public.record_project_activity();
create trigger invitation_activity after insert or update on public.project_invitations for each row execute function public.record_project_activity();
create trigger files_activity after insert or update or delete on public.project_files for each row execute function public.record_project_activity();
create trigger chat_activity after insert or delete on public.project_messages for each row execute function public.record_project_activity();
create trigger paper_activity after insert or update on public.paper_workspaces for each row execute function public.record_project_activity();

create function public.get_project_activity(
  p_project_id uuid, p_limit integer default 31, p_category text default null,
  p_actor_id uuid default null, p_from timestamptz default null, p_to timestamptz default null,
  p_before_at timestamptz default null, p_before_id uuid default null
) returns table(id uuid, actor_id uuid, actor_name text, event_type text, category text,
  entity_id uuid, metadata jsonb, created_at timestamptz, target_exists boolean, owner_only boolean)
language plpgsql stable security definer set search_path = '' as $$
declare is_owner boolean;
begin
  if not public.can_access_project(p_project_id) then raise exception 'Project unavailable' using errcode = '42501'; end if;
  select p.owner_id = auth.uid() into is_owner from public.projects p where p.id = p_project_id;
  if p_category is not null and p_category not in ('project','team','files','paper','chat','tasks') then raise exception 'Invalid activity category' using errcode = '22023'; end if;
  if (p_before_at is null) <> (p_before_id is null) or (p_from is not null and p_to is not null and p_from >= p_to) then raise exception 'Invalid activity range' using errcode = '22023'; end if;
  return query
    select e.id,e.actor_id,coalesce(nullif(btrim(a.name),''),case when e.actor_id is null then 'System' else 'Former teammate' end),
      e.event_type,case when e.entity_type = 'task' then 'tasks' when e.entity_type = 'invitation' then 'team' else e.entity_type end,
      e.entity_id,e.metadata,e.created_at,
      case e.entity_type
        when 'task' then exists(select 1 from public.project_tasks t where t.id = e.entity_id and t.project_id = p_project_id and t.deleted_at is null)
        when 'files' then exists(select 1 from public.project_files f where f.id = e.entity_id and f.project_id = p_project_id)
        when 'chat' then exists(select 1 from public.project_messages m where m.id = e.entity_id and m.project_id = p_project_id)
        when 'team' then exists(select 1 from public.project_members m where m.user_id = e.entity_id and m.project_id = p_project_id)
        when 'invitation' then exists(select 1 from public.project_invitations i where i.id = e.entity_id and i.project_id = p_project_id)
        when 'paper' then exists(select 1 from public.paper_workspaces w where w.project_id = p_project_id)
        when 'project' then true else false end,
      e.visibility = 'owner'
    from (
      select ev.* from public.activity_events ev
      where ev.project_id = p_project_id and (ev.visibility = 'project' or is_owner)
        and (p_category is null or (case when ev.entity_type = 'task' then 'tasks' when ev.entity_type = 'invitation' then 'team' else ev.entity_type end) = p_category)
        and (p_actor_id is null or ev.actor_id = p_actor_id)
        and (p_from is null or ev.created_at >= p_from) and (p_to is null or ev.created_at < p_to)
        and (p_before_at is null or (ev.created_at,ev.id) < (p_before_at,p_before_id))
      order by ev.created_at desc,ev.id desc limit greatest(1,least(coalesce(p_limit,31),101))
    ) e left join public.profiles a on a.id = e.actor_id
    order by e.created_at desc,e.id desc;
end;
$$;
revoke all on function public.get_project_activity(uuid,integer,text,uuid,timestamptz,timestamptz,timestamptz,uuid) from public, anon;
grant execute on function public.get_project_activity(uuid,integer,text,uuid,timestamptz,timestamptz,timestamptz,uuid) to authenticated;

create function public.get_project_activity_actors(p_project_id uuid)
returns table(user_id uuid,name text)
language plpgsql stable security definer set search_path = '' as $$
declare is_owner boolean;
begin
  if not public.can_access_project(p_project_id) then raise exception 'Project unavailable' using errcode = '42501'; end if;
  select p.owner_id = auth.uid() into is_owner from public.projects p where p.id = p_project_id;
  return query select a.id,coalesce(nullif(btrim(a.name),''),'Former teammate')
    from public.profiles a where exists(select 1 from public.activity_events e where e.project_id = p_project_id and e.actor_id = a.id and (e.visibility = 'project' or is_owner))
    order by 2,a.id;
end;
$$;
revoke all on function public.get_project_activity_actors(uuid) from public, anon;
grant execute on function public.get_project_activity_actors(uuid) to authenticated;
