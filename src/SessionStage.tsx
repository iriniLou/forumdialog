import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { Poll } from "./model";
import { WordCloud } from "./WordCloud";
import { sessionStage } from "./session";

export function SessionScreen({
  poll,
  joinUrl,
}: {
  poll: Poll;
  joinUrl: string;
}) {
  const stage = sessionStage(poll),
    [page, setPage] = useState(0);
  const featured = poll.cards.find(
    (c) => c.id === poll.metadata?.featured_response,
  );
  const totalPages = Math.ceil(poll.cards.length / 6),
    current = Math.min(page, Math.max(0, totalPages - 1));
  return (
    <section className="session-screen" data-stage={stage}>
      <div className="stage-heading">
        <h1>{poll.title}</h1>
        {joinUrl && <QRCodeSVG value={joinUrl} size={140} />}
      </div>
      {stage === "cloud" ? (
        <WordCloud words={poll.cloud_words || []} id={poll.id} />
      ) : featured ? (
        <article
          className="featured-answer"
          data-response-id={featured.id}
          style={{
            fontSize:
              featured.text.length > 600
                ? "clamp(24px, 1.6vw, 32px)"
                : featured.text.length > 300
                  ? "clamp(26px, 2vw, 40px)"
                  : "clamp(28px, 2.8vw, 52px)",
          }}
        >
          {featured.text}
        </article>
      ) : poll.cards.length ? (
        <>
          <div className="cards final-answers">
            {poll.cards.slice(current * 6, current * 6 + 6).map((c) => (
              <article className="card" key={c.id}>
                <p>{c.text}</p>
              </article>
            ))}
          </div>
          {totalPages > 1 && (
            <nav className="answer-pages" aria-label="Страницы ответов">
              <button
                disabled={current === 0}
                onClick={() => setPage(current - 1)}
              >
                ← Назад
              </button>
              <span>
                {current + 1} / {totalPages}
              </span>
              <button
                disabled={current >= totalPages - 1}
                onClick={() => setPage(current + 1)}
              >
                Далее →
              </button>
            </nav>
          )}
        </>
      ) : (
        <p className="stage-empty">Ждём ваши ответы</p>
      )}
    </section>
  );
}
