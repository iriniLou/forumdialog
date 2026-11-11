import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { initialSessionDemo, cloudWords } from "../../src/session";

test("two stages: cloud moderation and frequency, final spotlight, closure and complete scoped exports", async ({
  browser,
}) => {
  test.setTimeout(45000);
  const context = await browser.newContext(),
    participant = await context.newPage(),
    second = await context.newPage(),
    admin = await context.newPage(),
    screen = await context.newPage();
  await participant.setViewportSize({ width: 360, height: 780 });
  await screen.setViewportSize({ width: 1920, height: 1080 });
  await participant.goto("/join/DEMO");
  await expect(
    participant.getByRole("heading", {
      name: "Так что для вас «Разговоры о важном»?",
    }),
  ).toBeVisible();
  await participant.locator("textarea").fill("Диалог");
  await participant.getByRole("button", { name: "Отправить ответ" }).click();
  await expect(participant.getByText("Спасибо, ответ принят")).toBeVisible();
  await second.goto("/join/DEMO");
  await second.locator("textarea").fill("диалог");
  await second.getByRole("button", { name: "Отправить ответ" }).click();
  await expect(second.getByText("Спасибо, ответ принят")).toBeVisible();
  await admin.goto("/admin");
  await expect(admin.getByRole("tab")).toHaveCount(2);
  await expect(admin.locator(".poll-admin")).toHaveCount(0);
  await screen.goto("/screen/DEMO");
  await expect(
    screen.locator(".folder-cloud text").filter({ hasText: "диалог" }),
  ).toHaveCount(0);
  await admin
    .getByRole("button", { name: "Одобрить", exact: true })
    .first()
    .click();
  await screen.reload();
  await expect(screen.locator("text[data-word-count]")).toHaveAttribute(
    "data-word-count",
    "1",
  );
  await admin
    .getByRole("button", { name: "Одобрить", exact: true })
    .first()
    .click();
  await screen.reload();
  await expect(screen.locator("text[data-word-count]")).toHaveAttribute(
    "data-word-count",
    "2",
  );
  const png = admin.waitForEvent("download");
  await admin.getByRole("button", { name: "Скачать облако PNG" }).click();
  expect(
    (await readFile((await (await png).path())!)).subarray(1, 4).toString(),
  ).toBe("PNG");
  await admin.getByRole("tab", { name: /Письменные ответы/ }).click();
  await admin
    .getByRole("button", { name: "Открыть приём", exact: true })
    .click();
  await participant.reload();
  await expect(participant.locator("textarea")).toHaveAttribute(
    "maxlength",
    "300",
  );
  const finalText = (
    "ДЕМО: В понедельник начну с вопроса детям. " +
    "Дам время высказаться и обсудить разные позиции. ".repeat(3)
  ).trim();
  await participant.locator("textarea").fill(finalText);
  await participant.screenshot({
    path: "docs/screenshots/08-final-participant.png",
    fullPage: true,
  });
  await participant.getByRole("button", { name: "Отправить ответ" }).click();
  await expect(participant.getByText("Спасибо, ответ принят")).toBeVisible();
  await participant.screenshot({
    path: "docs/screenshots/09-final-accepted.png",
    fullPage: true,
  });
  await screen.reload();
  await expect(screen.getByText(finalText, { exact: true })).toHaveCount(0);
  await expect(
    admin.getByRole("button", { name: "Одобрить и показать", exact: true }),
  ).toBeVisible();
  await admin
    .getByRole("button", { name: "Одобрить и показать", exact: true })
    .click();
  await admin
    .getByLabel("Финальный вопрос", { exact: true })
    .fill("Какой шаг сделаете в понедельник?");
  await admin
    .getByRole("button", { name: "Сохранить вопрос", exact: true })
    .click();
  await expect(
    admin.getByRole("heading", { name: "Какой шаг сделаете в понедельник?" }),
  ).toBeVisible();
  await screen.reload();
  await expect(screen.locator(".featured-answer")).toHaveText(finalText);
  await screen.screenshot({
    path: "docs/screenshots/06-final-answer.png",
    fullPage: true,
  });
  await expect(screen.locator(".cards .pill")).toHaveCount(0);
  await admin
    .getByRole("button", { name: "Завершить приём", exact: true })
    .click();
  await participant.reload();
  await expect(participant.locator("textarea")).toHaveCount(0);
  await expect(participant.getByText("Приём ответов завершён.")).toBeVisible();
  await admin.getByRole("button", { name: /Одобрены/ }).click();
  await expect(admin.locator(".session-response")).toHaveCount(1);
  await admin.screenshot({
    path: "docs/screenshots/07-two-stage-admin.png",
    fullPage: true,
  });
  const csv = admin.waitForEvent("download");
  await admin.getByRole("button", { name: "Скачать CSV", exact: true }).click();
  const csvText = await readFile((await (await csv).path())!, "utf8");
  expect(csvText).toContain(finalText);
  expect(csvText).not.toContain("Диалог");
  const xlsx = admin.waitForEvent("download");
  await admin
    .getByRole("button", { name: "Скачать Excel", exact: true })
    .click();
  expect(
    (await readFile((await (await xlsx).path())!)).subarray(0, 2).toString(),
  ).toBe("PK");
  await admin.getByRole("button", { name: "Скрыть", exact: true }).click();
  await screen.reload();
  await expect(screen.getByText(finalText, { exact: true })).toHaveCount(0);
  expect(
    await participant.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await context.close();
});

test("projector folder lays out a large moderated cloud without clipping", async ({
  page,
}) => {
  const b = initialSessionDemo();
  const phrases = [
    "диалог",
    "доверие",
    "ценности",
    "выбор",
    "сотрудничество",
    "поддержка",
    "важные вопросы",
    "уважение",
    "открытость",
    "семья",
    "школа",
    "общее дело",
    "время вместе",
    "будущее",
    "размышление",
    "честный разговор",
    "понимание",
    "участие",
    "любопытство",
    "поступок",
    "связь поколений",
    "внимание",
    "доброта",
    "жизнь школы",
    "возможность услышать",
  ];
  b.polls[0].cloud_words = cloudWords(
    Array.from({ length: 350 }, (_, i) => ({
      text: phrases[i < 175 ? i % 5 : i % phrases.length],
    })),
  );
  await page
    .context()
    .addInitScript(
      (b) => localStorage.setItem("forumdialog.demo.v1", JSON.stringify(b)),
      b,
    );
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/screen/DEMO");
  await expect(page.locator("text[data-word-count]")).toHaveCount(
    phrases.length,
  );
  expect(b.polls[0].cloud_words.reduce((n, w) => n + w.count, 0)).toBe(350);
  const svg = page.locator(".folder-cloud");
  const bounds = await svg.boundingBox();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(1080);
  await page.screenshot({
    path: "docs/screenshots/05-cloud.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.screenshot({
    path: "docs/screenshots/10-cloud-350-laptop.png",
    fullPage: true,
  });
});
