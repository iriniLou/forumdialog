import { useState } from "react";
import type { Board, Poll, ResponseRow } from "./model";
import { csv, exportRows } from "./model";
import { appPath } from "./routes";
import { exportXlsx } from "./xlsx";
import { sessionStage, stageBoard } from "./session";
import { WordCloud, downloadCloud } from "./WordCloud";

type Run = (op: string, p?: Record<string, unknown>) => Promise<unknown>;
function downloadCsv(board: Board, name: string) {
  const url = URL.createObjectURL(
    new Blob([csv(exportRows(board))], { type: "text/csv;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function SessionAdmin({
  b,
  busy,
  run,
}: {
  b: Board;
  busy: boolean;
  run: Run;
}) {
  const stages = b.polls.filter((p) => sessionStage(p)),
    [selected, setSelected] = useState(
      stages.find((p) => p.status === "open" || p.status === "results")?.id ||
        stages[0]?.id,
    ),
    [filter, setFilter] = useState("pending"),
    [error, setError] = useState("");
  const p = stages.find((p) => p.id === selected) || stages[0],
    rows = (b.responses || []).filter((r) => r.poll_id === p?.id);
  const operate = b.role === "admin" || b.role === "operator",
    moderate = b.role === "admin" || b.role === "moderator";
  if (!p) return null;
  const isCloud = sessionStage(p) === "cloud",
    scope = stageBoard(b, p);
  const filtered = rows
    .filter((r) => filter === "all" || r.status === filter)
    .slice()
    .reverse();
  return (
    <section className="session-admin">
      <div className="toolbar session-links">
        <a href={appPath("/screen/" + b.code)} target="_blank" rel="noreferrer">
          Проектор ↗
        </a>
        <a href={appPath("/join/" + b.code)} target="_blank" rel="noreferrer">
          Участник ↗
        </a>
        {operate && (
          <button
            disabled={busy}
            onClick={() => run("hide", { hidden: !b.hidden })}
          >
            {b.hidden ? "Показать экран" : "Скрыть экран"}
          </button>
        )}
      </div>
      <div className="stage-tabs" role="tablist" aria-label="Два этапа сессии">
        {stages.map((stage) => (
          <button
            key={stage.id}
            role="tab"
            aria-selected={stage.id === p.id}
            onClick={() => {
              setSelected(stage.id);
              setFilter("pending");
            }}
          >
            <span>
              {sessionStage(stage) === "cloud" ? "01 / СЛАЙД 3" : "02 / ФИНАЛ"}
            </span>
            <strong>
              {sessionStage(stage) === "cloud"
                ? "Облако слов"
                : "Письменные ответы"}
            </strong>
            <small>
              {stage.status === "open"
                ? "Приём открыт"
                : stage.status === "results"
                  ? "Приём завершён"
                  : "Готов к запуску"}
            </small>
          </button>
        ))}
      </div>
      <h2>{p.title}</h2>
      {operate && (
        <div className="toolbar stage-controls">
          <button
            className="primary"
            disabled={busy || p.status === "open"}
            onClick={() => run("stage", { id: p.id, status: "open" })}
          >
            Открыть приём
          </button>
          <button
            disabled={busy || p.status !== "open"}
            onClick={() => run("stage", { id: p.id, status: "results" })}
          >
            Завершить приём
          </button>
          {!isCloud && (
            <button
              disabled={busy}
              onClick={() => run("present", { id: p.id, response_id: null })}
            >
              Показать последние ответы
            </button>
          )}
        </div>
      )}
      {moderate && (
        <>
          <div className="export-bar">
            <strong>
              Сохранить {isCloud ? "облако и ответы" : "ответы финала"}
            </strong>
            <button
              onClick={() =>
                downloadCsv(
                  scope,
                  isCloud ? "oblako-otvety.csv" : "final-otvety.csv",
                )
              }
            >
              Скачать CSV
            </button>
            <button
              onClick={async () => {
                try {
                  await exportXlsx(
                    scope,
                    isCloud ? "oblako-otvety.xlsx" : "final-otvety.xlsx",
                  );
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Скачать Excel
            </button>
            {isCloud && (
              <button
                onClick={async () => {
                  try {
                    await downloadCloud(p.id);
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Скачать облако PNG
              </button>
            )}
          </div>
          <p className="note">
            Выгрузка содержит все ответы этого этапа, включая ожидающие и
            скрытые, с их статусами.
          </p>
          {error && <p role="alert">{error}</p>}
          <h2>Очередь модерации</h2>
          <div className="toolbar queue-filters">
            {[
              ["pending", "Ожидают"],
              ["approved", "Одобрены"],
              ["hidden", "Скрыты"],
              ["all", "Все"],
            ].map(([value, label]) => (
              <button
                key={value}
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {label} ·{" "}
                {
                  rows.filter((r) => value === "all" || r.status === value)
                    .length
                }
              </button>
            ))}
          </div>
          <div className="moderation-list">
            {filtered.length ? (
              filtered.map((row) => (
                <SessionResponse
                  key={row.id}
                  row={row}
                  poll={p}
                  run={run}
                  busy={busy}
                  canPresent={operate}
                />
              ))
            ) : (
              <p className="note">
                {filter === "pending"
                  ? "Нет ответов, ожидающих одобрения."
                  : "Здесь пока нет ответов."}
              </p>
            )}
          </div>
        </>
      )}
      {isCloud && (
        <details className="cloud-preview" open>
          <summary>Предпросмотр облака</summary>
          <WordCloud words={p.cloud_words || []} id={p.id} />
        </details>
      )}
    </section>
  );
}

function SessionResponse({
  row,
  poll,
  run,
  busy,
  canPresent,
}: {
  row: ResponseRow;
  poll: Poll;
  run: Run;
  busy: boolean;
  canPresent: boolean;
}) {
  const [text, setText] = useState(row.text),
    isFinal = sessionStage(poll) === "final";
  async function update(status: string, present = false) {
    const ok = await run("moderate", {
      id: row.id,
      text,
      status,
      category: row.category,
      tags: row.tags,
      resolution: row.resolution,
    });
    if (ok && present)
      await run("present", { id: poll.id, response_id: row.id });
  }
  return (
    <article
      className="card session-response"
      data-testid={"response-" + row.id}
      data-response-status={row.status}
    >
      <label>
        Ответ
        <textarea
          aria-label="Текст ответа"
          value={text}
          maxLength={poll.max_length}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <div className="toolbar">
        <button
          disabled={busy || !text.trim()}
          onClick={() => update("approved", isFinal && canPresent)}
        >
          {isFinal && canPresent ? "Одобрить и показать" : "Одобрить"}
        </button>
        {isFinal && canPresent && row.status === "approved" && (
          <button
            disabled={busy}
            onClick={() => run("present", { id: poll.id, response_id: row.id })}
          >
            На экран
          </button>
        )}
        <button disabled={busy} onClick={() => update("hidden")}>
          Скрыть
        </button>
        {row.status !== "pending" && (
          <button disabled={busy} onClick={() => update("pending")}>
            Вернуть в очередь
          </button>
        )}
      </div>
    </article>
  );
}
