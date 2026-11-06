import { test, expect } from "@playwright/test";
test("two participants, moderation, oral entry, hide and mobile layout", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const a = await context.newPage(),
    b = await context.newPage(),
    admin = await context.newPage(),
    screen = await context.newPage();
  await a.setViewportSize({ width: 360, height: 780 });
  await a.goto("/join/DEMO");
  await expect(
    a.getByRole("heading", {
      name: "Так что же для вас «Разговоры о важном»?",
    }),
  ).toBeVisible();
  await expect(a.locator("textarea")).toHaveAttribute("maxlength", "80");
  await a.screenshot({
    path: "docs/screenshots/01-participant.png",
    fullPage: true,
  });
  await a.locator("textarea").fill("ДЕМО: возможность услышать друг друга");
  await a.getByRole("button", { name: "Отправить ответ" }).click();
  await expect(a.getByText("Спасибо, ответ принят")).toBeVisible();
  await a.screenshot({
    path: "docs/screenshots/02-accepted.png",
    fullPage: true,
  });
  await b.goto("/join/DEMO");
  await b.locator("textarea").fill("ДЕМО: время для важных вопросов");
  await b.getByRole("button", { name: "Отправить ответ" }).click();
  await expect(b.getByText("Спасибо, ответ принят")).toBeVisible();
  await screen.setViewportSize({ width: 1920, height: 1080 });
  await screen.goto("/screen/DEMO");
  await expect(
    screen.getByText("ДЕМО: возможность услышать друг друга"),
  ).toHaveCount(0);
  await admin.goto("/admin");
  await expect(
    admin.getByRole("heading", { name: "Очередь модерации" }),
  ).toBeVisible();
  const row = admin
    .locator("article")
    .filter({ has: admin.locator("textarea") })
    .first();
  await row.getByRole("button", { name: "Одобрить", exact: true }).click();
  await screen.reload();
  await expect(
    screen.getByText("ДЕМО: возможность услышать друг друга"),
  ).toBeVisible();
  await screen.screenshot({
    path: "docs/screenshots/03-projector.png",
    fullPage: true,
  });
  await admin.screenshot({
    path: "docs/screenshots/04-moderation.png",
    fullPage: true,
  });
  await row.getByRole("button", { name: "Скрыть", exact: true }).click();
  await screen.reload();
  await expect(
    screen.getByText("ДЕМО: возможность услышать друг друга"),
  ).toHaveCount(0);
  const capture = admin
    .locator("form")
    .filter({ hasText: "Фиксация ответов из зала" });
  await capture
    .locator("textarea")
    .fill("ДЕМО: дать ученикам время на разговор");
  await capture.getByRole("button", { name: "В очередь модерации" }).click();
  await expect(admin.locator("article textarea").last()).toHaveValue(
    "ДЕМО: дать ученикам время на разговор",
  );
  await admin
    .locator("article")
    .filter({ has: admin.locator("textarea") })
    .last()
    .getByRole("button", { name: "Одобрить", exact: true })
    .click();
  const oral = admin
    .locator(".poll-admin")
    .filter({ hasText: "Что изменилось" });
  await oral
    .getByRole("button", { name: "Показать итоги", exact: true })
    .click();
  await screen.reload();
  await expect(
    screen.getByText("ДЕМО: дать ученикам время на разговор"),
  ).toBeVisible();
  await expect(
    screen.getByText("Ответы участников, записанные во время обсуждения"),
  ).toBeVisible();
  await expect(screen.getByText(/N =/)).toHaveCount(0);
  await admin
    .locator(".poll-admin")
    .first()
    .getByRole("button", { name: "Открыть", exact: true })
    .click();
  await a.goto("/join/DEMO");
  await a.locator("textarea").fill("Повтор");
  await a.getByRole("button", { name: "Отправить ответ" }).click();
  await expect(a.getByRole("status")).toContainText("уже принят");
  expect(
    await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  await admin.getByRole("button", { name: "Аварийно закрыть всё" }).click();
  await screen.reload();
  await expect(
    screen.getByText("Следующий вопрос скоро появится здесь."),
  ).toBeVisible();
  await context.close();
});

test("preforum waiting, verified aggregate import, precise N and CSV export", async ({
  page,
}) => {
  await page.goto("/admin");
  const poll = page
    .locator(".poll-admin")
    .filter({ hasText: "Чего не хватает" });
  await poll
    .getByRole("button", { name: "Показать итоги", exact: true })
    .click();
  const screen = await page.context().newPage();
  await screen.goto("/screen/DEMO");
  await expect(
    screen.getByRole("heading", { name: "Ожидаем результаты опроса" }),
  ).toBeVisible();
  await expect(screen.locator(".bars")).toHaveCount(0);
  await poll.getByRole("button", { name: "Изменить", exact: true }).click();
  const editor = page
    .locator("form")
    .filter({ has: page.getByRole("heading", { name: "Редактор вопроса" }) });
  await editor.locator("textarea").fill("Первая категория\nВторая категория");
  await editor.getByRole("button", { name: "Сохранить", exact: true }).click();
  page.on("dialog", async (dialog) => {
    if (dialog.type() === "confirm") await dialog.accept();
    else if (dialog.message().includes("Число реальных"))
      await dialog.accept("5");
    else if (dialog.message().includes("Дата"))
      await dialog.accept("2026-11-13T09:00:00+03:00");
    else
      await dialog.accept(
        "Тестовая выборка, тестовые строки исключены вручную",
      );
  });
  await poll.locator("input[type=file]").setInputFiles({
    name: "aggregate.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "категория;число\nПервая категория;2\nВторая категория;3",
    ),
  });
  await expect(poll).toContainText("N=5");
  await poll
    .getByRole("button", { name: "Показать итоги", exact: true })
    .click();
  await screen.reload();
  await expect(screen.getByText("N = 5", { exact: true })).toBeVisible();
  await expect(screen.getByText("40%", { exact: true })).toBeVisible();
  await expect(screen.getByText("60%", { exact: true })).toBeVisible();
  const file = page.waitForEvent("download");
  await page.getByRole("button", { name: "CSV · Excel", exact: true }).click();
  const download = await file;
  const stream = await download.createReadStream();
  let chunks = [];
  for await (const c of stream!) chunks.push(c);
  const data = Buffer.concat(chunks);
  expect([...data.subarray(0, 3)]).toEqual([239, 187, 191]);
  expect(data.toString("utf8")).toContain("preforum");
  const xlsxFile = page.waitForEvent("download");
  await page.getByRole("button", { name: "XLSX · Excel", exact: true }).click();
  const workbookFile = await xlsxFile;
  const xlsxStream = await workbookFile.createReadStream();
  const xlsxChunks = [];
  for await (const c of xlsxStream!) xlsxChunks.push(c);
  const module = await import("exceljs");
  const { Workbook } = module.default || module;
  const workbook = new Workbook();
  await workbook.xlsx.load(Buffer.concat(xlsxChunks));
  const sheet = workbook.getWorksheet("Итоги сессии")!;
  expect(sheet.getRow(1).getCell(1).value).toBe("event_id");
  expect(sheet.getRow(2).getCell(3).value).toBe("preforum");
});
