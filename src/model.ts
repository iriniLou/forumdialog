export type Status = "prepared" | "open" | "closed" | "results";
export type Category =
  | "проблема"
  | "практика"
  | "решение"
  | "вопрос"
  | "для памятки";
export type Poll = {
  id: string;
  title: string;
  kind: "single" | "multi" | "text";
  source?: "live" | "oral" | "preforum" | "institute" | "slide";
  metadata?: Record<string, string>;
  max_length: number;
  status: Status;
  options: { id: string; label: string; count: number }[];
  n: number;
  imported_n?: number;
  cards: { id: string; text: string; category: Category }[];
};
export type ResponseRow = {
  id: string;
  poll_id: string;
  text: string;
  status: "pending" | "approved" | "hidden";
  category: Category;
  tags: string;
  resolution: string;
  created_at: string;
};
export type Board = {
  id: string;
  code: string;
  title: string;
  date: string;
  timezone: string;
  status: string;
  hidden: boolean;
  polls: Poll[];
  responses?: ResponseRow[];
  audit?: unknown[];
  role?: string;
};
export const questions = [
  {
    title: "Так что же для вас «Разговоры о важном»?",
    kind: "text",
    max: 80,
    source: "live",
  },
  ...[
    "Что изменилось в «Разговорах о важном» в 2026/2027 учебном году?",
    "Какие темы уже провели? Что удалось? Где было трудно?",
    "Почему не хватает времени? Что в сценарии помогает подготовке?",
    "Видео показано, но дети не говорили. Что изменить?",
    "Подросток: «Это всё красивые слова». Какую первую фразу скажете?",
    "Как продолжаете разговор после звонка?",
  ].map((title) => ({ title, kind: "text", max: 250, source: "oral" })),
  { title: "Чего не хватает", kind: "single", source: "preforum" },
  { title: "Подготовка к занятию", kind: "single", source: "preforum" },
  { title: "Вопрос экспертам", kind: "text", max: 300, source: "preforum" },
  {
    title: "Материалы мониторинга Института, 2023/2026",
    kind: "text",
    source: "institute",
  },
  { title: "Темы и подходы", kind: "text", source: "slide" },
  { title: "Фрагмент сценария", kind: "text", source: "slide" },
  {
    title:
      "Какой вопрос или проблему из педагогической практики вы хотели бы обсудить?",
    kind: "text",
    max: 250,
    source: "live",
    category: "вопрос",
  },
] as const;
export function initialDemo(): Board {
  return {
    id: "demo",
    code: "DEMO",
    title: "Живой разговор",
    date: "2026-11-13",
    timezone: "Europe/Moscow",
    status: "active",
    hidden: false,
    role: "admin",
    responses: [],
    polls: questions.map((q, i) => ({
      id: `p${i}`,
      title: q.title,
      kind: q.kind as Poll["kind"],
      source: q.source as Poll["source"],
      max_length: "max" in q ? q.max! : 250,
      metadata: ("category" in q
        ? { default_category: q.category }
        : {}) as Record<string, string>,
      status: i === 0 ? "open" : "prepared",
      n: 0,
      options: [],
      cards: [],
    })),
  };
}
export function csvCell(v: unknown) {
  const s = String(v ?? "");
  return (
    '"' + (/^[=+@\-\t\r]/.test(s) ? "'" + s : s).replaceAll('"', '""') + '"'
  );
}
export function csv(rows: unknown[][]) {
  return "\uFEFF" + rows.map((r) => r.map(csvCell).join(";")).join("\r\n");
}
export function parseAggregates(input: string, poll: Poll) {
  const lines = input
    .replace(/^\uFEFF/, "")
    .trim()
    .split(/\r?\n/);
  const counts = new Map<string, number>();
  for (const line of lines) {
    const m = line.match(/^"?(.+?)"?[;,](\d+)$/);
    if (!m) {
      if (line === lines[0] && /категория|category/i.test(line)) continue;
      throw Error("Формат: категория;число (целое неотрицательное)");
    }
    const label = m[1].replaceAll('""', '"');
    if (!poll.options.some((o) => o.label === label) || counts.has(label))
      throw Error("Неизвестная или повторяющаяся категория");
    const n = Number(m[2]);
    if (!Number.isSafeInteger(n) || n > 1000000)
      throw Error("Слишком большое число");
    counts.set(label, n);
  }
  if (!counts.size) throw Error("Нет данных");
  return poll.options.map((o) => ({
    id: o.id,
    count: counts.get(o.label) ?? 0,
  }));
}
export function report(board: Board) {
  return [
    "# " + board.title,
    ...["проблема", "решение", "практика", "вопрос", "для памятки"].map(
      (c) =>
        "\n## " +
        (
          {
            проблема: "Трудности",
            практика: "Работающие практики",
            решение: "Решения",
            вопрос: "Вопросы без ответа",
            "для памятки": "Для памятки",
          } as Record<string, string>
        )[c] +
        "\n" +
        (board.responses ?? [])
          .filter((r) => r.category === c)
          .map(
            (r) =>
              `- [${board.polls.find((p) => p.id === r.poll_id)?.source} / ${r.created_at} / ${r.status} / ${r.resolution}] ${r.text.replaceAll("\n", " ")} (${r.tags})`,
          )
          .join("\n"),
    ),
  ].join("\n");
}
export function exportRows(b: Board) {
  return [
    [
      "event_id",
      "question",
      "source",
      "time",
      "category",
      "status",
      "text / option",
      "count",
      "tags",
      "resolution",
    ],
    ...b.polls.flatMap((p) =>
      p.options.map((o) => [
        b.id,
        p.title,
        p.source,
        p.metadata?.cutoff,
        "",
        "aggregate",
        o.label,
        o.count,
        "",
        "",
      ]),
    ),
    ...(b.responses ?? []).map((r) => [
      b.id,
      b.polls.find((p) => p.id === r.poll_id)?.title,
      b.polls.find((p) => p.id === r.poll_id)?.source,
      r.created_at,
      r.category,
      r.status,
      r.text,
      "",
      r.tags,
      r.resolution,
    ]),
  ];
}
