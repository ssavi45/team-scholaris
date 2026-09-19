-- Qualify the outer storage name: project_files also has a name column.
-- An unqualified name inside its subquery compares two file-record columns.
drop policy project_files_storage_delete on storage.objects;
create policy project_files_storage_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'project-files'
  and public.project_file_storage_allowed(name, true)
  and not exists (
    select 1 from public.project_files f where f.storage_path = storage.objects.name
  )
  and (owner_id = auth.uid()::text or exists (
    select 1 from public.projects p
    where p.id::text = split_part(storage.objects.name, '/', 1) and p.owner_id = auth.uid()
  ))
);
