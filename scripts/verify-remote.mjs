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
const published = (path) => {
  // Load the real index directly: Pages' 404 redirect drops arbitrary query parameters.
  const target = new URL(origin + base);
  target.searchParams.set("route", path);
  target.searchParams.set("v", process.env.GITHUB_SHA || String(Date.now()));
  return target.href;
};
let eventId,
  browser,
  step = "initialise";
const checked = (r) => {
  if (r.error) {
    const error = Error(
      `Operation rejected (${r.error.code || r.status || "unknown"})`,
    );
    error.code = r.error.code;
    throw error;
  }
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
  if (phase === "public") {
    step = "wait for the current published build";
    const markerUrl = new URL("build.json", origin + base);
    markerUrl.searchParams.set(
      "v",
      process.env.GITHUB_SHA || String(Date.now()),
    );
    const deadline = Date.now() + 120000;
    let current = false;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(markerUrl, {
          headers: { "Cache-Control": "no-cache" },
          signal: AbortSignal.timeout(8000),
        });
        if (response.ok) {
          const marker = await response.json();
          if (
            marker.backend_configured === true &&
            (!process.env.GITHUB_SHA ||
              marker.commit === process.env.GITHUB_SHA)
          ) {
            current = true;
            break;
          }
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 1500));
    }
    assert.ok(
      current,
      "The deployment marker must match the code being verified",
    );
  }
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
  const aggregate = checked(
    await root
      .from("polls")
      .insert({
        event_id: eventId,
        title: "ТЕСТ: агрегат",
        kind: "single",
        source: "preforum",
      })
      .select("id")
      .single(),
  );
  checked(
    await root.from("options").insert([
      {
        event_id: eventId,
        poll_id: aggregate.id,
        label: "Категория А",
        position: 0,
      },
      {
        event_id: eventId,
        poll_id: aggregate.id,
        label: "Категория Б",
        position: 1,
      },
    ]),
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
    await participant.goto(published("join/" + code));
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
    await operator.goto(published("admin"));
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
    await screen.goto(published("screen/" + code));
    await screen.getByText(r.text, { exact: true }).waitFor();
    mkdirSync("deployment-evidence", { recursive: true });
    await screen.screenshot({ path: "deployment-evidence/projector-test.png" });
    await command("moderate", { ...payload, status: "hidden" });
    await screen.goto(published("screen/" + code));
    assert.equal(await screen.getByText(r.text, { exact: true }).count(), 0);
    step = "oral entry: submit from published admin";
    // Delay the response after the real DB commit to exercise a slow connection.
    // Positional .last() locators could otherwise approve the previous live answer.
    await operator.route("**/rest/v1/rpc/manage_event", async (route) => {
      const req = route.request();
      if (req.method() === "POST" && req.postDataJSON()?.p_op === "oral") {
        const response = await route.fetch();
        await new Promise((r) => setTimeout(r, 400));
        await route.fulfill({ response });
      } else await route.continue();
    });
    const oralText = "ТЕСТ: реальная проверка ручного ввода";
    const capture = operator.getByTestId("oral-capture");
    await capture.locator("select").selectOption(oral.id);
    await capture.locator("textarea").fill(oralText);
    const submitted = operator.waitForResponse((response) => {
      if (
        !response.url().endsWith("/rest/v1/rpc/manage_event") ||
        response.request().method() !== "POST"
      )
        return false;
      return response.request().postDataJSON()?.p_op === "oral";
    });
    await capture
      .getByRole("button", { name: "В очередь модерации", exact: true })
      .click();
    assert.equal((await submitted).status(), 200);
    async function waitForAdminRow(predicate) {
      for (let attempt = 0; attempt < 100; attempt++) {
        const board = checked(await admin.rpc("admin_board", { p_code: code }));
        const row = board.responses.find(predicate);
        if (row) return row;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw Error(
        "Expected test response did not reach the requested moderation state",
      );
    }
    step = "oral entry: wait for the newly queued response";
    const queued = await waitForAdminRow(
      (row) => row.poll_id === oral.id && row.text === oralText,
    );
    assert.equal(queued.status, "pending");
    assert.equal(queued.category, "");
    const oralRow = operator.getByTestId("response-" + queued.id);
    await oralRow.locator("textarea").waitFor();
    assert.equal(await oralRow.locator("textarea").inputValue(), oralText);
    assert.ok(!JSON.stringify(await snapshot()).includes(oralText));
    step = "oral entry: approve that exact response";
    await oralRow
      .getByRole("button", { name: "Одобрить", exact: true })
      .click();
    await waitForAdminRow(
      (row) => row.id === queued.id && row.status === "approved",
    );
    step = "oral entry: show the selected question on projector";
    await operator
      .getByTestId("poll-" + oral.id)
      .getByRole("button", { name: "Показать итоги", exact: true })
      .click();
    for (let attempt = 0; attempt < 100; attempt++) {
      const current = await snapshot();
      if (
        current.polls.some(
          (p) =>
            p.id === oral.id &&
            p.status === "results" &&
            p.cards.some((c) => c.id === queued.id),
        )
      )
        break;
      if (attempt === 99)
        throw Error("Approved oral response was not published");
      await new Promise((r) => setTimeout(r, 100));
    }
    await screen.goto(published("screen/" + code));
    await screen.getByText(oralText, { exact: true }).waitFor();
    assert.equal(await screen.getByText(/N =/).count(), 0);
    assert.equal(await screen.locator(".cards .pill").count(), 0);
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

    step = "published aggregate update without rebuilding";
    const agg = operator
      .locator(".poll-admin")
      .filter({ hasText: "ТЕСТ: агрегат" });
    for (const [a, n] of [
      [2, 5],
      [3, 6],
    ]) {
      await agg
        .getByRole("button", { name: "Обновить срез", exact: true })
        .click();
      const form = operator.locator(".aggregate-editor");
      await form.getByLabel("Категория А", { exact: true }).fill(String(a));
      await form.getByLabel("Категория Б", { exact: true }).fill("3");
      await form
        .getByLabel("Число реальных ответов N", { exact: true })
        .fill(String(n));
      await form
        .getByLabel(/Дата и время среза/)
        .fill("2026-11-13T09:30:00+03:00");
      await form
        .getByLabel(/Описание выборки/)
        .fill("ТЕСТ, без реальных ответов");
      await form
        .getByRole("button", { name: "Сохранить срез", exact: true })
        .click();
      await operator.waitForFunction(
        ({ id, n }) => {
          const el = [...document.querySelectorAll(".poll-admin")].find((x) =>
            x.textContent.includes("ТЕСТ: агрегат"),
          );
          return el?.textContent.includes("N=" + n);
        },
        { id: aggregate.id, n },
      );
      if (n === 5)
        await agg
          .getByRole("button", { name: "Показать итоги", exact: true })
          .click();
      await screen.goto(published("screen/" + code));
      await screen.getByText("N = " + n, { exact: true }).waitFor();
    }
    step = "two-stage: configure isolated cloud and final questions";
    checked(
      await root
        .from("polls")
        .update({ metadata: { session_stage: "cloud" } })
        .eq("id", live.id),
    );
    checked(
      await root
        .from("polls")
        .update({
          metadata: { session_stage: "final" },
          source: "live",
          max_length: 300,
        })
        .eq("id", oral.id),
    );
    checked(
      await root.from("open_responses").insert(
        Array.from({ length: 20 }, (_, i) => ({
          event_id: eventId,
          poll_id: live.id,
          text: i % 2 ? "ТЕСТ: диалог" : "тест: диалог",
          status: "approved",
        })),
      ),
    );
    step = "two-stage: open cloud through protected RPC";
    checked(
      await admin.rpc("control_stage", {
        p_code: code,
        p_poll: live.id,
        p_state: "open",
      }),
    );
    step = "two-stage: published admin shows two tabs";
    await operator.goto(published("admin"));
    await operator.getByRole("tab", { name: /Облако слов/ }).waitFor();
    assert.equal(await operator.getByRole("tab").count(), 2);
    await screen.goto(published("screen/" + code));
    step = "two-stage: published cloud contains all approved phrases";
    await screen.locator("text[data-word-count='20']").waitFor();
    step = "two-stage: cloud and QR fit the projector viewport";
    assert.ok(
      await screen.evaluate(
        () => document.documentElement.scrollHeight <= innerHeight + 2,
      ),
    );
    assert.equal(
      (await snapshot()).polls[0].cloud_words.find(
        (w) => w.text === "тест: диалог",
      ).count,
      20,
    );
    await screen.screenshot({
      path: "deployment-evidence/folder-cloud-test.png",
    });
    step = "two-stage: open final through published admin";
    await operator.getByRole("tab", { name: /Письменные ответы/ }).click();
    await operator
      .getByRole("button", { name: "Открыть приём", exact: true })
      .click();
    const finalContext = await browser.newContext(),
      finalParticipant = await finalContext.newPage();
    await finalParticipant.setViewportSize({ width: 360, height: 780 });
    step = "two-stage: submit long final answer from independent phone";
    await finalParticipant.goto(published("join/" + code));
    const finalText = (
      "ТЕСТ: ответ на последний вопрос. " +
      "Дам каждому ученику время высказаться и услышу разные мнения. ".repeat(3)
    ).trim();
    await finalParticipant
      .locator("textarea[maxlength='300']")
      .fill(finalText);
    await finalParticipant
      .getByRole("button", { name: /^Отправить ответ/ })
      .click();
    await finalParticipant.getByText("Спасибо, ответ принят").waitFor();
    await screen.goto(published("screen/" + code));
    assert.ok(!(await screen.getByText(finalText, { exact: true }).count()));
    step = "two-stage: approve final answer and select it for the screen";
    await operator
      .getByRole("button", { name: "Одобрить и показать", exact: true })
      .click();
    const finalRow = await waitForAdminRow(
      (r) =>
        r.poll_id === oral.id &&
        r.text === finalText &&
        r.status === "approved",
    );
    for (let attempt = 0; attempt < 100; attempt++) {
      if (
        (await snapshot()).polls[0]?.metadata?.featured_response === finalRow.id
      )
        break;
      if (attempt === 99) throw Error("Featured answer was not selected");
      await new Promise((r) => setTimeout(r, 100));
    }
    await screen.goto(published("screen/" + code));
    step = "two-stage: show selected final answer on projector";
    await screen
      .locator(".featured-answer")
      .filter({ hasText: finalText })
      .waitFor();
    await screen.screenshot({
      path: "deployment-evidence/final-answer-test.png",
    });
    step = "two-stage: download final CSV without cloud answers";
    const csvDownload = operator.waitForEvent("download");
    await operator
      .getByRole("button", { name: "Скачать CSV", exact: true })
      .click();
    const csvStream = await (await csvDownload).createReadStream(),
      csvChunks = [];
    for await (const chunk of csvStream) csvChunks.push(chunk);
    assert.ok(Buffer.concat(csvChunks).toString("utf8").includes(finalText));
    assert.ok(
      !Buffer.concat(csvChunks).toString("utf8").includes("тест: диалог"),
    );
    step = "two-stage: stop accepting final answers";
    await operator
      .getByRole("button", { name: "Завершить приём", exact: true })
      .click();
    await finalParticipant.goto(published("join/" + code));
    await finalParticipant.getByText("Приём ответов завершён.").waitFor();
    assert.equal(await finalParticipant.locator("textarea").count(), 0);
    await finalContext.close();
    step = "canonical participant and projector URLs";
    const realParticipant = await context.newPage();
    await realParticipant.goto(published("join/" + realCode));
    await realParticipant.locator("footer").waitFor();
    assert.equal(await realParticipant.locator(".demo").count(), 0);
    assert.equal(await realParticipant.getByRole("alert").count(), 0);
    const realScreen = await context.newPage();
    await realScreen.goto(published("screen/" + realCode));
    await realScreen.locator("footer").waitFor();
    assert.equal(await realScreen.locator(".demo").count(), 0);
    step = "real organiser role and current preforum aggregates";
    const realEvent = checked(
      await root.from("events").select("id").eq("code", realCode).single(),
    );
    const role = checked(
      await root
        .from("admin_roles")
        .select("user_id")
        .eq("event_id", realEvent.id)
        .eq("role", "admin")
        .limit(1)
        .single(),
    );
    const realUser = checked(
      await root.auth.admin.getUserById(role.user_id),
    ).user;
    const link = checked(
      await root.auth.admin.generateLink({
        type: "magiclink",
        email: realUser.email,
        options: { redirectTo: origin + base + "admin" },
      }),
    );
    const ownerPage = await browser.newPage();
    await ownerPage.goto(link.properties.action_link);
    await ownerPage
      .getByRole("heading", { name: "Очередь модерации" })
      .waitFor();
    await ownerPage.goto(published("admin"));
    await ownerPage
      .getByRole("heading", { name: "Очередь модерации" })
      .waitFor();
    assert.equal(await ownerPage.getByRole("tab").count(), 2);
    assert.equal(await ownerPage.locator(".poll-admin").count(), 0);
    const realPolls = checked(
      await root
        .from("polls")
        .select("id,imported_n,metadata")
        .eq("event_id", realEvent.id)
        .eq("source", "preforum")
        .eq("kind", "single"),
    );
    for (const p of realPolls) {
      assert.ok(p.imported_n > 0);
      const options = checked(
        await root.from("options").select("imported_count").eq("poll_id", p.id),
      );
      assert.equal(
        options.reduce((a, o) => a + o.imported_count, 0),
        p.imported_n,
      );
    }
    assert.equal(realPolls.length, 2);
    await ownerPage.close();
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
            "aggregate update without redeployment",
            "canonical real event routes and organiser login",
            "two stage controls, folder cloud from all approved phrases, final spotlight and scoped CSV export",
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
    checked(
      await root
        .from("polls")
        .update({ metadata: { session_stage: "cloud" } })
        .eq("id", live.id),
    );
    checked(
      await root
        .from("open_responses")
        .update({ status: "approved" })
        .eq("poll_id", live.id),
    );
    assert.equal(
      (await snapshot()).polls[0].cloud_words.reduce((n, w) => n + w.count, 0),
      350,
    );
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
  console.log(
    `::notice title=Remote verification ${phase}::Accepted ${count}/${count}; p95 ${Math.round(latencies[Math.floor(latencies.length * 0.95)])} ms; synthetic requests from one GitHub runner.`,
  );
} catch (error) {
  const lines = [
    ...String(error.stack || "").matchAll(/verify-remote\.mjs:(\d+)/g),
  ]
    .map((m) => m[1])
    .slice(0, 4)
    .join(",");
  const code = /^[A-Z0-9_]{1,30}$/.test(String(error.code || ""))
    ? error.code
    : "unknown";
  console.error(
    `::error title=Remote verification ${phase}::Failed at ${step}; code ${code}; script lines ${lines}. Publication is not considered verified.`,
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
