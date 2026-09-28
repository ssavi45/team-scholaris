-- Expected revision conflicts are HTTP 409, not retryable database outages.
-- SQLSTATE 40001 maps to HTTP 503 and the local gateway retries until timeout.
do $$
declare definition text; signature text;
begin
  foreach signature in array array[
    'public.restore_paper_history(uuid,bigint,integer,uuid)',
    'public.create_paper_checkpoint(uuid,integer,text)'
  ] loop
    definition := pg_get_functiondef(signature::regprocedure);
    execute replace(definition, 'errcode = ''40001''', 'errcode = ''PT409''');
  end loop;
end $$;
