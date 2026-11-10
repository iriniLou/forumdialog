-- Two moderated interactions. Existing answers and aggregates are retained.
alter table public.polls drop constraint polls_max_length_check;
alter table public.polls add constraint polls_max_length_check check(max_length between 1 and 2000);
alter table public.open_responses drop constraint open_responses_text_check;
alter table public.open_responses add constraint open_responses_text_check check(length(text) between 1 and 2000);
create index responses_by_poll_status on public.open_responses(poll_id,status);
create unique index session_stage_per_event on public.polls(event_id,(metadata->>'session_stage')) where metadata->>'session_stage' in ('cloud','final');

create or replace function public.board_data(e uuid, private boolean) returns jsonb language sql stable security definer set search_path='' as $$
select jsonb_build_object('id',v.id,'code',v.code,'title',v.title,'date',v.date,'timezone',v.timezone,'status',v.status,'hidden',v.hidden or v.status<>'active','polls',coalesce((select jsonb_agg(q.data order by q.position) from (
select p.position,jsonb_build_object('id',p.id,'title',p.title,'kind',p.kind,'source',p.source,'max_length',p.max_length,'status',p.status,'metadata',p.metadata,'imported_n',p.imported_n,
'n',case when private or p.status='results' then coalesce(p.imported_n,(select count(*)::int from public.votes where poll_id=p.id)) else 0 end,
'options',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'label',o.label,'count',case when private or p.status='results' then o.imported_count+(select count(*) from public.votes z where z.poll_id=p.id and o.id=any(z.choices)) else 0 end) order by o.position) from public.options o where o.poll_id=p.id),'[]'::jsonb),
'cloud_words',case when p.metadata->>'session_stage'='cloud' and (private or p.status='results' or (p.source='live' and p.status='open')) then coalesce((select jsonb_agg(jsonb_build_object('text',w.label,'count',w.n) order by w.n desc,w.label) from (select lower(regexp_replace(btrim(r.text),'[[:space:]]+',' ','g')) as label,count(*)::int as n from public.open_responses r where r.poll_id=p.id and r.status='approved' group by 1) w),'[]'::jsonb) else '[]'::jsonb end,
'cards',case when private or p.status='results' or (p.source='live' and p.status='open') then coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'text',r.text,'category',r.category)) from (select * from public.open_responses where poll_id=p.id and status='approved' order by created_at desc,id limit case when p.metadata->>'session_stage'='final' then null else 10 end) r),'[]'::jsonb) else '[]'::jsonb end) data
from public.polls p where p.event_id=e and (private or (not v.hidden and v.status='active' and coalesce(p.metadata->>'archived','false')<>'true' and p.status in ('open','results')))) q),'[]'::jsonb))
from public.events v where v.id=e $$;

create function public.control_stage(p_code text,p_poll uuid,p_state text) returns void language plpgsql security definer set search_path='' as $$
declare e public.events;r text;p public.polls;begin
select * into e from public.events where code=p_code for update;
r:=public.event_role(e.id);if r is null or r not in ('admin','operator') then raise exception 'Требуется оператор';end if;
select * into p from public.polls where id=p_poll and event_id=e.id for update;
if p.id is null or coalesce(p.metadata->>'session_stage','') not in ('cloud','final') or p_state not in ('open','results') or e.status<>'active' then raise exception 'Недопустимый этап';end if;
update public.polls set status='closed' where event_id=e.id and id<>p.id and status in ('open','results');
update public.polls set status=p_state where id=p.id;
update public.events set hidden=false where id=e.id;
end $$;

create function public.present_response(p_code text,p_poll uuid,p_response uuid default null) returns void language plpgsql security definer set search_path='' as $$
declare e public.events;r text;p public.polls;begin
select * into e from public.events where code=p_code for update;
r:=public.event_role(e.id);if r is null or r not in ('admin','operator','moderator') then raise exception 'Нет доступа';end if;
select * into p from public.polls where id=p_poll and event_id=e.id for update;
if p.id is null or coalesce(p.metadata->>'session_stage','')<>'final' then raise exception 'Выберите финал';end if;
if p_response is not null and not exists(select 1 from public.open_responses where id=p_response and poll_id=p.id and event_id=e.id and status='approved') then raise exception 'Ответ ещё не одобрен';end if;
update public.polls set metadata=metadata||jsonb_build_object('featured_response',coalesce(p_response::text,'')) where id=p.id;
end $$;

revoke all on function public.control_stage(text,uuid,text),public.present_response(text,uuid,uuid) from public,anon;
grant execute on function public.control_stage(text,uuid,text),public.present_response(text,uuid,uuid) to authenticated;
