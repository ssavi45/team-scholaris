create or replace function public.create_paper_file(p_project_id uuid, p_path text) returns setof public.paper_files
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_paper_editor(p_project_id);
  if p_path is null or length(p_path) > 240 or p_path !~ '^[A-Za-z0-9_-][A-Za-z0-9_.-]*(/[A-Za-z0-9_-][A-Za-z0-9_.-]*)*\.(tex|bib|sty|cls|txt|bst|clo|cfg|def)$' then
    raise exception 'Use a relative source path such as sections/introduction.tex (.tex, .bib, .sty, .cls or .txt).' using errcode = '22023';
  end if;
  if not exists (select 1 from public.paper_workspaces where project_id = p_project_id) then
    raise exception 'Initialize the paper first.' using errcode = '22023';
  end if;
  if (select count(*) from public.paper_files where project_id = p_project_id) >= 100 then
    raise exception 'A paper can contain up to 100 source files.' using errcode = '22023';
  end if;
  if exists(select 1 from public.paper_files where project_id = p_project_id and
    (lower(path) = lower(p_path) or starts_with(lower(path), lower(p_path) || '/') or (kind <> 'folder' and starts_with(lower(p_path), lower(path) || '/')))) then
    raise exception 'That path already exists or conflicts with a file.' using errcode = '22023';
  end if;
  return query insert into public.paper_files(project_id,path) values(p_project_id,p_path) returning *;
end;
$$;


create or replace function public.guard_paper_content() returns trigger language plpgsql set search_path = '' as $$
begin
  if NEW.kind <> 'text' then raise exception 'Only text source can be edited.' using errcode = '22023'; end if;
  NEW.size_bytes := octet_length(NEW.content);
  return NEW;
end;
$$;
