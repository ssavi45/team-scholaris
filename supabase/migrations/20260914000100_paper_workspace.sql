-- Text-source workspace. All mutations go through versioned, authorized RPCs.
create table public.paper_workspaces (
  project_id uuid primary key references public.projects(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table public.paper_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.paper_workspaces(project_id) on delete cascade,
  path text not null check (length(path) between 1 and 240),
  content text not null default '' check (octet_length(content) <= 524288),
  version integer not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  unique(project_id, path)
);
alter table public.paper_workspaces enable row level security;
alter table public.paper_files enable row level security;
revoke all on public.paper_workspaces, public.paper_files from anon, authenticated;
grant select on public.paper_workspaces, public.paper_files to authenticated;
create policy paper_workspace_read on public.paper_workspaces for select to authenticated using (public.can_access_project(project_id));
create policy paper_file_read on public.paper_files for select to authenticated using (public.can_access_project(project_id));

create function public.require_paper_editor(p_project_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  -- Serialize mutations with archive/membership/project operations.
  perform 1 from public.projects where id = p_project_id for update;
  if not exists (
    select 1 from public.projects p join public.project_members m on m.project_id = p.id
    join auth.users u on u.id = m.user_id
    where p.id = p_project_id and p.deleted_at is null and p.status = 'active'
      and m.user_id = auth.uid() and m.access_level in ('owner','member') and u.email_confirmed_at is not null
  ) then raise exception 'This paper is read-only or unavailable.' using errcode = '42501'; end if;
end;
$$;
revoke all on function public.require_paper_editor(uuid) from public, anon, authenticated;

create function public.initialize_paper(p_project_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_paper_editor(p_project_id);
  insert into public.paper_workspaces(project_id) values(p_project_id) on conflict do nothing;
  if found then
    insert into public.paper_files(project_id,path,content) values
      (p_project_id,'main.tex', E'\\documentclass{article}\n\\title{Untitled paper}\n\\author{}\n\\date{\\today}\n\n\\begin{document}\n\\maketitle\n\n\\section{Introduction}\nStart writing here.\n\n\\bibliographystyle{plain}\n\\bibliography{references}\n\\end{document}\n'),
      (p_project_id,'references.bib','');
  end if;
end;
$$;

create function public.create_paper_file(p_project_id uuid, p_path text) returns setof public.paper_files
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_paper_editor(p_project_id);
  if p_path is null or length(p_path) > 240 or p_path !~ '^[A-Za-z0-9_-][A-Za-z0-9_.-]*(/[A-Za-z0-9_-][A-Za-z0-9_.-]*)*\.(tex|bib|sty|cls|txt)$' then
    raise exception 'Use a relative source path such as sections/introduction.tex (.tex, .bib, .sty, .cls or .txt).' using errcode = '22023';
  end if;
  if not exists (select 1 from public.paper_workspaces where project_id = p_project_id) then
    raise exception 'Initialize the paper first.' using errcode = '22023';
  end if;
  if (select count(*) from public.paper_files where project_id = p_project_id) >= 100 then
    raise exception 'A paper can contain up to 100 source files.' using errcode = '22023';
  end if;
  if exists(select 1 from public.paper_files where project_id = p_project_id and
    (path = p_path or starts_with(path, p_path || '/') or starts_with(p_path, path || '/'))) then
    raise exception 'That path already exists or conflicts with a file.' using errcode = '22023';
  end if;
  return query insert into public.paper_files(project_id,path) values(p_project_id,p_path) returning *;
end;
$$;

create function public.save_paper_file(p_file_id uuid, p_content text, p_expected_version integer) returns setof public.paper_files
language plpgsql security definer set search_path = '' as $$
declare v_project_id uuid; v_file public.paper_files;
begin
  select project_id into v_project_id from public.paper_files where id = p_file_id;
  perform public.require_paper_editor(v_project_id);
  select * into v_file from public.paper_files where id = p_file_id for update;
  if p_expected_version is distinct from v_file.version then
    raise exception 'Another save changed this file. Your edits are preserved; copy them before reloading the latest version.' using errcode = '40001';
  end if;
  if p_content is null or octet_length(p_content) > 524288 then
    raise exception 'Each source file must be at most 512 KiB.' using errcode = '22023';
  end if;
  if (select coalesce(sum(octet_length(content)),0) from public.paper_files where project_id = v_project_id and id <> p_file_id) + octet_length(p_content) > 5242880 then
    raise exception 'Paper source files must total at most 5 MiB.' using errcode = '22023';
  end if;
  return query update public.paper_files set content = p_content, version = version + 1, updated_at = now() where id = p_file_id returning *;
  update public.projects set updated_at = now() where id = v_project_id;
end;
$$;
revoke all on function public.initialize_paper(uuid), public.create_paper_file(uuid,text), public.save_paper_file(uuid,text,integer) from public, anon;
grant execute on function public.initialize_paper(uuid), public.create_paper_file(uuid,text), public.save_paper_file(uuid,text,integer) to authenticated;
