-- Keep a claimed state until the token exchange finishes. Disconnect/new
-- authorization can then invalidate an in-flight callback before it stores a
-- credential. Completion and state removal happen in one transaction.
alter table public.google_calendar_oauth_states add column claimed_at timestamptz;
create or replace function public.consume_google_oauth_state(p_hash text,p_browser text)
returns setof public.google_calendar_oauth_states language sql security definer set search_path = '' as $$
  update public.google_calendar_oauth_states set claimed_at = now()
    where state_hash = p_hash and browser_hash = p_browser and expires_at > now() and claimed_at is null returning *;
$$;
create function public.complete_google_connection(p_hash text,p_user_id uuid,p_sub text,p_email text,p_cipher text)
returns void language plpgsql security definer set search_path = '' as $$
declare state_user uuid;
begin
  delete from public.google_calendar_oauth_states where state_hash = p_hash and user_id = p_user_id
    and claimed_at is not null and expires_at > now() returning user_id into state_user;
  if state_user is null then raise exception 'Google authorization expired or was disconnected. Connect again.' using errcode = '22023'; end if;
  insert into public.google_calendar_connections(user_id,google_sub,email,refresh_cipher,updated_at)
    values(p_user_id,p_sub,p_email,p_cipher,now()) on conflict(user_id) do update
    set google_sub = excluded.google_sub,email = excluded.email,refresh_cipher = excluded.refresh_cipher,updated_at = excluded.updated_at;
end;
$$;
revoke all on function public.complete_google_connection(text,uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.complete_google_connection(text,uuid,text,text,text) to service_role;
