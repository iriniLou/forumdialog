import { readFileSync, appendFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { pathToFileURL } from "node:url";
import { buildSnapshotImportSql } from "./preforum-bootstrap.mjs";
const quote = (v) => "'" + String(v).replaceAll("'", "''") + "'";
export async function provision({
  api,
  origin,
  base,
  repoId,
  wait = (ms) => new Promise((r) => setTimeout(r, ms)),
  client = createClient,
  output = () => {},
  progress = () => {},
}) {
  const orgName = `forumdialog-${repoId}`;
  const orgs = await api("/organizations");
  // A scoped token must expose exactly the organisation selected by its owner.
  // Never ask for account-wide permission to create another organisation.
  const namedOrgs = orgs.filter(
    (o) => o.name?.normalize("NFC").trim() === "Вместе о важном",
  );
  if (namedOrgs.length !== 1 && orgs.length !== 1)
    throw Error(
      "При создании токена выберите доступ только к одной организации Supabase",
    );
  const org = namedOrgs.length === 1 ? namedOrgs[0] : orgs[0];
  const slug = org.slug || org.id;
  const projects = await api("/projects");
  const matches = projects.filter(
    (p) =>
      p.name === orgName && (p.organization_slug || p.organization_id) === slug,
  );
  if (matches.length > 1)
    throw Error("Найдены проекты с одинаковым именем; нужен однозначный выбор");
  let project = matches[0];
  if (!project) {
    const details = await api(`/organizations/${slug}`);
    if (details.plan !== "free")
      throw Error(
        "Создание проекта остановлено: бесплатный тариф выбранной организации не подтверждён. Платные ресурсы автоматически не создаются",
      );
    try {
      project = await api("/projects", "POST", {
        name: orgName,
        organization_slug: slug,
        db_pass: randomBytes(32).toString("base64url"),
        region_selection: { type: "smartGroup", code: "emea" },
      });
    } catch (error) {
      if (error.status === 403) {
        const available = projects.filter(
          (p) => (p.organization_slug || p.organization_id) === slug,
        ).length;
        error.message += ` Существующих доступных проектов в выбранной организации: ${available}. Создание проекта требует разрешения Organization Projects → Read-write.`;
      }
      throw error;
    }
  }
  const ref = project.ref || project.id;
  if (!/^[a-z]{20}$/.test(ref))
    throw Error("Некорректный идентификатор проекта");
  for (let i = 0; project.status !== "ACTIVE_HEALTHY"; i++) {
    if (
      i >= 72 ||
      ["INIT_FAILED", "REMOVED", "RESTORE_FAILED"].includes(project.status)
    )
      throw Error("Проект Supabase не перешёл в рабочее состояние");
    progress("Ожидаем готовность Supabase");
    await wait(10000);
    project = await api(`/projects/${ref}`);
  }
  const keys = await api(`/projects/${ref}/api-keys?reveal=true`);
  const anon = (
      keys.find((k) => k.name === "anon" && k.api_key) ||
      keys.find((k) => k.type === "publishable" && k.api_key)
    )?.api_key,
    service = (
      keys.find((k) => k.name === "service_role" && k.api_key) ||
      keys.find((k) => k.type === "secret" && k.api_key)
    )?.api_key;
  if (!anon || !service)
    throw Error("Не удалось получить совместимые ключи Supabase");
  output("mask", service);
  const url = `https://${ref}.supabase.co`;
  const sql = (query) =>
    api(`/projects/${ref}/database/query`, "POST", { query });
  const table = await sql(
    "select to_regclass('public.events') is not null as present",
  );
  if (!table[0]?.present) {
    // Transaction ensures an interrupted initial schema leaves no half-installation.
    await sql(
      "begin;\n" +
        readFileSync("supabase/migrations/001_board.sql", "utf8") +
        "\ncommit;",
    );
  }
  const aggregateUpgrade = await sql(
    "select to_regclass('public.aggregate_imports') is not null as present",
  );
  if (!aggregateUpgrade[0]?.present)
    await sql(
      "begin;\n" +
        readFileSync("supabase/migrations/002_aggregate_updates.sql", "utf8") +
        "\ncommit;",
    );
  let events = await sql(
    "select id,code from public.events where title='Живой разговор · Вместе о важном' and date='2026-11-13' and status='active'",
  );
  if (!events.length) {
    const existing = await sql("select count(*)::int as n from public.events");
    if (existing[0]?.n)
      throw Error(
        "В проекте уже есть события. Нужна проверка их владельцем; данные не изменены",
      );
    await sql(readFileSync("supabase/seed.sql", "utf8"));
    events = await sql(
      "select id,code from public.events where date='2026-11-13'",
    );
  }
  if (events.length !== 1)
    throw Error("Нельзя однозначно выбрать событие форума");
  const event = events[0];
  const cfg = await api(`/projects/${ref}/config/auth`);
  const redirect = origin + base + "admin";
  await api(`/projects/${ref}/config/auth`, "PATCH", {
    site_url: origin + base,
    uri_allow_list: [
      ...new Set([
        ...(cfg.uri_allow_list || "").split(",").filter(Boolean),
        redirect,
      ]),
    ].join(","),
    external_anonymous_users_enabled: true,
    external_email_enabled: true,
    disable_signup: false,
    rate_limit_anonymous_users: Math.max(
      1000,
      cfg.rate_limit_anonymous_users || 0,
    ),
  });
  const members = await api(`/organizations/${slug}/members`);
  const owners = members.filter(
    (m) => m.role_name?.toLowerCase() === "owner" && m.email,
  );
  if (owners.length !== 1)
    throw Error(
      "В организации нужен один определённый владелец для безопасного приглашения организатора",
    );
  const admin = client(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const users = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (users.error)
    throw Error("Не удалось проверить учётную запись организатора");
  let owner = users.data.users.find(
    (u) => u.email?.toLowerCase() === owners[0].email.toLowerCase(),
  );
  if (!owner) {
    const invite = await admin.auth.admin.inviteUserByEmail(owners[0].email, {
      redirectTo: redirect,
    });
    if (invite.error)
      throw Error(
        "Supabase не отправил приглашение организатору. Проверьте доставку почты в Dashboard",
      );
    owner = invite.data.user;
  }
  if (!owner?.id) throw Error("Не создана учётная запись организатора");
  await sql(
    `insert into public.admin_roles(user_id,event_id,role) values (${quote(owner.id)},${quote(event.id)},'admin') on conflict(user_id,event_id) do update set role='admin'`,
  );
  await sql(buildSnapshotImportSql(event.id, owner.id));
  output("public", { url, anon, ref, code: event.code, origin, base });
  output("service", service);
  progress(
    `::notice title=Shared database ready::Project ${ref}; forum code ${event.code}; real preliminary aggregates loaded only if no newer slice exists.`,
  );
  progress(
    "Общая база и защищённая роль настроены. Приглашение направлено владельцу организации",
  );
  return { url, anon, ref, code: event.code };
}
export function managementApi(token, fetcher = fetch) {
  return async (path, method = "GET", body) => {
    const r = await fetcher("https://api.supabase.com/v1" + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) {
      const body = await r.json().catch(() => null);
      // Classify only known non-secret reasons; never print provider response text.
      const text = String(
        body?.message || body?.error_description || body?.error || "",
      ).toLowerCase();
      let reason = "";
      if (
        /insufficient.scope|organization_projects_create|missing.*permission|insufficient.*permission|not.*permission|not.*privilege|not.authorized/.test(
          text,
        )
      )
        reason = " Отказ по правам доступа.";
      else if (/quota|free.*project|project.*limit|maximum.*project/.test(text))
        reason = " Ограничение количества проектов.";
      else if (/suspend|banned|blocked/.test(text))
        reason = " Ограничение аккаунта со стороны Supabase.";
      const error = new Error(
        `Supabase Management API: ${method} ${path.split("?")[0]} → HTTP ${r.status}.${reason} Содержимое ответа скрыто для защиты ключей`,
      );
      error.status = r.status;
      throw error;
    }
    return r.status === 204 ? null : r.json();
  };
}
export function provisionErrorAnnotation(error, token) {
  const text = String(
    error?.message || "Неизвестная ошибка настройки Supabase",
  );
  const redacted = token ? text.split(token).join("[REDACTED]") : text;
  const escaped = redacted
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A");
  return "::error title=Supabase connection::" + escaped;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token)
    throw Error("Требуется секрет SUPABASE_ACCESS_TOKEN в GitHub Actions");
  try {
    await provision({
      api: managementApi(token),
      origin: process.env.PUBLIC_ORIGIN,
      base: process.env.VITE_BASE_PATH,
      repoId: process.env.GITHUB_REPOSITORY_ID,
      progress: console.log,
      output: (kind, value) => {
        if (kind === "mask") console.log("::add-mask::" + value);
        if (kind === "public") {
          const lines = {
            VITE_SUPABASE_URL: value.url,
            VITE_SUPABASE_ANON_KEY: value.anon,
            VITE_EVENT_CODE: value.code,
            VITE_PUBLIC_ORIGIN: value.origin,
            VITE_BASE_PATH: value.base,
            VITE_REQUIRE_BACKEND: "true",
            SUPABASE_PROJECT_REF: value.ref,
          };
          for (const [k, v] of Object.entries(lines))
            appendFileSync(process.env.GITHUB_ENV, `${k}=${v}\n`);
        }
        if (kind === "service")
          appendFileSync(
            process.env.GITHUB_ENV,
            `SUPABASE_SERVICE_ROLE_KEY=${value}\n`,
          );
      },
    });
  } catch (e) {
    console.error(provisionErrorAnnotation(e, token));
    process.exitCode = 1;
  }
}
