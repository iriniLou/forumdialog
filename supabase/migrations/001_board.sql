-- Run once in a fresh Supabase project, using SQL Editor as postgres.
create table public.events(id uuid primary key default gen_random_uuid(), code text unique not null default substr(replace(gen_random_uuid()::text,'-',''),1,12),title text not null,date date not null,timezone text not null default 'Europe/Moscow',status text not null default 'active' check(status in ('active','archived')),hidden boolean not null default false,delete_after timestamptz);
create table public.admin_roles(user_id uuid not null references auth.users(id) on delete cascade,event_id uuid not null references public.events on delete cascade,role text not null check(role in ('admin','moderator','operator')),primary key(user_id,event_id));
create table public.polls(id uuid primary key default gen_random_uuid(),event_id uuid not null references public.events on delete cascade,title text not null check(length(title) between 1 and 500),kind text not null check(kind in ('single','multi','text')),source text not null default 'oral' check(source in ('live','oral','preforum','institute','slide')),max_length int not null default 250 check(max_length between 1 and 300),status text not null default 'prepared' check(status in ('prepared','open','closed','results')),position int not null default 0,imported_n int check(imported_n between 1 and 1000000),metadata jsonb not null default '{}',unique(id,event_id));
create table public.options(id uuid primary key default gen_random_uuid(),poll_id uuid not null,event_id uuid not null,label text not null check(length(label) between 1 and 300),position int not null,imported_count int not null default 0 check(imported_count between 0 and 1000000),foreign key(poll_id,event_id) references public.polls(id,event_id) on delete cascade,unique(id,poll_id));
create table public.votes(id uuid primary key default gen_random_uuid(),event_id uuid not null,poll_id uuid not null,anonymous_session_id uuid not null references auth.users on delete cascade,choices uuid[] not null default '{}',created_at timestamptz not null default now(),foreign key(poll_id,event_id) references public.polls(id,event_id) on delete cascade,unique(poll_id,anonymous_session_id));
create table public.open_responses(id uuid primary key default gen_random_uuid(),event_id uuid not null,poll_id uuid not null,text text not null check(length(text) between 1 and 300),status text not null default 'pending' check(status in ('pending','approved','hidden')),category text not null default 'практика' check(category in ('проблема','практика','решение','вопрос','для памятки')),tags text not null default '' check(length(tags)<=200),resolution text not null default 'требуется ответ' check(resolution in ('решено','требуется ответ')),created_at timestamptz not null default now(),foreign key(poll_id,event_id) references public.polls(id,event_id) on delete cascade);
create table public.moderation_actions(id uuid primary key default gen_random_uuid(),event_id uuid not null references public.events on delete cascade,response_id uuid references public.open_responses on delete cascade,actor uuid references auth.users on delete set null,original_text text not null,previous_status text not null,new_text text not null,new_status text not null,created_at timestamptz not null default now());
create index votes_rate on public.votes(anonymous_session_id,created_at);
create index response_queue on public.open_responses(event_id,poll_id,status);
create index polls_event on public.polls(event_id,position);
create index options_poll on public.options(poll_id,position);
alter table public.events enable row level security;
alter table public.polls enable row level security;
alter table public.options enable row level security;
alter table public.votes enable row level security;
alter table public.open_responses enable row level security;
alter table public.moderation_actions enable row level security;
alter table public.admin_roles enable row level security;
-- No direct access, including for authenticated organisers. All access is scoped RPC.
revoke all on public.events,public.polls,public.options,public.votes,public.open_responses,public.moderation_actions,public.admin_roles from anon,authenticated;
create function public.event_role(e uuid) returns text language sql stable security definer set search_path='' as $$ select role from public.admin_roles where event_id=e and user_id=auth.uid() $$;
create function public.board_data(e uuid, private boolean) returns jsonb language sql stable security definer set search_path='' as $$
select jsonb_build_object('id',v.id,'code',v.code,'title',v.title,'date',v.date,'timezone',v.timezone,'status',v.status,'hidden',v.hidden or v.status<>'active','polls',coalesce((select jsonb_agg(q.data order by q.position) from (
select p.position,jsonb_build_object('id',p.id,'title',p.title,'kind',p.kind,'source',p.source,'max_length',p.max_length,'status',p.status,'metadata',p.metadata,'imported_n',p.imported_n,
'n',case when private or p.status='results' then coalesce(p.imported_n,(select count(*)::int from public.votes where poll_id=p.id)) else 0 end,
'options',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'label',o.label,'count',case when private or p.status='results' then o.imported_count+(select count(*) from public.votes z where z.poll_id=p.id and o.id=any(z.choices)) else 0 end) order by o.position) from public.options o where o.poll_id=p.id),'[]'::jsonb),
'cards',case when private or p.status='results' or (p.source='live' and p.status='open') then coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'text',r.text,'category',r.category)) from (select * from public.open_responses where poll_id=p.id and status='approved' order by created_at desc limit 10) r),'[]'::jsonb) else '[]'::jsonb end) data
from public.polls p where p.event_id=e and (private or (not v.hidden and v.status='active' and p.status in ('open','results')))) q),'[]'::jsonb))
from public.events v where v.id=e $$;
create function public.public_board(p_code text) returns jsonb language plpgsql stable security definer set search_path='' as $$ declare e uuid; begin select id into e from public.events where code=p_code; if e is null then raise exception 'Событие не найдено';end if;return public.board_data(e,false);end $$;
create function public.admin_board(p_code text) returns jsonb language plpgsql stable security definer set search_path='' as $$ declare e uuid; r text; b jsonb;begin select id into e from public.events where code=p_code;r:=public.event_role(e);if r is null then raise exception 'Нет роли в событии';end if;b:=public.board_data(e,true)||jsonb_build_object('role',r);if r in ('admin','moderator') then b:=b||jsonb_build_object('responses',coalesce((select jsonb_agg(to_jsonb(x)-'event_id' order by created_at) from public.open_responses x where event_id=e),'[]'::jsonb));end if;if r='admin' then b:=b||jsonb_build_object('audit',coalesce((select jsonb_agg(to_jsonb(a)-'actor') from public.moderation_actions a where event_id=e),'[]'::jsonb));end if;return b;end $$;
create function public.submit_response(p_code text,p_poll uuid,p_choices uuid[] default '{}',p_text text default '') returns void language plpgsql security definer set search_path='' as $$
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
if p.kind='text' then insert into public.open_responses(event_id,poll_id,text,category) values(e.id,p.id,trim(p_text),coalesce(p.metadata->>'default_category','практика'));end if;
end $$;
create function public.create_event(p_title text,p_date date,p_questions jsonb) returns text language plpgsql security definer set search_path='' as $$ declare e public.events;q jsonb;p uuid;pos int:=0;begin
-- Only an existing administrator can create events; bootstrap manually in SQL Editor.
if not exists(select 1 from public.admin_roles where user_id=auth.uid() and role='admin') then raise exception 'Требуется администратор';end if;
insert into public.events(title,date) values(p_title,p_date) returning * into e;
insert into public.admin_roles values(auth.uid(),e.id,'admin');
for q in select * from jsonb_array_elements(p_questions) loop
insert into public.polls(event_id,title,kind,source,max_length,position,metadata) values(e.id,q->>'title',q->>'kind',q->>'source',coalesce((q->>'max')::int,250),pos,case when q ? 'category' then jsonb_build_object('default_category',q->>'category') else '{}'::jsonb end) returning id into p;pos:=pos+1;
end loop;return e.code;end $$;
create function public.manage_event(p_code text,p_op text,p_payload jsonb) returns text language plpgsql security definer set search_path='' as $$
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
if p.id is null or p.source<>'preforum' or p.kind<>'single' or p.imported_n is not null or exists(select 1 from public.votes where poll_id=p.id) then raise exception 'Импорт только в пустой вопрос предварительной анкеты';end if;
if not (p_payload ?& array['n','cutoff','sample','counts']) or length(p_payload->>'cutoff')=0 or length(p_payload->>'sample')=0 then raise exception 'Нужны N, время и описание выборки';end if;
if jsonb_array_length(p_payload->'counts')<>(select count(*) from public.options where poll_id=p.id) then raise exception 'Нужны все категории';end if;
if (select count(distinct value->>'id') from jsonb_array_elements(p_payload->'counts'))<>jsonb_array_length(p_payload->'counts') then raise exception 'Повтор категории';end if;
for v in select * from jsonb_array_elements(p_payload->'counts') loop
update public.options set imported_count=(v->>'count')::int where id=(v->>'id')::uuid and poll_id=p.id;if not found then raise exception 'Чужая категория';end if;total:=total+(v->>'count')::int;end loop;
if total<>(p_payload->>'n')::int then raise exception 'Для одиночного выбора сумма должна совпадать с N';end if;
update public.polls set imported_n=(p_payload->>'n')::int,metadata=jsonb_build_object('cutoff',p_payload->>'cutoff','sample',p_payload->>'sample') where id=p.id;
else raise exception 'Неизвестная команда';end case;return e.code;end $$;
-- Private helpers cannot be called through PostgREST.
revoke all on function public.event_role(uuid),public.board_data(uuid,boolean) from public,anon,authenticated;
revoke all on function public.public_board(text),public.admin_board(text),public.submit_response(text,uuid,uuid[],text),public.create_event(text,date,jsonb),public.manage_event(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.public_board(text) to anon,authenticated;
grant execute on function public.admin_board(text),public.submit_response(text,uuid,uuid[],text),public.create_event(text,date,jsonb),public.manage_event(text,text,jsonb) to authenticated;
-- Schedule through Supabase Cron as postgres, after agreeing retention policy.
-- delete from public.events where delete_after < now(); -- cascades all event data/audit
