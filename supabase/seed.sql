-- Run once after migration, as postgres. Fictional/demo responses are NOT inserted.
do $$ declare e uuid; begin
insert into public.events(title,date) values ('Живой разговор · Вместе о важном','2026-11-12') returning id into e;
insert into public.polls(event_id,title,kind,source,max_length,position) values(e,'Что для вас «Разговоры о важном»?','text','live',80,0);
insert into public.polls(event_id,title,kind,source,max_length,position) values(e,'Что изменилось в «Разговорах о важном» в 2026/2027 учебном году?','text','oral',250,1);
insert into public.polls(event_id,title,kind,source,max_length,position) values(e,'Какие темы уже провели? Что удалось? Где было трудно?','text','oral',250,2);
insert into public.polls(event_id,title,kind,source,max_length,position) values(e,'Почему не хватает времени? Что в сценарии помогает подготовке?','text','oral',250,3);
insert into public.polls(event_id,title,kind,source,max_length,position) values(e,'Видео показано, но дети не говорили. Что изменить?','text','oral',250,4);
insert into public.polls(event_id,title,kind,source,max_length,position) values(e,'Подросток: «Это всё красивые слова». Какую первую фразу скажете?','text','oral',250,5);
insert into public.polls(event_id,title,kind,source,max_length,position) values(e,'Как продолжаете разговор после звонка?','text','oral',250,6);
insert into public.polls(event_id,title,kind,source,max_length,position) values(e,'Чего не хватает','single','preforum',250,7);
insert into public.polls(event_id,title,kind,source,max_length,position) values(e,'Подготовка к занятию','single','preforum',250,8);
insert into public.polls(event_id,title,kind,source,max_length,position) values(e,'Вопрос экспертам','text','preforum',300,9);
insert into public.polls(event_id,title,kind,source,max_length,position) values(e,'Материалы мониторинга Института, 2023/2026','text','institute',250,10);
insert into public.polls(event_id,title,kind,source,max_length,position) values(e,'Темы и подходы','text','slide',250,11);
insert into public.polls(event_id,title,kind,source,max_length,position) values(e,'Фрагмент сценария','text','slide',250,12);
end $$;
select id,code,title from public.events;
-- After creating an organiser in Authentication > Users, bootstrap their role:
-- insert into public.admin_roles(user_id,event_id,role) values ('ACTUAL_AUTH_USER_UUID','ACTUAL_EVENT_UUID','admin');
-- Add operator/moderator with separate accounts and the same event UUID.
