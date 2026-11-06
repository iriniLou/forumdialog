import { readFileSync } from "node:fs";
const quote = (v) => "'" + String(v).replaceAll("'", "''") + "'";
export function validateSnapshot(snapshot) {
  if (
    !snapshot.cutoff ||
    !snapshot.sample ||
    !Array.isArray(snapshot.polls) ||
    snapshot.polls.length !== 2
  )
    throw Error("Incomplete preforum snapshot");
  for (const p of snapshot.polls) {
    if (
      !Number.isInteger(p.n) ||
      p.n < 1 ||
      p.categories.length < 2 ||
      p.categories.length > 6 ||
      new Set(p.categories.map((c) => c.label)).size !== p.categories.length ||
      p.categories.some(
        (c) => !c.label || !Number.isInteger(c.count) || c.count < 0,
      ) ||
      p.categories.reduce((a, c) => a + c.count, 0) !== p.n
    )
      throw Error("Invalid preforum counts");
  }
  return snapshot;
}
export function buildSnapshotImportSql(
  eventId,
  adminId,
  snapshot = JSON.parse(readFileSync("data/preforum-2026-11-06.json", "utf8")),
) {
  validateSnapshot(snapshot);
  return `do $forum_import$ declare p public.polls; item jsonb; cat jsonb; pos int; payload jsonb; code text; begin
 select e.code into code from public.events e where id=${quote(eventId)}::uuid;
 perform set_config('request.jwt.claim.sub',${quote(adminId)},true);
 for item in select * from jsonb_array_elements(${quote(JSON.stringify(snapshot.polls))}::jsonb) loop
 select * into p from public.polls where event_id=${quote(eventId)}::uuid and source='preforum' and kind='single' and (metadata->>'aggregate_key'=item->>'key' or title=item->>'title' or (item->>'key'='preparation' and title='Подготовка к занятию'));
 if p.id is null then raise exception 'Не найден вопрос предварительной анкеты';end if;
 -- This bootstrap is one-time only. An organiser's later slice always wins.
 if p.imported_n is not null then continue;end if;
 if not exists(select 1 from public.options where poll_id=p.id) then
 pos:=0;for cat in select * from jsonb_array_elements(item->'categories') loop
 insert into public.options(event_id,poll_id,label,position) values(p.event_id,p.id,cat->>'label',pos);pos:=pos+1;end loop;
 end if;
 if (select count(*) from public.options where poll_id=p.id)<>jsonb_array_length(item->'categories') or exists(select 1 from public.options o where o.poll_id=p.id and not exists(select 1 from jsonb_array_elements(item->'categories') c where c->>'label'=o.label)) then raise exception 'Категории изменены организатором; автозагрузка остановлена';end if;
 update public.polls set title=case when title='Подготовка к занятию' and item->>'key'='preparation' then item->>'title' else title end,metadata=metadata||jsonb_build_object('aggregate_key',item->>'key') where id=p.id;
 select jsonb_build_object('id',p.id,'n',(item->>'n')::int,'cutoff',${quote(snapshot.cutoff)},'sample',${quote(snapshot.sample)},'preliminary','yes','expected_version',coalesce((p.metadata->>'version')::int,0),'counts',(select jsonb_agg(jsonb_build_object('id',o.id,'count',(c->>'count')::int) order by o.position) from public.options o join jsonb_array_elements(item->'categories') c on c->>'label'=o.label where o.poll_id=p.id)) into payload;
 perform public.manage_event(code,'import',payload);
 end loop;end $forum_import$;`;
}
