-- Only future submissions use the new limits; existing answers are retained.
update public.polls set max_length=case metadata->>'session_stage' when 'cloud' then 50 else 300 end
where metadata->>'session_stage' in ('cloud','final');
create function public.rename_final_question(p_code text,p_poll uuid,p_title text) returns void language plpgsql security definer set search_path='' as $$
declare e public.events; r text; begin
select * into e from public.events where code=p_code for update;
r:=public.event_role(e.id);
if r is null or r not in ('admin','operator') then raise exception 'Требуется оператор'; end if;
if p_title is null or length(btrim(p_title)) not between 1 and 500 then raise exception 'Вопрос: от 1 до 500 символов'; end if;
update public.polls set title=btrim(p_title) where id=p_poll and event_id=e.id and metadata->>'session_stage'='final';
if not found then raise exception 'Выберите финал'; end if;
end $$;
revoke all on function public.rename_final_question(text,uuid,text) from public,anon;
grant execute on function public.rename_final_question(text,uuid,text) to authenticated;
