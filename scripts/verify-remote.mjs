import { createClient } from "@supabase/supabase-js";
import { chromium } from "@playwright/test";
import { randomUUID, randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
const phase = process.argv[2];
if (!["backend", "public"].includes(phase))
  throw Error("Choose backend or public");
const {
  VITE_SUPABASE_URL: url,
  VITE_SUPABASE_ANON_KEY: anon,
  SUPABASE_SERVICE_ROLE_KEY: service,
  VITE_PUBLIC_ORIGIN: origin,
  VITE_BASE_PATH: base,
  VITE_EVENT_CODE: realCode,
} = process.env;
if (![url, anon, service, origin, base, realCode].every(Boolean))
  throw Error("Remote verification requires provisioned configuration");
const make = (key) =>
    createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  root = make(service);
const users = [],
  clients = [],
  latencies = [];
let eventId,
  browser,
  step = "initialise";
const checked = (r) => {
  if (r.error)
    throw Error(
      `Operation rejected (${r.error.code || r.status || "unknown"})`,
    );
  return r.data;
};
const code = "test" + randomUUID().replaceAll("-", "").slice(0, 12),
  password = randomBytes(24).toString("base64url"),
  email = `test-${randomUUID()}@example.invalid`;
async function pool(items, fn, parallel = 5) {
  let i = 0;
  await Promise.all(
    Array.from({ length: parallel }, async () => {
      while (i < items.length) {
        const j = i++;
        await fn(items[j], j);
      }
    }),
  );
}
try {
  step = "create isolated test data";
  const user = checked(
    await root.auth.admin.createUser({ email, password, email_confirm: true }),
  ).user;
  users.push(user.id);
  const event = checked(
    await root
      .from("events")
      .insert({
        code,
        title: "ТЕСТ АВТОПРОВЕРКИ — вымышленные реплики",
        date: "2026-11-13",
      })
      .select("id")
      .single(),
  );
  eventId = event.id;
  const live = checked(
    await root
      .from("polls")
      .insert({
        event_id: eventId,
        title: "ТЕСТ: короткая фраза",
        kind: "text",
        source: "live",
        max_length: 80,
        status: "open",
      })
      .select("id")
      .single(),
  );
  const oral = checked(
    await root
      .from("polls")
      .insert({
        event_id: eventId,
        title: "ТЕСТ: ответы из зала",
        kind: "text",
        source: "oral",
        max_length: 250,
      })
      .select("id")
      .single(),
  );
  checked(
    await root
      .from("admin_roles")
      .insert({ event_id: eventId, user_id: user.id, role: "admin" }),
  );
  const admin = make(anon);
  checked(await admin.auth.signInWithPassword({ email, password }));
  step = "anonymous sessions";
  const count = phase === "backend" ? 350 : 2;
  await pool(Array.from({ length: count }), async () => {
    const c = make(anon);
    const u = checked(await c.auth.signInAnonymously()).user;
    users.push(u.id);
    clients.push(c);
  });
  step = "submit responses";
  const started = performance.now();
  await Promise.all(
    clients.map((c, i) =>
      new Promise((r) =>
        setTimeout(r, phase === "backend" ? (i * 25000) / 350 : 0),
      ).then(async () => {
        const t = performance.now();
        checked(
          await c.rpc("submit_response", {
            p_code: code,
            p_poll: live.id,
            p_choices: [],
            p_text: `ТЕСТ: короткая вымышленная фраза ${i + 1}`,
          }),
        );
        latencies.push(performance.now() - t);
      }),
    ),
  );
  latencies.sort((a, b) => a - b);
  checked(
    await clients[0].rpc("submit_response", {
      p_code: code,
      p_poll: live.id,
      p_choices: [],
      p_text: "ТЕСТ: повтор",
    }),
  );
  const snapshot = async () =>
    checked(await clients[0].rpc("public_board", { p_code: code }));
  let b = await snapshot();
  assert.equal(b.polls[0].cards.length, 0);
  assert.equal(b.responses, undefined);
  const ab = checked(await admin.rpc("admin_board", { p_code: code }));
  assert.equal(ab.polls.find((p) => p.id === live.id).n, count);
  step = "private data access";
  for (const table of [
    "votes",
    "open_responses",
    "moderation_actions",
    "admin_roles",
  ])
    assert.ok((await clients[0].from(table).select("*")).error);
  assert.ok(
    (
      await clients[0].rpc("manage_event", {
        p_code: code,
        p_op: "status",
        p_payload: { id: live.id, status: "results" },
      })
    ).error,
  );
  step = "moderation";
  const r = ab.responses[0];
  const payload = {
    id: r.id,
    text: r.text,
    status: "approved",
    category: "практика",
    tags: "тест",
    resolution: "требуется ответ",
  };
  const command = (op, payload) =>
    admin
      .rpc("manage_event", { p_code: code, p_op: op, p_payload: payload })
      .then(checked);
  await command("moderate", payload);
  b = await snapshot();
  assert.equal(b.polls[0].cards[0].text, r.text);
  if (phase === "public") {
    step = "published routes and mobile submission";
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
      args: ["--no-sandbox"],
    });
    const context = await browser.newContext();
    const participant = await context.newPage();
    await participant.setViewportSize({ width: 360, height: 780 });
    await participant.goto(origin + base + "join/" + code);
    await participant
      .getByRole("heading", { name: "ТЕСТ: короткая фраза" })
      .waitFor();
    assert.equal(await participant.locator(".demo").count(), 0);
    // This is a third browser identity. Its vote is isolated and removed below.
    await participant
      .locator("textarea")
      .fill("ТЕСТ: отправлено с мобильного интерфейса");
    await participant.getByRole("button", { name: "Отправить ответ" }).click();
    await participant.getByText("Спасибо, ответ принят").waitFor();
    assert.ok(
      await participant.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    const operator = await context.newPage();
    await operator.goto(origin + base + "admin");
    await operator.getByLabel("Почта организатора").fill(email);
    await operator.getByLabel("Пароль", { exact: true }).fill(password);
    await operator.getByRole("button", { name: "Войти", exact: true }).click();
    await operator.getByLabel("Код события").fill(code);
    await operator
      .getByRole("button", { name: "Загрузить", exact: true })
      .click();
    await operator
      .getByRole("heading", { name: "Очередь модерации" })
      .waitFor();
    const screen = await context.newPage();
    await screen.setViewportSize({ width: 1920, height: 1080 });
    await screen.goto(origin + base + "screen/" + code);
    await screen.getByText(r.text, { exact: true }).waitFor();
    mkdirSync("deployment-evidence", { recursive: true });
    await screen.screenshot({ path: "deployment-evidence/projector-test.png" });
    await command("moderate", { ...payload, status: "hidden" });
    await screen.reload();
    assert.equal(await screen.getByText(r.text, { exact: true }).count(), 0);
    step = "oral entry and moderation via published admin";
    const capture = operator
      .locator("form")
      .filter({ hasText: "Фиксация ответов из зала" });
    await capture.locator("select").selectOption(oral.id);
    await capture
      .locator("textarea")
      .fill("ТЕСТ: реальная проверка ручного ввода");
    await capture.getByRole("button", { name: "В очередь модерации" }).click();
    await operator.locator("article textarea").last().waitFor();
    await operator
      .locator("article")
      .filter({ has: operator.locator("textarea") })
      .last()
      .getByRole("button", { name: "Одобрить", exact: true })
      .click();
    await operator
      .locator(".poll-admin")
      .filter({ hasText: "ТЕСТ: ответы из зала" })
      .getByRole("button", { name: "Показать итоги", exact: true })
      .click();
    await screen.reload();
    await screen
      .getByText("ТЕСТ: реальная проверка ручного ввода", { exact: true })
      .waitFor();
    assert.equal(await screen.getByText(/N =/).count(), 0);
    step = "published XLSX export";
    const pending = operator.waitForEvent("download");
    await operator
      .getByRole("button", { name: "XLSX · Excel", exact: true })
      .click();
    const file = await pending;
    const stream = await file.createReadStream();
    const chunks = [];
    for await (const c of stream) chunks.push(c);
    assert.equal(Buffer.concat(chunks).subarray(0, 2).toString(), "PK");
    // Include the browser anonymous identity in cleanup, without ever exposing its token.
    const all = checked(
      await root
        .from("votes")
        .select("anonymous_session_id")
        .eq("event_id", eventId),
    );
    for (const v of all)
      if (!users.includes(v.anonymous_session_id))
        users.push(v.anonymous_session_id);
    writeFileSync(
      "deployment-evidence/public-verified.json",
      JSON.stringify(
        {
          origin,
          base,
          code: realCode,
          verified_at: new Date().toISOString(),
          checks: [
            "participant submission",
            "private moderator login",
            "manual oral entry",
            "moderation",
            "projector hide",
            "xlsx export",
            "360px layout",
          ],
        },
        null,
        2,
      ),
    );
  } else {
    await command("moderate", { ...payload, status: "hidden" });
    assert.equal((await snapshot()).polls[0].cards.length, 0);
    step = "350 concurrent phone polling requests";
    await Promise.all(
      clients.map(async (c) => {
        const p = checked(await c.rpc("public_board", { p_code: code }));
        assert.ok(p.polls);
      }),
    );
    await command("status", { id: live.id, status: "results" });
    assert.equal((await snapshot()).polls[0].n, 350);
  }
  step = "emergency closure";
  await command("emergency", {});
  assert.equal((await snapshot()).polls.length, 0);
  assert.ok(
    (
      await clients[0].rpc("submit_response", {
        p_code: code,
        p_poll: live.id,
        p_choices: [],
        p_text: "ТЕСТ закрытого опроса",
      })
    ).error,
  );
  mkdirSync("deployment-evidence", { recursive: true });
  writeFileSync(
    `deployment-evidence/${phase}-results.json`,
    JSON.stringify(
      {
        phase,
        sent: count,
        accepted: latencies.length,
        elapsed_ms: Math.round(performance.now() - started),
        p95_ms: Math.round(latencies[Math.floor(latencies.length * 0.95)]),
        max_ms: Math.round(latencies.at(-1)),
        limits:
          "Synthetic requests from one GitHub runner. Actual devices and venue Wi-Fi not tested.",
      },
      null,
      2,
    ),
  );
  console.log(
    `PASS ${phase}: ${count} remote responses and moderation verified`,
  );
} catch {
  console.error(
    `FAIL remote verification at: ${step}. Publication is not considered verified.`,
  );
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  let failed = false;
  if (eventId) {
    const identities = await root
      .from("votes")
      .select("anonymous_session_id")
      .eq("event_id", eventId);
    if (identities.error) failed = true;
    else
      for (const v of identities.data)
        if (!users.includes(v.anonymous_session_id))
          users.push(v.anonymous_session_id);
    const r = await root.from("events").delete().eq("id", eventId);
    if (r.error) failed = true;
  }
  await pool(users, async (id) => {
    if ((await root.auth.admin.deleteUser(id)).error) failed = true;
  });
  if (failed) {
    console.error(
      "Test data cleanup incomplete; inspect the dedicated test event in Supabase",
    );
    process.exitCode = 1;
  }
}
