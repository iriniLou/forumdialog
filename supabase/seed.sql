-- Run once after migration; no fabricated responses.
do $$ declare e uuid; begin
insert into public.events(title,date) values ('Живой разговор · Вместе о важном','2026-11-13') returning id into e;
insert into public.polls(event_id,title,kind,source,max_length,position,metadata) values(e,'Так что же для вас «Разговоры о важном»?','text','live',80,0,'{}'::jsonb);
insert into public.polls(event_id,title,kind,source,max_length,position,metadata) values(e,'Что изменилось в «Разговорах о важном» в 2026/2027 учебном году?','text','oral',250,1,'{}'::jsonb);
insert into public.polls(event_id,title,kind,source,max_length,position,metadata) values(e,'Какие темы уже провели? Что удалось? Где было трудно?','text','oral',250,2,'{}'::jsonb);
insert into public.polls(event_id,title,kind,source,max_length,position,metadata) values(e,'Почему не хватает времени? Что в сценарии помогает подготовке?','text','oral',250,3,'{}'::jsonb);
insert into public.polls(event_id,title,kind,source,max_length,position,metadata) values(e,'Видео показано, но дети не говорили. Что изменить?','text','oral',250,4,'{}'::jsonb);
insert into public.polls(event_id,title,kind,source,max_length,position,metadata) values(e,'Подросток: «Это всё красивые слова». Какую первую фразу скажете?','text','oral',250,5,'{}'::jsonb);
insert into public.polls(event_id,title,kind,source,max_length,position,metadata) values(e,'Как продолжаете разговор после звонка?','text','oral',250,6,'{}'::jsonb);
insert into public.polls(event_id,title,kind,source,max_length,position,metadata) values(e,'Чего не хватает','single','preforum',250,7,'{}'::jsonb);
insert into public.polls(event_id,title,kind,source,max_length,position,metadata) values(e,'Подготовка к занятию','single','preforum',250,8,'{}'::jsonb);
insert into public.polls(event_id,title,kind,source,max_length,position,metadata) values(e,'Вопрос экспертам','text','preforum',300,9,'{}'::jsonb);
insert into public.polls(event_id,title,kind,source,max_length,position,metadata) values(e,'Материалы мониторинга Института, 2023/2026','text','institute',250,10,'{}'::jsonb);
insert into public.polls(event_id,title,kind,source,max_length,position,metadata) values(e,'Темы и подходы','text','slide',250,11,'{}'::jsonb);
insert into public.polls(event_id,title,kind,source,max_length,position,metadata) values(e,'Фрагмент сценария','text','slide',250,12,'{}'::jsonb);
insert into public.polls(event_id,title,kind,source,max_length,position,metadata) values(e,'Какой вопрос или проблему из педагогической практики вы хотели бы обсудить?','text','live',250,13,'{"default_category":"вопрос"}'::jsonb);
end $$;
select id,code,title from public.events;
