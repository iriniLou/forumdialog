-- Allow an uncategorised answer without changing existing responses or moderation.
alter table public.open_responses drop constraint if exists open_responses_category_check;
alter table public.open_responses drop constraint if exists open_responses_category_optional;
alter table public.open_responses add constraint open_responses_category_optional
  check(category in ('','проблема','практика','решение','вопрос','для памятки'));
alter table public.open_responses alter column category set default '';

create or replace function public.submit_response(p_code text,p_poll uuid,p_choices uuid[] default '{}',p_text text default '') returns void language plpgsql security definer set search_path='' as $$
declare p public.polls; e public.events;u uuid:=auth.uid();begin
if u is null then raise exception 'Требуется анонимная сессия';end if;
-- Serialize each identity, not the whole audience. Shared poll lock coordinates closure.
perform pg_advisory_xact_lock(hashtextextended(u::text,0));
select * into e from public.events where code=p_code for share;
select * into p from public.polls where id=p_poll and event_id=e.id for share;
if p.id is null or p.status<>'open' or p.source<>'live' or e.status<>'active' then raise exception 'Опрос закрыт';end if;
if exists(select 1 from public.votes where poll_id=p.id and anonymous_session_id=u) then return;end if;
if exists(select 1 from public.votes where anonymous_session_id=u and created_at>now()-interval '2 seconds') or (select count(*) from public.votes where anonymous_session_id=u and created_at>now()-interval '1 hour')>=30 then raise exception 'Слишком часто. Попробуйте позже';end if;
if p.kind='text' then if length(trim(p_text))<1 or length(p_text)>p.max_length or cardinality(p_choices)<>0 then raise exception 'Проверьте длину ответа';end if;
else if cardinality(p_choices) is null or cardinality(p_choices)<1 or (p.kind='single' and cardinality(p_choices)<>1) or cardinality(p_choices)<>(select count(distinct x) from unnest(p_choices) x) or exists(select 1 from unnest(p_choices) x where not exists(select 1 from public.options where id=x and poll_id=p.id)) then raise exception 'Недопустимые варианты';end if;end if;
insert into public.votes(event_id,poll_id,anonymous_session_id,choices) values(e.id,p.id,u,p_choices);
if p.kind='text' then insert into public.open_responses(event_id,poll_id,text,category) values(e.id,p.id,trim(p_text),coalesce(p.metadata->>'default_category',''));end if;
end $$;
