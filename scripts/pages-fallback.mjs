import { writeFileSync } from "node:fs";
const base = process.env.VITE_BASE_PATH || "/";
if (!/^\/[a-zA-Z0-9_/-]*\/$/.test(base) && base !== "/")
  throw Error("Invalid base path");
writeFileSync(
  (process.env.PAGES_OUTPUT_DIR || "dist") + "/404.html",
  `<!doctype html><html lang="ru"><meta charset="utf-8"><title>Живой разговор</title><p>Открываем страницу…</p><script>const b=${JSON.stringify(base)};const p=location.pathname.slice(b.length);if(/^(join\\/[a-zA-Z0-9_-]+|screen\\/[a-zA-Z0-9_-]+|admin|help)\\/?$/.test(p))location.replace(b+'?route='+encodeURIComponent(p)+location.hash);</script></html>`,
);
