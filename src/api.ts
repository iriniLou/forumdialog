import { createClient } from "@supabase/supabase-js";
import { initialDemo, type Board, type Poll, type Category } from "./model";
const url = import.meta.env.VITE_SUPABASE_URL,
  key = import.meta.env.VITE_SUPABASE_ANON_KEY;
if (Boolean(url) !== Boolean(key))
  throw Error("Укажите обе переменные Supabase или удалите обе для демо");
export const db = url && key ? createClient(url, key) : null;
export const demo = !db;
if (import.meta.env.VITE_REQUIRE_BACKEND === "true" && !db)
  throw Error("Публикация остановлена: общая база не подключена");
const storage = "forumdialog.demo.v1";
const sessionKey = "forumdialog.demo.session";
let sid = sessionStorage.getItem(sessionKey);
if (!sid) {
  sid = crypto.randomUUID();
  sessionStorage.setItem(sessionKey, sid);
}
function read(): Board {
  return JSON.parse(localStorage.getItem(storage) || "null") ?? initialDemo();
}
function write(b: Board) {
  localStorage.setItem(storage, JSON.stringify(b));
}
async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await db!.rpc(name, args);
  if (error) throw Error(error.message);
  return data;
}
export async function board(code: string, admin = false): Promise<Board> {
  if (!db) {
    if (code !== "DEMO") throw Error("В демо доступно событие DEMO");
    const b = read();
    if (!admin) {
      delete b.responses;
      delete b.audit;
      delete b.imports;
      delete b.role;
      if (b.status !== "active") b.hidden = true;
      b.polls = b.hidden
        ? []
        : b.polls
            .filter((p) => p.status === "open" || p.status === "results")
            .map((p) =>
              p.status === "open"
                ? {
                    ...p,
                    n: 0,
                    options: p.options.map((o) => ({ ...o, count: 0 })),
                    cards: p.source === "live" ? p.cards : [],
                  }
                : p,
            );
    }
    return b;
  }
  return rpc(admin ? "admin_board" : "public_board", { p_code: code });
}
export async function vote(
  code: string,
  p: Poll,
  choices: string[],
  text: string,
) {
  if (db) {
    if (!(await db.auth.getSession()).data.session) {
      const r = await db.auth.signInAnonymously();
      if (r.error) throw r.error;
    }
    return rpc("submit_response", {
      p_code: code,
      p_poll: p.id,
      p_choices: choices,
      p_text: text,
    });
  }
  const b = read(),
    poll = b.polls.find((x) => x.id === p.id)!;
  if (b.status !== "active" || poll.source !== "live" || poll.status !== "open")
    throw Error("Опрос уже закрыт");
  const k = `vote:${sid}:${p.id}`;
  if (localStorage.getItem(k)) throw Error("Ответ этой сессии уже принят");
  if (p.kind === "text") {
    if (!text.trim() || text.length > p.max_length)
      throw Error("Проверьте длину ответа");
    b.responses!.push({
      id: crypto.randomUUID(),
      poll_id: p.id,
      text: text.trim(),
      status: "pending",
      category: (p.metadata?.default_category || "") as Category,
      tags: "",
      resolution: "требуется ответ",
      created_at: new Date().toISOString(),
    });
  } else {
    if (
      !choices.length ||
      (p.kind === "single" && choices.length !== 1) ||
      choices.some((c) => !poll.options.some((o) => o.id === c))
    )
      throw Error("Выберите вариант");
    poll.options.forEach((o) => {
      if (choices.includes(o.id)) o.count++;
    });
  }
  poll.n++;
  write(b);
  localStorage.setItem(k, "1");
}
export async function action(
  code: string,
  op: string,
  payload: Record<string, unknown> = {},
) {
  if (db)
    return rpc("manage_event", { p_code: code, p_op: op, p_payload: payload });
  let b = read();
  const p = b.polls.find((p) => p.id === payload.id);
  switch (op) {
    case "hide":
      b.hidden = Boolean(payload.hidden);
      break;
    case "emergency":
      b.hidden = true;
      b.polls.forEach((p) => {
        if (p.status === "open") p.status = "closed";
      });
      break;
    case "status":
      if (payload.status === "open" || payload.status === "results")
        b.polls.forEach((x) => {
          if (x.id !== p?.id && (x.status === "open" || x.status === "results"))
            x.status = "closed";
        });
      if (p) p.status = payload.status as Poll["status"];
      break;
    case "event":
      Object.assign(b, payload);
      break;
    case "save_poll": {
      const poll = {
        id: (payload.id as string) || crypto.randomUUID(),
        title: payload.title as string,
        kind: payload.kind as Poll["kind"],
        max_length: Number(payload.max_length),
        source: (payload.source || p?.source || "oral") as Poll["source"],
        metadata: p?.metadata || {},
        status: "prepared" as const,
        n: 0,
        cards: [],
        options: (payload.labels as string[]).map((label) => ({
          id: crypto.randomUUID(),
          label,
          count: 0,
        })),
      };
      if (p) {
        if (p.n || (b.responses || []).some((r) => r.poll_id === p.id))
          throw Error("Вопрос с ответами нельзя менять; создайте новый");
        Object.assign(p, poll);
      } else b.polls.push(poll);
      break;
    }
    case "moderate": {
      const r = b.responses!.find((r) => r.id === payload.id)!;
      b.audit ??= [];
      b.audit.push({
        response_id: r.id,
        original_text: r.text,
        previous_status: r.status,
        new_text: payload.text,
        new_status: payload.status,
        created_at: new Date().toISOString(),
      });
      Object.assign(r, payload);
      const poll = b.polls.find((p) => p.id === r.poll_id)!;
      poll.cards = b
        .responses!.filter(
          (x) => x.poll_id === r.poll_id && x.status === "approved",
        )
        .map((x) => ({
          id: x.id,
          text: x.text,
          category: x.category as Category,
        }))
        .slice(0, 10);
      break;
    }
    case "import":
      if (!p || p.source !== "preforum" || p.kind !== "single")
        throw Error("Импорт только в пустой вопрос предварительной анкеты");
      {
        const counts = payload.counts as { id: string; count: number }[];
        if (
          counts.length !== p.options.length ||
          new Set(counts.map((c) => c.id)).size !== counts.length ||
          counts.some(
            (c) =>
              !p.options.some((o) => o.id === c.id) ||
              !Number.isInteger(c.count) ||
              c.count < 0 ||
              c.count > 1000000,
          ) ||
          counts.reduce((a, c) => a + c.count, 0) !== Number(payload.n) ||
          Number(payload.n) < 1 ||
          !payload.cutoff ||
          !payload.sample
        )
          throw Error(
            "Проверьте категории, источник и сумму: она должна совпадать с N",
          );
        if (
          Number(payload.expected_version || 0) !==
          Number(p.metadata?.version || 0)
        )
          throw Error(
            "Срез уже обновлён другим организатором. Обновите страницу",
          );
        b.imports ??= [];
        b.imports.push({
          poll_id: p.id,
          before_data: {
            n: p.imported_n,
            metadata: p.metadata,
            counts: structuredClone(p.options),
          },
          after_data: payload,
          created_at: new Date().toISOString(),
        });
        for (const c of counts)
          p.options.find((o) => o.id === c.id)!.count = c.count;
        p.n = Number(payload.n);
        p.imported_n = p.n;
        p.metadata = {
          ...p.metadata,
          version: String(Number(p.metadata?.version || 0) + 1),
          preliminary: String(payload.preliminary || "yes"),
          cutoff: String(payload.cutoff),
          sample: String(payload.sample),
        };
      }
      break;
    case "metadata":
      if (p) p.metadata = payload.metadata as Record<string, string>;
      break;
    case "oral": {
      if (!p || p.source === "live")
        throw Error("Выберите вопрос из зала или до форума");
      b.responses!.push({
        id: crypto.randomUUID(),
        poll_id: p.id,
        text: String(payload.text).slice(0, 300),
        status: "pending",
        category: payload.category as Category,
        tags: "",
        resolution: "требуется ответ",
        created_at: new Date().toISOString(),
      });
      break;
    }
    case "reset":
      b = initialDemo();
      Object.keys(localStorage)
        .filter((k) => k.startsWith("vote:"))
        .forEach((k) => localStorage.removeItem(k));
      break;
    default:
      throw Error("Действие недоступно в демо");
  }
  write(b);
  return b.code;
}
