-- Re-importable, versioned preforum aggregates. Apply once after 001.
create table public.aggregate_imports(id uuid primary key default gen_random_uuid(),event_id uuid not null references public.events on delete cascade,poll_id uuid not null,actor uuid references auth.users on delete set null,before_data jsonb not null,after_data jsonb not null,created_at timestamptz not null default now(),foreign key(poll_id,event_id) references public.polls(id,event_id) on delete cascade);
alter table public.aggregate_imports enable row level security;
revoke all on public.aggregate_imports from public,anon,authenticated;
grant all on public.aggregate_imports to service_role;
create or replace function public.manage_event(p_code text,p_op text,p_payload jsonb) returns text language plpgsql security definer set search_path='' as $$
declare e public.events;r text;p public.polls;x public.open_responses;pid uuid;v jsonb;i int:=0;total int:=0;begin
select * into e from public.events where code=p_code for update;r:=public.event_role(e.id);if r is null then raise exception 'Нет доступа';end if;
if p_op in ('status','hide','emergency') then if r not in ('admin','operator') then raise exception 'Требуется оператор';end if;
elsif p_op='moderate' then if r not in ('admin','moderator') then raise exception 'Требуется модератор';end if;
elsif p_op='oral' then if r not in ('admin','operator','moderator') then raise exception 'Нет доступа';end if;
else if r<>'admin' then raise exception 'Требуется администратор';end if;end if;
if p_payload ? 'id' then pid:=(p_payload->>'id')::uuid;end if;
select * into p from public.polls where id=pid and event_id=e.id for update;
case p_op
when 'hide' then update public.events set hidden=(p_payload->>'hidden')::boolean where id=e.id;
when 'emergency' then update public.events set hidden=true where id=e.id;update public.polls set status='closed' where event_id=e.id and status in ('open','results');
when 'event' then update public.events set title=p_payload->>'title',date=(p_payload->>'date')::date,status=p_payload->>'status' where id=e.id;
when 'status' then
if p.id is null then raise exception 'Нет вопроса';end if;
if p_payload->>'status' in ('open','results') then update public.polls set status='closed' where event_id=e.id and id<>p.id and status in ('open','results');end if;
update public.polls set status=p_payload->>'status' where id=p.id;
when 'save_poll' then
if exists(select 1 from public.votes where poll_id=p.id) or p.imported_n is not null or exists(select 1 from public.open_responses where poll_id=p.id) then raise exception 'Создайте новый вопрос: в этом уже есть ответы';end if;
if p_payload->>'kind'<>'text' and jsonb_array_length(p_payload->'labels') not between 2 and 6 then raise exception 'Нужны 2–6 вариантов';end if;
if p.id is null then insert into public.polls(event_id,title,kind,source,max_length,position) values(e.id,p_payload->>'title',p_payload->>'kind',p_payload->>'source',(p_payload->>'max_length')::int,(select coalesce(max(position),0)+1 from public.polls where event_id=e.id)) returning id into pid;
else update public.polls set title=p_payload->>'title',kind=p_payload->>'kind',source=p_payload->>'source',max_length=(p_payload->>'max_length')::int where id=pid;delete from public.options where poll_id=pid;end if;
for v in select * from jsonb_array_elements(p_payload->'labels') loop insert into public.options(event_id,poll_id,label,position) values(e.id,pid,v#>>'{}',i);i:=i+1;end loop;
when 'oral' then
if p.id is null or p.source not in ('oral','preforum','slide') then raise exception 'Недопустимый источник';end if;
insert into public.open_responses(event_id,poll_id,text,category) values(e.id,p.id,trim(p_payload->>'text'),p_payload->>'category');
when 'moderate' then
select * into x from public.open_responses where id=pid and event_id=e.id for update;if x.id is null then raise exception 'Нет ответа';end if;
insert into public.moderation_actions(event_id,response_id,actor,original_text,previous_status,new_text,new_status) values(e.id,x.id,auth.uid(),x.text,x.status,p_payload->>'text',p_payload->>'status');
update public.open_responses set text=p_payload->>'text',status=p_payload->>'status',category=p_payload->>'category',tags=p_payload->>'tags',resolution=p_payload->>'resolution' where id=x.id;
when 'metadata' then
if p.id is null or octet_length((p_payload->'metadata')::text)>2800000 then raise exception 'Недопустимые метаданные';end if;
update public.polls set metadata=p_payload->'metadata' where id=p.id;
when 'import' then
if p.id is null or p.source<>'preforum' or p.kind<>'single' or exists(select 1 from public.votes where poll_id=p.id) or exists(select 1 from public.open_responses where poll_id=p.id) then raise exception 'Импорт доступен только для агрегатов предварительной анкеты';end if;
if coalesce((p_payload->>'expected_version')::int,0)<>coalesce((p.metadata->>'version')::int,0) then raise exception 'Срез уже обновлён другим организатором. Обновите страницу';end if;
insert into public.aggregate_imports(event_id,poll_id,actor,before_data,after_data) values(e.id,p.id,auth.uid(),jsonb_build_object('n',p.imported_n,'metadata',p.metadata,'counts',(select jsonb_agg(to_jsonb(o)) from public.options o where poll_id=p.id)),p_payload);
if not (p_payload ?& array['n','cutoff','sample','counts']) or coalesce((p_payload->>'n')::int,0) not between 1 and 1000000 or coalesce(length(trim(p_payload->>'cutoff')),0) not between 1 and 200 or coalesce(length(trim(p_payload->>'sample')),0) not between 1 and 1000 then raise exception 'Нужны корректные N, время и описание выборки';end if;
if jsonb_array_length(p_payload->'counts')<>(select count(*) from public.options where poll_id=p.id) then raise exception 'Нужны все категории';end if;
if (select count(distinct value->>'id') from jsonb_array_elements(p_payload->'counts'))<>jsonb_array_length(p_payload->'counts') then raise exception 'Повтор категории';end if;
for v in select * from jsonb_array_elements(p_payload->'counts') loop
update public.options set imported_count=(v->>'count')::int where id=(v->>'id')::uuid and poll_id=p.id;if not found then raise exception 'Чужая категория';end if;total:=total+(v->>'count')::int;end loop;
if total<>(p_payload->>'n')::int then raise exception 'Для одиночного выбора сумма должна совпадать с N';end if;
update public.polls set imported_n=(p_payload->>'n')::int,metadata=p.metadata||jsonb_build_object('cutoff',p_payload->>'cutoff','sample',p_payload->>'sample','preliminary',coalesce(p_payload->>'preliminary','yes'),'version',coalesce((p.metadata->>'version')::int,0)+1) where id=p.id;
else raise exception 'Неизвестная команда';end case;return e.code;end $$;
create or replace function public.admin_board(p_code text) returns jsonb language plpgsql stable security definer set search_path='' as $$ declare e uuid; r text; b jsonb;begin select id into e from public.events where code=p_code;r:=public.event_role(e);if r is null then raise exception 'Нет роли в событии';end if;b:=public.board_data(e,true)||jsonb_build_object('role',r);if r in ('admin','moderator') then b:=b||jsonb_build_object('responses',coalesce((select jsonb_agg(to_jsonb(x)-'event_id' order by created_at) from public.open_responses x where event_id=e),'[]'::jsonb));end if;if r='admin' then b:=b||jsonb_build_object('imports',coalesce((select jsonb_agg(to_jsonb(i)-'actor' order by created_at) from public.aggregate_imports i where event_id=e),'[]'::jsonb));b:=b||jsonb_build_object('audit',coalesce((select jsonb_agg(to_jsonb(a)-'actor') from public.moderation_actions a where event_id=e),'[]'::jsonb));end if;return b;end $$;
create or replace function public.create_event(p_title text,p_date date,p_questions jsonb) returns text language plpgsql security definer set search_path='' as $$ declare e public.events;q jsonb;p uuid;pos int:=0;label jsonb;op int;begin
-- Only an existing administrator can create events; bootstrap manually in SQL Editor.
if not exists(select 1 from public.admin_roles where user_id=auth.uid() and role='admin') then raise exception 'Требуется администратор';end if;
insert into public.events(title,date) values(p_title,p_date) returning * into e;
insert into public.admin_roles values(auth.uid(),e.id,'admin');
for q in select * from jsonb_array_elements(p_questions) loop
insert into public.polls(event_id,title,kind,source,max_length,position,metadata) values(e.id,q->>'title',q->>'kind',q->>'source',coalesce((q->>'max')::int,250),pos,case when q ? 'category' then jsonb_build_object('default_category',q->>'category') else '{}'::jsonb end||case when q ? 'key' then jsonb_build_object('aggregate_key',q->>'key') else '{}'::jsonb end) returning id into p;pos:=pos+1;op:=0;for label in select * from jsonb_array_elements(coalesce(q->'labels','[]'::jsonb)) loop insert into public.options(event_id,poll_id,label,position) values(e.id,p,label#>>'{}',op);op:=op+1;end loop;
end loop;return e.code;end $$;
