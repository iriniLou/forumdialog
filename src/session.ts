import type { Board, Poll } from "./model";

export const sessionQuestions = [
  {
    title: "Так что для вас «Разговоры о важном»?",
    stage: "cloud",
    slide: "3",
    max: 50,
  },
  {
    title: "Что попробуете уже в ближайший понедельник?",
    stage: "final",
    slide: "34",
    max: 300,
  },
] as const;

export function sessionStage(p: Poll) {
  const stage = p.metadata?.session_stage;
  return stage === "cloud" || stage === "final" ? stage : undefined;
}

export function stageBoard(b: Board, p: Poll): Board {
  return {
    ...b,
    polls: [p],
    responses: (b.responses || []).filter((r) => r.poll_id === p.id),
    audit: undefined,
    imports: undefined,
  };
}

export function cloudWords(rows: { text: string }[]) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const text = row.text.trim().replace(/\s+/g, " ").toLocaleLowerCase("ru");
    if (text) counts.set(text, (counts.get(text) || 0) + 1);
  }
  return [...counts]
    .map(([text, count]) => ({ text, count }))
    .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text, "ru"));
}

export function initialSessionDemo(): Board {
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
    polls: sessionQuestions.map((q, i) => ({
      id: `session-${q.stage}`,
      title: q.title,
      kind: "text",
      source: "live",
      max_length: q.max,
      status: i === 0 ? "open" : "prepared",
      n: 0,
      options: [],
      cards: [],
      cloud_words: [],
      metadata: { session_stage: q.stage, slide: q.slide },
    })),
  };
}
