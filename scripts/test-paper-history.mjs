import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const [owner, member, viewer, stranger, project, asset] = Array.from({ length: 6 }, () => randomUUID())
const claim = id => `select set_config('request.jwt.claims','{"sub":"${id}","role":"authenticated"}',true);`
const sql = `begin;
-- Rollback-only fake Storage rows: emulate the Storage API's deletion session.
set local storage.allow_delete_query = 'true';
insert into auth.users(id,email,email_confirmed_at) values
('${owner}','history-${owner}@example.test',now()),('${member}','history-${member}@example.test',now()),
('${viewer}','history-${viewer}@example.test',now()),('${stranger}','history-${stranger}@example.test',now());
insert into public.projects(id,owner_id,name) values('${project}','${owner}','History fixture');
insert into public.project_members(project_id,user_id,access_level) values
('${project}','${owner}','owner'),('${project}','${member}','member'),('${project}','${viewer}','viewer');
insert into storage.objects(bucket_id,name,metadata) values('paper-figures','${project}/${asset}.png','{"mimetype":"image/png","size":68}');
set local role authenticated;
${claim(owner)}
select public.initialize_paper('${project}');
do $$ declare s jsonb; entries jsonb; f public.paper_files; revision integer; initial bigint; withfigure bigint; count_before integer; restored_version integer;
begin
  select * into f from public.paper_files where project_id='${project}' and path='main.tex';
  select w.revision into revision from public.paper_workspaces w where project_id='${project}';
  initial := public.create_paper_checkpoint('${project}',revision,'Original draft');
  count_before := jsonb_array_length(public.list_paper_history('${project}'));
  perform public.save_paper_file(f.id,'Latest draft',f.version);
  if jsonb_array_length(public.list_paper_history('${project}')) <> count_before then raise exception 'Autosave was not throttled'; end if;
  select w.revision into revision from public.paper_workspaces w where project_id='${project}';
  select jsonb_agg(to_jsonb(p) || case when id=f.id then '{"path":"paper.tex"}'::jsonb else '{}'::jsonb end) into entries from public.paper_files p where project_id='${project}';
  entries := entries || jsonb_build_array(jsonb_build_object('path','figures/plot.png','kind','image','storage_path','${project}/${asset}.png'));
  perform public.apply_paper_manifest('${project}',revision,entries,'paper.tex');
  if not exists(select 1 from public.paper_files where id=f.id and path='paper.tex') then raise exception 'Rename lost identity'; end if;
  select w.revision into revision from public.paper_workspaces w where project_id='${project}';
  withfigure := public.create_paper_checkpoint('${project}',revision,'With figure');
  select jsonb_agg(to_jsonb(p)) into entries from public.paper_files p where project_id='${project}' and kind <> 'image';
  perform public.apply_paper_manifest('${project}',revision,entries,'paper.tex');
  if not public.paper_figure_referenced('${project}/${asset}.png') then raise exception 'Historical figure lost reference'; end if;
  select w.revision into revision from public.paper_workspaces w where project_id='${project}';
  s := public.get_paper_history('${project}',withfigure);
  perform public.restore_paper_history('${project}',withfigure,revision,(select (e->>'id')::uuid from jsonb_array_elements(s->'files') e where e->>'kind'='image'));
  if not exists(select 1 from public.paper_files where project_id='${project}' and kind='image') then raise exception 'Deleted figure not restored'; end if;
  if (select content from public.paper_files where id=f.id) <> 'Latest draft' then raise exception 'Single-file restore changed other text'; end if;
  begin
    perform public.restore_paper_history('${project}',initial,revision);
    raise exception 'Stale restore accepted';
  exception when sqlstate 'PT409' then null; end;
  select w.revision into revision from public.paper_workspaces w where project_id='${project}';
  perform public.restore_paper_history('${project}',initial,revision);
  select version into restored_version from public.paper_files where id=f.id;
  if restored_version <= f.version then raise exception 'Restore reused a file version'; end if;
  if not exists(select 1 from public.paper_files where id=f.id and path='main.tex' and content=f.content) then raise exception 'Whole restore did not preserve identity/content/path'; end if;
  begin perform public.save_paper_file(f.id,'Stale overwrite',f.version); raise exception 'Stale client overwrite accepted'; exception when serialization_failure then null; end;
  if not exists(select 1 from jsonb_array_elements(public.list_paper_history('${project}')) e where e->>'kind'='safety') then raise exception 'Pre-restore checkpoint missing'; end if;
  begin perform public.paper_history_capture('${project}','named','Forgery'); raise exception 'Internal capture exposed'; exception when insufficient_privilege then null; end;
  begin perform public.paper_manifest_internal('${project}',revision,entries,'main.tex'); raise exception 'Internal manifest exposed'; exception when insufficient_privilege then null; end;
end $$;
${claim(viewer)}
do $$ declare id bigint; revision integer; begin
  id := (public.list_paper_history('${project}')->0->>'id')::bigint;
  if public.get_paper_history('${project}',id)->'files' is null then raise exception 'Viewer cannot inspect'; end if;
  if not exists(select 1 from storage.objects where name='${project}/${asset}.png') then raise exception 'Viewer cannot read retained figure'; end if;
  select w.revision into revision from public.paper_workspaces w where project_id='${project}';
  begin perform public.restore_paper_history('${project}',id,revision); raise exception 'Viewer restored'; exception when insufficient_privilege then null; end;
  begin perform public.create_paper_checkpoint('${project}',revision,'Viewer'); raise exception 'Viewer checkpointed'; exception when insufficient_privilege then null; end;
  begin perform public.delete_paper_checkpoint('${project}',id); raise exception 'Viewer deleted history'; exception when insufficient_privilege then null; end;
end $$;
${claim(stranger)}
do $$ begin
  begin perform public.list_paper_history('${project}'); raise exception 'Stranger read history'; exception when insufficient_privilege then null; end;
  if exists(select 1 from storage.objects where name='${project}/${asset}.png') then raise exception 'Stranger read figure'; end if;
end $$;
${claim(member)}
do $$ declare id bigint; revision integer; begin
  id := (public.list_paper_history('${project}')->0->>'id')::bigint;
  select w.revision into revision from public.paper_workspaces w where project_id='${project}';
  perform public.restore_paper_history('${project}',id,revision);
  delete from storage.objects where bucket_id='paper-figures' and name='${project}/${asset}.png';
  if not exists(select 1 from storage.objects where name='${project}/${asset}.png') then raise exception 'Retained figure deleted'; end if;
end $$;
reset role;
do $$ begin
  begin delete from storage.objects where name='${project}/${asset}.png'; raise exception 'Privileged deletion bypassed figure guard'; exception when insufficient_privilege then null; end;
end $$;
update public.paper_history set created_at=now()-interval '8 days' where project_id='${project}' and kind='automatic';
set local role authenticated;
${claim(owner)}
select public.create_paper_file('${project}','retention.tex');
reset role;
do $$ begin
  if exists(select 1 from public.paper_history where project_id='${project}' and kind='automatic' and created_at<now()-interval '7 days') then raise exception 'Automatic retention failed'; end if;
  if not exists(select 1 from public.paper_history where project_id='${project}' and label='Original draft') then raise exception 'Named snapshot pruned'; end if;
end $$;
set local role authenticated;
${claim(owner)}
do $$ declare revision integer; total integer; i integer; begin
  for i in 1..15 loop perform public.create_paper_file('${project}','quota' || i || '.tex'); end loop;
  if jsonb_array_length(public.list_paper_history('${project}')) <> 21 then raise exception 'Pagination page bound failed'; end if;
  select w.revision into revision from public.paper_workspaces w where project_id='${project}';
  for i in 1..30 loop
    begin perform public.create_paper_checkpoint('${project}',revision,'Quota ' || i); exception when program_limit_exceeded then exit; end;
  end loop;
  begin perform public.create_paper_checkpoint('${project}',revision,'Over quota'); raise exception 'Checkpoint quota bypassed'; exception when program_limit_exceeded then null; end;
  begin perform public.restore_paper_history('${project}',(public.list_paper_history('${project}')->0->>'id')::bigint,revision); raise exception 'Restore without safety space accepted'; exception when program_limit_exceeded then null; end;
  if revision <> (select w.revision from public.paper_workspaces w where project_id='${project}') then raise exception 'Failed restore changed live paper'; end if;
end $$;
reset role;
do $$ begin
  if (select count(*) from public.paper_history where project_id='${project}' and kind='automatic') > 24 then raise exception 'Automatic count exceeded'; end if;
  if (select count(*) from public.paper_history where project_id='${project}' and kind<>'automatic') <> 20 then raise exception 'Protected checkpoint quota wrong'; end if;
end $$;
update public.projects set status='archived' where id='${project}';
set local role authenticated;
${claim(owner)}
do $$ begin
  perform public.list_paper_history('${project}');
  begin perform public.restore_paper_history('${project}',0,0); raise exception 'Archived restore accepted'; exception when insufficient_privilege then null; end;
end $$;
reset role;
delete from public.project_members where project_id='${project}' and user_id='${member}';
set local role authenticated;
${claim(member)}
do $$ begin begin perform public.list_paper_history('${project}'); raise exception 'Removed member read history'; exception when insufficient_privilege then null; end; end $$;
rollback;`
try {
  execFileSync('docker', ['exec', '-i', 'supabase_db_team-scholaris', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
  console.log('PASS: history authorization, source throttling, identity/figure restore, stale-write rejection, safety checkpoints, private retained figures, retention, quotas, pagination and archive/removal restrictions. Fixtures rolled back.')
} catch (error) { console.error(String(error.stderr || error.message)); process.exitCode = 1 }
