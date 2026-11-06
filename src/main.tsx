import React, { useState, useEffect, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { QRCodeSVG } from "qrcode.react";
import { board, action, vote, demo, db } from "./api";
import {
  questions,
  percentage,
  normaliseAggregate,
  csv,
  exportRows,
  parseAggregates,
  report,
  type Board,
  type Poll,
  type ResponseRow,
} from "./model";
import "./style.css";
import { appPath, base, defaultCode, routeParts } from "./routes";
import { exportXlsx } from "./xlsx";
const parts = routeParts,
  mode = parts[1] || "home";
function download(name: string, data: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function App() {
  const [code, setCode] = useState(
      parts[2] || localStorage.getItem("eventCode") || defaultCode,
    ),
    [b, setB] = useState<Board>(),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [updated, setUpdated] = useState(""),
    [busy, setBusy] = useState(false),
    [auth, setAuth] = useState(demo),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState("");
  const refresh = useCallback(async () => {
    try {
      const v = await board(code, mode === "admin");
      setB(v);
      setError("");
      setUpdated(
        new Date().toLocaleTimeString("ru-RU", { timeZone: "Europe/Moscow" }),
      );
    } catch (e) {
      setError(String((e as Error).message));
    }
  }, [code, auth]);
  useEffect(() => {
    if (db)
      db.auth
        .getSession()
        .then(({ data }) =>
          setAuth(!!data.session && !data.session.user.is_anonymous),
        );
  }, []);
  useEffect(() => {
    if (mode === "help" || mode === "home" || (mode === "admin" && !auth))
      return;
    refresh();
    const id = setInterval(refresh, 4000);
    return () => clearInterval(id);
  }, [refresh, auth]);
  async function run(op: string, payload: Record<string, unknown> = {}) {
    setBusy(true);
    try {
      await action(code, op, payload);
      await refresh();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const poll = b?.polls.find(
    (p) => p.status === "open" || p.status === "results",
  );
  const origin = import.meta.env.VITE_PUBLIC_ORIGIN;
  let joinUrl = "";
  try {
    const u = new URL(origin);
    if (
      u.protocol === "https:" &&
      !["localhost", "127.0.0.1"].includes(u.hostname)
    )
      joinUrl = u.origin + base + "join/" + encodeURIComponent(code);
  } catch {}
  if (mode === "help")
    return (
      <main className="help">
        <a href={appPath("/")}>← Главная</a>
        <h1>Вместе — проще</h1>
        <h2>Участнику</h2>
        <p>
          Откройте QR организатора. Выберите ответ в открытом вопросе и нажмите
          «Отправить». Регистрация, телефон и почта не нужны.
        </p>
        <p>
          Не указывайте личные данные и сведения о конкретных детях. Тексты
          появляются на экране только после одобрения.
        </p>
        <h2>Пять кликов перед началом</h2>
        <ol>
          <li>Войдите в панель организатора.</li>
          <li>Загрузите код подготовленного события.</li>
          <li>Откройте нужный вопрос.</li>
          <li>Откройте режим проектора.</li>
          <li>Нажмите «Во весь экран» и проверьте ответ с телефона.</li>
        </ol>
        <h2>Если нет связи</h2>
        <p>
          Дождитесь восстановления сети и повторите отправку. Повтор в той же
          сессии не добавляет голос. Для резервного сценария голосуйте руками,
          ответы собирайте на бумаге. Заранее скачайте PNG и CSV.
        </p>
        <h2>Приватность</h2>
        <p>
          В таблицах приложения нет имён, IP, user-agent и геолокации.
          Используется случайная анонимная идентичность Supabase Auth. Новое
          устройство или очистка браузера позволяют проголосовать повторно.
          Инфраструктурные журналы провайдеров регулируются их настройками;
          организатор должен проверить их отдельно.
        </p>
        <p>
          Результаты относятся только к ответившим; множественный выбор даёт
          больше отметок, чем участников.
        </p>
      </main>
    );
  if (mode === "home")
    return (
      <>
        <Header />
        <main>
          <span className="eyebrow">Всероссийский форум «Вместе о важном»</span>
          <h1>
            Большие смыслы.
            <br />
            <em>Живой разговор.</em>
          </h1>
          <p>13 ноября 2026 · 10:00–11:30 МСК · Ольга Петровна Доремидова</p>
          <p className="lead">
            Методическая сессия: от вопросов — к работающим решениям.
          </p>
          <div className="grid">
            <a className="tile coral" href={appPath("/join/" + defaultCode)}>
              <span>01 / УЧАСТВОВАТЬ</span>
              <h2>
                Ваш голос
                <br />
                имеет значение ↗
              </h2>
              <p>Ответить на вопрос с телефона</p>
            </a>
            <a className="tile blue" href={appPath("/screen/" + defaultCode)}>
              <span>02 / ОБЩАЯ ДОСКА</span>
              <h2>
                Посмотреть,
                <br />
                что нас объединяет ↗
              </h2>
              <p>Вопросы, результаты и практики</p>
            </a>
          </div>
          <a className="quiet" href={appPath("/admin")}>
            Панель организатора →
          </a>
        </main>
      </>
    );
  return (
    <>
      {mode !== "screen" && <Header />}
      {demo && (
        <div className="demo">
          ДЕМО · Вымышленные данные · Только этот браузер, без общего сервера
        </div>
      )}
      <main className={mode === "screen" ? "projector" : ""}>
        {mode === "admin" && (
          <>
            <h1>Пульт разговора</h1>
            {!auth ? (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  const r = await db!.auth.signInWithPassword({
                    email,
                    password,
                  });
                  setError(r.error?.message || "");
                  setAuth(!r.error);
                  setPassword("");
                  setBusy(false);
                }}
              >
                <label>
                  Почта организатора
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </label>
                <label>
                  Пароль
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </label>
                <button disabled={busy}>Войти</button>
                <button
                  type="button"
                  disabled={busy || !email}
                  onClick={async () => {
                    setBusy(true);
                    const { error } = await db!.auth.signInWithOtp({
                      email,
                      options: {
                        shouldCreateUser: false,
                        emailRedirectTo: location.origin + appPath("/admin"),
                      },
                    });
                    setError(error?.message || "");
                    setNotice(
                      error
                        ? ""
                        : "Если адрес организатора настроен, письмо со ссылкой для входа отправлено. Проверьте почту.",
                    );
                    setBusy(false);
                  }}
                >
                  Войти по ссылке из письма
                </button>
              </form>
            ) : (
              <div className="toolbar">
                <label>
                  Код события
                  <input
                    value={code}
                    onChange={(e) => {
                      setB(undefined);
                      setCode(e.target.value);
                      localStorage.setItem("eventCode", e.target.value);
                    }}
                  />
                </label>
                <button onClick={refresh}>Загрузить</button>
                {!demo && (
                  <button
                    onClick={async () => {
                      await db!.auth.signOut();
                      setAuth(false);
                      setB(undefined);
                    }}
                  >
                    Выйти
                  </button>
                )}
                <span>{b?.role}</span>
              </div>
            )}
          </>
        )}
        {notice && (
          <p role="status" className="card">
            {notice}
          </p>
        )}
        {error && (
          <div className="error" role="alert">
            Нет связи или операция отклонена: {error}
            <button onClick={refresh}>Попробовать снова</button>
          </div>
        )}
        {b && (
          <>
            {mode === "admin" ? (
              <Admin b={b} busy={busy} run={run} setCode={setCode} />
            ) : (
              <>
                <div className="session">
                  <span>ВМЕСТЕ О ВАЖНОМ / МЕТОДИЧЕСКАЯ СЕССИЯ</span>
                  {mode === "screen" && (
                    <button
                      className="quiet"
                      onClick={() =>
                        document.documentElement.requestFullscreen()
                      }
                    >
                      Во весь экран ⛶
                    </button>
                  )}
                </div>
                {b.hidden || !poll ? (
                  <section className="waiting">
                    <span className="eyebrow">
                      Место для утверждённого логотипа
                    </span>
                    <h1>
                      Живой
                      <br />
                      <em>разговор</em>
                    </h1>
                    <p>Слушаем. Обсуждаем. Находим решения.</p>
                    <p>Следующий вопрос скоро появится здесь.</p>
                    {mode === "screen" &&
                      (joinUrl ? (
                        <div className="qr">
                          <QRCodeSVG value={joinUrl} size={180} />
                          <p>
                            Откройте камеру
                            <br />и присоединяйтесь
                          </p>
                        </div>
                      ) : (
                        <p className="note">
                          QR появится после настройки настоящего опубликованного
                          адреса.
                        </p>
                      ))}
                  </section>
                ) : (
                  <>
                    <div className="poll-heading">
                      <span className="pill">
                        {poll.status === "open"
                          ? "● Идёт голосование"
                          : "Итоги разговора"}
                      </span>
                      <h1>{poll.title}</h1>
                      {poll.source === "live" && (
                        <p>Один ответ — одна короткая фраза</p>
                      )}
                      {mode === "screen" &&
                        poll.source === "live" &&
                        joinUrl && <QRCodeSVG value={joinUrl} size={130} />}
                    </div>
                    {mode === "join" &&
                    poll.status === "open" &&
                    poll.source === "live" ? (
                      <Participant key={poll.id} poll={poll} code={code} />
                    ) : mode === "join" ? (
                      <p>
                        Сейчас слушаем ответы в зале. Цифровой опрос закрыт.
                      </p>
                    ) : (
                      <Results poll={poll} />
                    )}
                  </>
                )}
              </>
            )}
            <footer>
              <span>Обновлено: {updated} · каждые 4 секунды</span>
              {mode !== "admin" && (
                <button className="quiet" onClick={refresh}>
                  Обновить ↻
                </button>
              )}
            </footer>
          </>
        )}
        {!b && !error && auth && <p>Загружаем…</p>}
      </main>
    </>
  );
}
function Header() {
  return (
    <header>
      <a className="brand" href={appPath("/")}>
        <span className="brand-icon">↗</span>Живой разговор
      </a>
      <a href={appPath("/help")}>Как это работает ↗</a>
    </header>
  );
}
function Participant({ poll, code }: { poll: Poll; code: string }) {
  const [choices, setChoices] = useState<string[]>([]),
    [text, setText] = useState(""),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false);
  return done ? (
    <section className="thanks">
      <span>✓</span>
      <h2>Спасибо, ответ принят</h2>
      <p>Ваш голос — часть общего разговора.</p>
    </section>
  ) : (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        setStatus("Отправка…");
        try {
          await vote(code, poll, choices, text);
          setDone(true);
        } catch (e) {
          setStatus((e as Error).message + " · попробуйте снова");
        } finally {
          setBusy(false);
        }
      }}
    >
      {poll.source === "oral" && poll.title.includes("Что изменилось") && (
        <h2>Назвали участники</h2>
      )}
      {poll.kind === "text" ? (
        <>
          <label htmlFor="answer">
            Не указывайте личные данные и сведения о конкретных детях
          </label>
          <textarea
            id="answer"
            maxLength={poll.max_length}
            value={text}
            onChange={(e) => setText(e.target.value)}
            required
          />
          <p className="note">
            {text.length} / {poll.max_length} · Ответ пройдёт модерацию
          </p>
        </>
      ) : (
        <>
          <p>
            {poll.kind === "multi"
              ? "Можно выбрать несколько вариантов"
              : "Выберите один вариант"}
          </p>
          <div className="choices">
            {poll.options.map((o, i) => (
              <label
                key={o.id}
                className={
                  choices.includes(o.id) ? "choice selected" : "choice"
                }
              >
                <input
                  type={poll.kind === "single" ? "radio" : "checkbox"}
                  name="answer"
                  checked={choices.includes(o.id)}
                  onChange={() =>
                    setChoices(
                      poll.kind === "single"
                        ? [o.id]
                        : choices.includes(o.id)
                          ? choices.filter((x) => x !== o.id)
                          : [...choices, o.id],
                    )
                  }
                />
                <b>{String.fromCharCode(А + i)}</b>
                {o.label}
              </label>
            ))}
          </div>
        </>
      )}
      <button
        className="primary"
        disabled={busy || (!text.trim() && !choices.length)}
      >
        {busy ? "Отправка…" : "Отправить ответ ↗"}
      </button>
      <p role="status">{status}</p>
    </form>
  );
}
const А = 1040;
function Results({ poll }: { poll: Poll }) {
  if (poll.status !== "results" && poll.source !== "live")
    return (
      <section className="card">
        <h2>Разговор продолжается</h2>
        <p>Результаты появятся по команде организатора.</p>
      </section>
    );
  if (poll.source === "institute" || poll.source === "slide")
    return <Special poll={poll} />;
  if (poll.source === "preforum" && poll.kind !== "text" && !poll.n)
    return (
      <section className="card">
        <h2>Ожидаем результаты опроса</h2>
        <p>Реальный агрегат ещё не загружен.</p>
      </section>
    );
  return (
    <section>
      {poll.source === "oral" ? (
        <p>Ответы участников, записанные во время обсуждения</p>
      ) : poll.source === "preforum" && !poll.n ? (
        <p>Ожидаем результаты опроса</p>
      ) : poll.kind === "text" ? (
        <p>Короткие фразы · одобрено модератором</p>
      ) : (
        <div className="result-meta">
          <strong>N = {poll.n}</strong>
          <span>
            Результаты по ответившим участникам
            {poll.imported_n ? " · импорт агрегатов" : ""}
          </span>
        </div>
      )}
      {poll.source === "preforum" && (
        <p>
          {poll.metadata?.preliminary === "yes" && (
            <strong>Предварительные результаты · </strong>
          )}
          {poll.metadata?.cutoff} · {poll.metadata?.sample}
        </p>
      )}
      {poll.source === "oral" && poll.title.includes("Что изменилось") && (
        <h2>Назвали участники</h2>
      )}
      {poll.kind === "text" ? (
        <div className="cards">
          {poll.source === "oral" && poll.title.includes("Что удалось") ? (
            ["практика", "проблема"].map((cat) => (
              <section key={cat}>
                <h2>{cat === "практика" ? "Сработало" : "Было трудно"}</h2>
                {poll.cards
                  .filter((c) => c.category === cat)
                  .map((c) => (
                    <article className="card" key={c.id}>
                      <p>{c.text}</p>
                    </article>
                  ))}
              </section>
            ))
          ) : poll.cards.length ? (
            poll.cards.slice(0, 10).map((c) => (
              <article className="card" key={c.id}>
                <span className="pill">{categoryName(c.category)}</span>
                <p>{c.text}</p>
              </article>
            ))
          ) : (
            <p>Одобренные ответы появятся здесь.</p>
          )}
        </div>
      ) : (
        <div className="bars">
          {poll.options.map((o, i) => (
            <div className="bar-row" key={o.id}>
              <div className="bar-label">
                <span>{o.label}</span>
                <b>
                  {o.count} <small>{percentage(o.count, poll.n)}%</small>
                </b>
              </div>
              <div className="track">
                <div
                  className={"fill color" + i}
                  style={{
                    width: `${poll.n ? Math.min(100, (o.count / poll.n) * 100) : 0}%`,
                  }}
                />
              </div>
            </div>
          ))}
          {poll.kind === "multi" && (
            <p>
              Участников: {poll.n} · Отметок:{" "}
              {poll.options.reduce((n, o) => n + o.count, 0)} · Множественный
              выбор
            </p>
          )}
        </div>
      )}
    </section>
  );
}
function Admin({
  b,
  busy,
  run,
  setCode,
}: {
  b: Board;
  busy: boolean;
  run: (op: string, p?: Record<string, unknown>) => Promise<unknown>;
  setCode: (c: string) => void;
}) {
  const [edit, setEdit] = useState<Poll | null | undefined>(),
    [filter, setFilter] = useState("all"),
    [meta, setMeta] = useState<Poll>(),
    [aggregate, setAggregate] = useState<Poll>();
  const canEdit = b.role === "admin",
    canModerate = canEdit || b.role === "moderator",
    canOperate = canEdit || b.role === "operator";
  return (
    <>
      <div className="toolbar">
        <a href={appPath("/screen/" + b.code)} target="_blank" rel="noreferrer">
          Проектор ↗
        </a>
        <a href={appPath("/join/" + b.code)} target="_blank" rel="noreferrer">
          Участник ↗
        </a>
        <span>
          {b.title} · {b.date} · {b.timezone}
        </span>
      </div>
      <div className="toolbar">
        {canOperate && (
          <>
            <button
              disabled={busy}
              onClick={() => run("hide", { hidden: !b.hidden })}
            >
              {b.hidden ? "Показать экран" : "Скрыть экран"}
            </button>
            <button
              className="danger"
              disabled={busy}
              onClick={() => run("emergency")}
            >
              Аварийно закрыть всё
            </button>
          </>
        )}
        {canEdit && (
          <>
            <button
              onClick={() => {
                const title = prompt("Название события", b.title);
                if (title)
                  run("event", { title, date: b.date, status: b.status });
              }}
            >
              Переименовать
            </button>
            <button
              onClick={() => {
                const date = prompt("Дата YYYY-MM-DD", b.date);
                if (date)
                  run("event", { title: b.title, date, status: b.status });
              }}
            >
              Дата
            </button>
            <button
              onClick={() =>
                run("event", {
                  title: b.title,
                  date: b.date,
                  status: "archived",
                })
              }
            >
              Архивировать
            </button>
            {!demo && (
              <button
                onClick={async () => {
                  const title = prompt("Название нового события");
                  if (!title) return;
                  try {
                    const { data, error } = await db!.rpc("create_event", {
                      p_title: title,
                      p_date: "2026-11-13",
                      p_questions: questions,
                    });
                    if (error) throw error;
                    setCode(data);
                    localStorage.setItem("eventCode", data);
                  } catch (e) {
                    alert((e as Error).message);
                  }
                }}
              >
                Создать событие по сценарию 13 ноября
              </button>
            )}
          </>
        )}
        {demo && (
          <button
            onClick={() => {
              if (confirm("Сбросить только вымышленные данные?")) run("reset");
            }}
          >
            Очистить демонстрационные данные
          </button>
        )}
      </div>
      {meta && (
        <MetadataEditor
          poll={meta}
          close={() => setMeta(undefined)}
          save={async (metadata) => {
            if (await run("metadata", { id: meta.id, metadata }))
              setMeta(undefined);
          }}
        />
      )}
      {aggregate && (
        <AggregateEditor
          key={aggregate.id}
          poll={aggregate}
          close={() => setAggregate(undefined)}
          save={async (payload) => {
            if (await run("import", payload)) setAggregate(undefined);
          }}
        />
      )}
      <Capture b={b} run={run} />
      <h2>
        Сценарий сессии{" "}
        <span className="muted">/ {b.polls.length} вопросов</span>
      </h2>
      {b.polls.map((p, i) => (
        <article className="poll-admin card" key={p.id}>
          <div>
            <span className="eyebrow">
              {String(i + 1).padStart(2, "0")} / {p.source} / {p.kind} ·{" "}
              {p.status} · N={p.n}
            </span>
            <h3>{p.title}</h3>
          </div>
          <div className="toolbar">
            {canOperate &&
              (["open", "closed", "results", "prepared"] as const).map((s) => (
                <button
                  disabled={busy || p.status === s}
                  key={s}
                  onClick={() => run("status", { id: p.id, status: s })}
                >
                  {
                    {
                      open: "Открыть",
                      closed: "Закрыть",
                      results: "Показать итоги",
                      prepared: "Подготовить",
                    }[s]
                  }
                </button>
              ))}
            {canEdit && (
              <>
                <button onClick={() => setEdit(p)}>Изменить</button>
                {p.source === "preforum" && p.kind === "single" && (
                  <>
                    <button onClick={() => setAggregate(p)}>
                      Обновить срез
                    </button>
                    <label className="file-button">
                      Импорт CSV / JSON
                      <input
                        type="file"
                        accept=".csv,.json"
                        onChange={async (e) => {
                          try {
                            const f = e.target.files?.[0];
                            if (f) await importFile(f, p, run);
                          } catch (err) {
                            alert((err as Error).message);
                          }
                          e.target.value = "";
                        }}
                      />
                    </label>
                  </>
                )}
              </>
            )}
            <button
              onClick={() =>
                download(
                  "aggregate.csv",
                  csv([
                    ["категория", "число"],
                    ...p.options.map((o) => [o.label, o.count]),
                  ]),
                )
              }
            >
              CSV итогов
            </button>
            <button onClick={() => savePNG(p)}>PNG итогов</button>
            {canEdit && (
              <button onClick={() => setMeta(p)}>Источник / слайд</button>
            )}
            {canEdit && p.title === "Фрагмент сценария" && (
              <label className="file-button">
                Загрузить PNG/JPG
                <input
                  type="file"
                  accept="image/png,image/jpeg"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    if (f.size > 2000000) {
                      alert("Максимум 2 МБ");
                      return;
                    }
                    const reader = new FileReader();
                    reader.onload = () =>
                      run("metadata", {
                        id: p.id,
                        metadata: { image: reader.result },
                      });
                    reader.readAsDataURL(f);
                  }}
                />
              </label>
            )}
          </div>
        </article>
      ))}
      {canEdit && (
        <button onClick={() => setEdit(null)}>+ Добавить вопрос</button>
      )}
      {edit !== undefined && (
        <PollEditor
          poll={edit}
          close={() => setEdit(undefined)}
          save={async (p) => {
            if (await run("save_poll", p)) setEdit(undefined);
          }}
        />
      )}
      {canModerate && (
        <>
          <h2>Очередь модерации</h2>
          <label>
            Статус
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              {["all", "pending", "approved", "hidden"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          {(b.responses ?? [])
            .filter((r) => filter === "all" || r.status === filter)
            .map((r) => (
              <Moderate
                key={r.id + r.text + r.status + r.tags + r.resolution}
                row={r}
                run={run}
                busy={busy}
              />
            ))}
          {!b.responses?.length && <p>Новых ответов пока нет.</p>}
        </>
      )}
      {canEdit && (
        <>
          <h2>Итоговая памятка</h2>
          <p>
            Выгрузки доступны только администратору. Перед передачей редактору
            проверьте тексты.
          </p>
          <div className="toolbar">
            <button
              onClick={() =>
                download(
                  "event.csv",
                  csv(exportRows(b)),
                  "text/csv;charset=utf-8",
                )
              }
            >
              CSV · Excel
            </button>
            <button
              onClick={() =>
                exportXlsx(b).catch(() =>
                  alert("Не удалось создать XLSX. Попробуйте CSV."),
                )
              }
            >
              XLSX · Excel
            </button>
            <button
              onClick={() => {
                const { role, ...clean } = b;
                download(
                  "event.json",
                  JSON.stringify(clean, null, 2),
                  "application/json",
                );
              }}
            >
              JSON
            </button>
            <button onClick={() => download("memo.md", report(b))}>
              Markdown
            </button>
          </div>
        </>
      )}
    </>
  );
}
function PollEditor({
  poll,
  save,
  close,
}: {
  poll: Poll | null;
  save: (p: Record<string, unknown>) => void;
  close: () => void;
}) {
  const [title, setTitle] = useState(poll?.title || ""),
    [kind, setKind] = useState(poll?.kind || "single"),
    [labels, setLabels] = useState(
      poll?.options.map((o) => o.label).join("\n") || "",
    ),
    [max, setMax] = useState(poll?.max_length || 250);
  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        save({
          id: poll?.id,
          title,
          kind,
          source: poll?.source || "oral",
          labels: labels
            .split("\n")
            .map((x) => x.trim())
            .filter(Boolean),
          max_length: max,
        });
      }}
    >
      <h2>Редактор вопроса</h2>
      <label>
        Вопрос
        <input
          required
          maxLength={500}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label>
        Тип
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as Poll["kind"])}
        >
          <option value="single">Один ответ</option>
          <option value="multi">Несколько ответов</option>
          <option value="text">Открытый ответ</option>
        </select>
      </label>
      {kind === "text" ? (
        <label>
          Лимит символов
          <input
            type="number"
            min="1"
            max="300"
            value={max}
            onChange={(e) => setMax(Number(e.target.value))}
          />
        </label>
      ) : (
        <label>
          От 2 до 6 вариантов, по одному в строке
          <textarea
            value={labels}
            onChange={(e) => setLabels(e.target.value)}
            required
          />
        </label>
      )}
      <button>Сохранить</button>
      <button type="button" onClick={close}>
        Отмена
      </button>
    </form>
  );
}
function Moderate({
  row,
  run,
  busy,
}: {
  row: ResponseRow;
  run: (op: string, p: Record<string, unknown>) => void;
  busy: boolean;
}) {
  const [text, setText] = useState(row.text),
    [category, setCategory] = useState(row.category),
    [tags, setTags] = useState(row.tags),
    [resolution, setResolution] = useState(row.resolution);
  return (
    <article className="card">
      <span className="eyebrow">
        {row.status} ·{" "}
        {new Date(row.created_at).toLocaleString("ru-RU", {
          timeZone: "Europe/Moscow",
        })}
      </span>
      <label>
        Текст (оригинал сохраняется в закрытом аудите)
        <textarea
          maxLength={300}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <div className="toolbar">
        <label>
          Категория
          <select
            value={category}
            onChange={(e) =>
              setCategory(e.target.value as ResponseRow["category"])
            }
          >
            {["проблема", "практика", "решение", "вопрос", "для памятки"].map(
              (x) => (
                <option key={x}>{x}</option>
              ),
            )}
          </select>
        </label>
        <label>
          Теги
          <input
            maxLength={200}
            value={tags}
            onChange={(e) => setTags(e.target.value)}
          />
        </label>
        <label>
          Решение
          <select
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
          >
            <option>требуется ответ</option>
            <option>решено</option>
          </select>
        </label>
        {["approved", "hidden", "pending"].map((s, i) => (
          <button
            disabled={busy}
            key={s}
            onClick={() =>
              run("moderate", {
                id: row.id,
                text,
                category,
                tags,
                resolution,
                status: s,
              })
            }
          >
            {["Одобрить", "Скрыть", "В очередь"][i]}
          </button>
        ))}
      </div>
    </article>
  );
}
function savePNG(p: Poll) {
  const c = document.createElement("canvas");
  c.width = 1920;
  c.height = 1080;
  const x = c.getContext("2d")!;
  x.fillStyle = "#fff8f3";
  x.fillRect(0, 0, 1920, 1080);
  x.fillStyle = "#202020";
  x.font = "bold 48px sans-serif";
  const words = p.title.split(" ");
  let line = "",
    y = 90;
  for (const w of words) {
    if (x.measureText(line + w).width > 1700) {
      x.fillText(line, 80, y);
      line = "";
      y += 60;
    }
    line += w + " ";
  }
  x.fillText(line, 80, y);
  x.font = "32px sans-serif";
  x.fillText(
    p.source === "oral"
      ? "Ответы участников, записанные во время обсуждения"
      : p.source === "preforum" && !p.n
        ? "Ожидаем результаты опроса"
        : `Результаты по ответившим участникам · N=${p.n}`,
    80,
    y + 70,
  );
  p.options.forEach((o, i) => {
    const yy = y + 150 + i * 105;
    x.fillStyle = "#202020";
    x.fillText(
      `${o.label} — ${o.count} (${percentage(o.count, p.n)}%)`,
      80,
      yy,
    );
    x.fillStyle = "#FF553E";
    x.fillRect(80, yy + 15, p.n ? (1600 * o.count) / p.n : 0, 22);
  });
  if (p.kind === "text") {
    x.font = "36px sans-serif";
    p.cards.slice(0, 8).forEach((card, i) => {
      x.fillStyle = "#202020";
      x.fillText(card.text, 80, y + 160 + i * 85, 1750);
    });
  }
  x.fillStyle = "#202020";
  x.font = "24px sans-serif";
  x.fillText(
    `${demo ? "ДЕМО · " : ""}Источник: ${p.source || ""} · ${p.metadata?.cutoff || ""} · ${p.source === "oral" ? "Ответы участников, записанные во время обсуждения" : ""}`,
    80,
    1040,
    1750,
  );
  const a = document.createElement("a");
  a.download = "aggregate.png";
  a.href = c.toDataURL();
  a.click();
}
createRoot(document.getElementById("root")!).render(<App />);
function categoryName(c: string) {
  return (
    (
      {
        проблема: "Было трудно / Трудности",
        практика: "Сработало / Работающие практики",
        решение: "Открытия и решения",
        вопрос: "Вопросы без ответа",
        "для памятки": "Для памятки",
      } as Record<string, string>
    )[c] || c
  );
}
function Capture({
  b,
  run,
}: {
  b: Board;
  run: (o: string, p: Record<string, unknown>) => Promise<unknown>;
}) {
  const [id, setId] = useState(
      b.polls.find((p) => p.source === "oral")?.id || "",
    ),
    [text, setText] = useState(""),
    [category, setCategory] = useState("практика");
  return (
    <form
      className="card"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await run("oral", { id, text, category })) setText("");
      }}
    >
      <h2>Фиксация ответов из зала</h2>
      <p>
        Только реально прозвучавшие реплики. Публикация после подтверждения
        модератором.
      </p>
      <label>
        Источник / вопрос
        <select value={id} onChange={(e) => setId(e.target.value)}>
          {b.polls
            .filter(
              (p) =>
                p.source === "oral" ||
                p.source === "preforum" ||
                p.title === "Темы и подходы",
            )
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.source} · {p.title}
              </option>
            ))}
        </select>
      </label>
      <label>
        Не указывайте личные данные
        <textarea
          value={text}
          maxLength={300}
          required
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <div className="toolbar">
        {["проблема", "практика", "решение", "вопрос"].map((c) => (
          <button
            type="button"
            aria-pressed={category === c}
            key={c}
            onClick={() => setCategory(c)}
          >
            {categoryName(c)}
          </button>
        ))}
      </div>
      <button disabled={!text.trim()}>В очередь модерации</button>
    </form>
  );
}
function Special({ poll }: { poll: Poll }) {
  const [zoom, setZoom] = useState(1);
  const m = poll.metadata || {};
  if (poll.source === "institute")
    return m.confirmed === "yes" && m.sample ? (
      <section className="card">
        <h2>Позитивное отношение · 2023 → 2026</h2>
        <p>Школьники 14–17 лет: 60% → 77%</p>
        <p>Родители: 68% → 75%</p>
        <p>Педагоги: 79% → 94%</p>
        <p>Материалы мониторинга Института, 2023/2026 · {m.sample}</p>
        <small>
          Отдельный показатель; не объединяется с полезностью занятий.
        </small>
      </section>
    ) : (
      <p>
        Ожидаем подтверждение источника и методологии мониторинга
        организаторами.
      </p>
    );
  if (poll.title === "Фрагмент сценария")
    return m.image && /^data:image\/(png|jpeg);base64,/.test(m.image) ? (
      <section>
        <label>
          Приближение
          <input
            type="range"
            min="1"
            max="4"
            step="0.1"
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          />
        </label>
        <div className="image-window">
          <img
            src={m.image}
            alt="Загруженный организатором реальный фрагмент сценария"
            style={{ width: zoom * 100 + "%", maxWidth: "none" }}
          />
        </div>
      </section>
    ) : (
      <p>Фрагмент утверждённого сценария будет добавлен</p>
    );
  return (
    <section>
      <div className="cards">
        <article className="card">
          <h2>1–5 классы · 2 ноября</h2>
          <p>{m.young || "«Как звучит Россия? Ко Дню народного единства»"}</p>
        </article>
        <article className="card">
          <h2>6–11 классы и 1 курс СПО · 2 ноября</h2>
          <p>
            {m.older ||
              "«Земский староста Кузьма Минин и князь Дмитрий Пожарский»"}
          </p>
        </article>
      </div>
      <p>Общая ценностная основа — разные способы раскрытия темы</p>
      <p>
        Источник: официальный сайт проекта · дата проверки в предоставленном ТЗ:
        06.11.2026. Для СПО 2–4 курсов — отдельный блок.
      </p>
      {m.body && <p>{m.body}</p>}
      <h2>Что говорят педагоги?</h2>
      {poll.cards.map((c) => (
        <p key={c.id}>{c.text}</p>
      ))}
    </section>
  );
}
async function importFile(
  f: File,
  p: Poll,
  run: (o: string, p: Record<string, unknown>) => Promise<unknown>,
) {
  const raw = await f.text();
  let counts,
    n,
    cutoff,
    sample,
    preliminary = "yes";
  if (f.name.endsWith(".json")) {
    const data = normaliseAggregate(JSON.parse(raw), p);
    counts = data.counts;
    n = data.n;
    cutoff = data.cutoff;
    sample = data.sample;
    preliminary = data.preliminary;
  } else {
    counts = parseAggregates(raw, p);
    n = Number(prompt("Число реальных ответов N (без пробных строк 2–8)"));
    cutoff = prompt("Дата и время среза");
    sample = prompt("Описание выборки и исключения тестов");
  }
  if (!Number.isInteger(n) || n < 1 || !cutoff || !sample)
    throw Error("Нужны N, время среза и описание выборки");
  if (!confirm("Агрегат обезличен, пробные ответы исключены вручную?")) return;
  await run("import", {
    id: p.id,
    counts,
    n,
    cutoff,
    sample,
    preliminary,
    expected_version: Number(p.metadata?.version || 0),
  });
}
function MetadataEditor({
  poll,
  close,
  save,
}: {
  poll: Poll;
  close: () => void;
  save: (m: Record<string, string>) => Promise<unknown>;
}) {
  const [m, setM] = useState(poll.metadata || {});
  const fields =
    poll.source === "institute"
      ? [["sample", "Подтверждённый источник и методология"]]
      : poll.source === "slide"
        ? [
            ["young", "Тема для 1–5 классов"],
            ["older", "Тема для 6–11 классов и 1 курса СПО"],
            ["body", "Комментарий редактора"],
          ]
        : [
            ["cutoff", "Дата и время среза"],
            ["sample", "Описание выборки и исключения пробных ответов"],
          ];
  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        save(m);
      }}
    >
      <h2>Источник / {poll.title}</h2>
      {fields.map(([key, title]) => (
        <label key={key}>
          {title}
          <textarea
            value={m[key] || ""}
            onChange={(e) => setM({ ...m, [key]: e.target.value })}
            required={key === "sample"}
          />
        </label>
      ))}
      {poll.source === "institute" && (
        <label>
          <input
            type="checkbox"
            checked={m.confirmed === "yes"}
            onChange={(e) =>
              setM({ ...m, confirmed: e.target.checked ? "yes" : "no" })
            }
          />{" "}
          Организатор подтвердил значения, источник и методологию; разрешаю
          показ
        </label>
      )}
      <button>Сохранить</button>
      <button type="button" onClick={close}>
        Отмена
      </button>
    </form>
  );
}
function AggregateEditor({
  poll,
  close,
  save,
}: {
  poll: Poll;
  close: () => void;
  save: (p: Record<string, unknown>) => Promise<void>;
}) {
  const [counts, setCounts] = useState(
      poll.options.map((o) => ({ id: o.id, count: o.count })),
    ),
    [n, setN] = useState(poll.imported_n || poll.n || 0),
    [cutoff, setCutoff] = useState(poll.metadata?.cutoff || ""),
    [sample, setSample] = useState(poll.metadata?.sample || ""),
    [preliminary, setPreliminary] = useState(
      poll.metadata?.preliminary !== "no",
    ),
    [saving, setSaving] = useState(false);
  const total = counts.reduce((a, c) => a + c.count, 0),
    valid =
      Number.isInteger(n) &&
      n > 0 &&
      total === n &&
      counts.length >= 2 &&
      counts.every(
        (c) => Number.isInteger(c.count) && c.count >= 0 && c.count <= 1000000,
      );
  return (
    <form
      className="card aggregate-editor"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
          await save({
            id: poll.id,
            counts,
            n,
            cutoff,
            sample,
            preliminary: preliminary ? "yes" : "no",
            expected_version: Number(poll.metadata?.version || 0),
          });
        } finally {
          setSaving(false);
        }
      }}
    >
      <h2>Обновление предварительного среза</h2>
      <p>
        {poll.title}. Предыдущая версия сохраняется в закрытой истории.
        Изменения видны без повторной публикации сайта.
      </p>
      {!counts.length && <p>Сначала задайте варианты через «Изменить».</p>}
      {poll.options.map((o, i) => (
        <label key={o.id}>
          {o.label}
          <input
            type="number"
            min="0"
            max="1000000"
            value={counts[i].count}
            required
            onChange={(e) =>
              setCounts(
                counts.map((c, j) =>
                  j === i ? { ...c, count: Number(e.target.value) } : c,
                ),
              )
            }
          />
        </label>
      ))}
      <label>
        Число реальных ответов N
        <input
          type="number"
          min="1"
          max="1000000"
          value={n}
          required
          onChange={(e) => setN(Number(e.target.value))}
        />
      </label>
      <p role="status">
        Сумма по категориям: {total}.{" "}
        {total !== n ? "Сумма должна совпадать с N." : "Сумма совпадает с N."}
      </p>
      <label>
        Дата и время среза (МСК; если время неизвестно, укажите это)
        <input
          value={cutoff}
          maxLength={200}
          required
          onChange={(e) => setCutoff(e.target.value)}
        />
      </label>
      <label>
        Описание выборки и исключения тестовых строк
        <textarea
          value={sample}
          maxLength={1000}
          required
          onChange={(e) => setSample(e.target.value)}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={preliminary}
          onChange={(e) => setPreliminary(e.target.checked)}
        />{" "}
        Предварительные результаты
      </label>
      <button disabled={!valid || saving}>
        {saving ? "Сохраняем…" : "Сохранить срез"}
      </button>
      <button type="button" onClick={close}>
        Отмена
      </button>
    </form>
  );
}
