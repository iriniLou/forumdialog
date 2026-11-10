import { useMemo } from "react";
import { folderPath, layoutCloud, type CloudWord } from "./cloud-layout";

export function WordCloud({ words, id }: { words: CloudWord[]; id: string }) {
  const signature = JSON.stringify(words);
  const layout = useMemo(() => {
    const canvas = document.createElement("canvas"),
      ctx = canvas.getContext("2d")!;
    try {
      return {
        words: layoutCloud(JSON.parse(signature), (text, size) => {
          ctx.font = `700 ${size}px Arial`;
          return ctx.measureText(text).width;
        }),
        error: "",
      };
    } catch (e) {
      return { words: [], error: (e as Error).message };
    }
  }, [signature]);
  return (
    <div className="cloud-picture">
      <svg
        className="folder-cloud"
        data-cloud-id={id}
        viewBox="0 0 1000 1000"
        role="img"
        aria-label="Облако одобренных ответов в форме папки"
      >
        <path d={folderPath} fill="none" stroke="#ff553e" strokeWidth="16" />
        {layout.words.map((w) => (
          <text
            key={w.text}
            x={w.x}
            y={w.y}
            fontFamily="Arial, Helvetica, sans-serif"
            fontSize={w.size}
            fontWeight="700"
            textAnchor="middle"
            dominantBaseline="central"
            fill="#e94430"
            data-word-count={w.count}
            aria-label={`${w.text} — ${w.count}`}
          >
            {w.text}
          </text>
        ))}
        {!words.length && (
          <text
            x="500"
            y="520"
            textAnchor="middle"
            fontFamily="Arial, Helvetica, sans-serif"
            fontSize="28"
            fill="#6d635c"
          >
            Ждём ваши ответы
          </text>
        )}
      </svg>
      {layout.error && <p role="alert">{layout.error}</p>}
    </div>
  );
}

export async function downloadCloud(id: string) {
  const element = [
    ...document.querySelectorAll<SVGSVGElement>("svg[data-cloud-id]"),
  ].find((s) => s.dataset.cloudId === id);
  if (!element) throw Error("Откройте предпросмотр облака");
  const copy = element.cloneNode(true) as SVGSVGElement;
  copy.setAttribute("width", "2000");
  copy.setAttribute("height", "2000");
  const blob = new Blob([new XMLSerializer().serializeToString(copy)], {
      type: "image/svg+xml;charset=utf-8",
    }),
    url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = 2000;
    c.height = 2000;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#faf7f2";
    ctx.fillRect(0, 0, 2000, 2000);
    ctx.drawImage(img, 0, 0, 2000, 2000);
    const a = document.createElement("a");
    a.download = "oblako-slov.png";
    a.href = c.toDataURL("image/png");
    a.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
