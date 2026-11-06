import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QRCodeSVG } from "qrcode.react";
import { readFileSync, writeFileSync } from "node:fs";
const verified = JSON.parse(
  readFileSync("deployment-evidence/public-verified.json", "utf8"),
);
const { origin, base, code } = verified;
if (
  origin !== process.env.VITE_PUBLIC_ORIGIN ||
  code !== process.env.VITE_EVENT_CODE
)
  throw Error("The intended production site has not been verified");
const join = origin + base + "join/" + encodeURIComponent(code),
  admin = origin + base + "admin",
  screen = origin + base + "screen/" + encodeURIComponent(code);
writeFileSync(
  "deployment-evidence/participant-qr.svg",
  renderToStaticMarkup(
    React.createElement(QRCodeSVG, {
      value: join,
      size: 640,
      marginSize: 4,
      level: "M",
    }),
  ),
);
writeFileSync(
  "deployment-evidence/links.md",
  `# Живой разговор · 13 ноября, 10:00–11:30 МСК\n\n- Участникам: ${join}\n- Организатору: ${admin}\n- Проектор: ${screen}\n- Репозиторий: https://github.com/${process.env.GITHUB_REPOSITORY}\n\nВход организатора — по приглашению, отправленному на почту владельца организации Supabase. Можно запросить новую ссылку кнопкой «Войти по ссылке из письма». Пароль не публикуется. QR находится в этом же архиве.\n\nПеред форумом: открыть вопрос, проверить отправку с двух телефонов, одобрить одну фразу, убедиться в её появлении на проекторе. При сбое сети использовать заранее сохранённые PNG и исходную презентацию.\n`,
);

console.log(
  `::notice title=Verified forum links::${join} | ${admin} | ${screen}`,
);
