import { sessionQuestions } from "../src/session.ts";
const quote = (v) => "'" + String(v).replaceAll("'", "''") + "'";
export function buildSessionSql(eventId) {
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) throw Error("Invalid event UUID");
  return `do $$ declare session_event uuid := ${quote(eventId)}; stage_count int; begin
select count(*) into stage_count from public.polls where event_id=session_event and metadata->>'session_stage' in ('cloud','final');
if stage_count=0 then
update public.polls set status='closed',metadata=metadata||'{"archived":"true"}'::jsonb where event_id=session_event;
update public.events set hidden=true where id=session_event;
${sessionQuestions.map((q, i) => `insert into public.polls(event_id,title,kind,source,max_length,status,position,metadata) values(session_event,${quote(q.title)},'text','live',${q.max},'prepared',${i},jsonb_build_object('session_stage',${quote(q.stage)},'slide',${quote(q.slide)}));`).join("\n")}
elsif stage_count<>2 then raise exception 'Ожидались два этапа сессии; существующие данные не изменены';
end if;end $$;`;
}
