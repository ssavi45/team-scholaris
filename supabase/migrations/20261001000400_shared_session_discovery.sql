create function public.list_shared_paper_files(p_project uuid)
returns table(file_id uuid, epoch uuid)
language sql stable security definer set search_path = '' as $$
  select d.file_id,d.epoch from public.paper_shared_documents d
  join public.paper_files f on f.id=d.file_id
  where f.project_id=p_project and public.can_access_project(p_project);
$$;
revoke all on function public.list_shared_paper_files(uuid) from public, anon;
grant execute on function public.list_shared_paper_files(uuid) to authenticated;
