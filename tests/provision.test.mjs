import { test } from "node:test";
import assert from "node:assert/strict";
import { provision, managementApi } from "../scripts/provision.mjs";
function setup({ existing = false, otherEvent = false, owners = 1 } = {}) {
  const calls = [],
    outputs = [];
  let seeded = existing,
    invites = 0;
  const org = { slug: "owned-org", name: "forumdialog-123" };
  const project = {
    ref: "abcdefghijklmnopqrst",
    name: "forumdialog-123",
    organization_slug: org.slug,
    status: "ACTIVE_HEALTHY",
  };
  const api = async (path, method = "GET", body) => {
    calls.push({ path, method, body });
    if (path === "/organizations")
      return method === "POST" ? org : existing ? [org] : [];
    if (path === "/projects")
      return method === "POST" ? project : existing ? [project] : [];
    if (path.endsWith("/api-keys?reveal=true"))
      return [
        { name: "anon", api_key: "public-example" },
        { name: "service_role", api_key: "private-example" },
      ];
    if (path.endsWith("/config/auth"))
      return {
        uri_allow_list: "https://existing.example/admin",
        rate_limit_anonymous_users: 500,
      };
    if (path.endsWith("/members"))
      return Array.from({ length: owners }, (_, i) => ({
        role_name: "Owner",
        email: `owner${i}@example.invalid`,
      }));
    if (path.endsWith("/database/query")) {
      const q = body.query;
      if (q.includes("to_regclass")) return [{ present: existing }];
      if (q.includes("do $$ declare e uuid")) {
        seeded = true;
        return [];
      }
      if (q.startsWith("select id,code"))
        return seeded
          ? [
              {
                id: "a9f3179a-9dbb-4242-bd04-0e11ff6b9342",
                code: "examplecode",
              },
            ]
          : [];
      if (q.startsWith("select count")) return [{ n: otherEvent ? 1 : 0 }];
      return [];
    }
    throw Error("Unexpected request");
  };
  const client = () => ({
    auth: {
      admin: {
        listUsers: async () => ({
          data: {
            users: existing
              ? [
                  {
                    id: "a9f3179a-9dbb-4242-bd04-0e11ff6b9343",
                    email: "owner0@example.invalid",
                  },
                ]
              : [],
          },
        }),
        inviteUserByEmail: async () => {
          invites++;
          return {
            data: { user: { id: "a9f3179a-9dbb-4242-bd04-0e11ff6b9343" } },
          };
        },
      },
    },
  });
  return {
    calls,
    outputs,
    run: () =>
      provision({
        api,
        origin: "https://owner.github.io",
        base: "/forumdialog/",
        repoId: "123",
        client,
        output: (...v) => outputs.push(v),
      }),
    invites: () => invites,
  };
}
test("fresh provision creates dedicated organisation, seeds, preserves redirects and invites owner", async () => {
  const t = setup();
  const r = await t.run();
  assert.equal(r.code, "examplecode");
  assert.equal(t.invites(), 1);
  assert.equal(
    t.calls.filter((c) => c.path === "/projects" && c.method === "POST").length,
    1,
  );
  const auth = t.calls.find(
    (c) => c.path.endsWith("/config/auth") && c.method === "PATCH",
  ).body;
  assert.match(auth.uri_allow_list, /existing.example/);
  assert.match(auth.uri_allow_list, /forumdialog\/admin/);
  assert.equal(auth.rate_limit_anonymous_users, 500);
  assert.ok(t.outputs.some(([kind]) => kind === "mask"));
});
test("repeat provision reuses project, event and organiser without reseeding", async () => {
  const t = setup({ existing: true });
  await t.run();
  assert.equal(t.invites(), 0);
  assert.equal(
    t.calls.filter((c) => c.path === "/projects" && c.method === "POST").length,
    0,
  );
  assert.ok(
    !t.calls.some((c) => c.body?.query?.includes("create table public.events")),
  );
});
test("existing unknown event never overwritten", async () => {
  const t = setup({ otherEvent: true });
  await assert.rejects(t.run(), /данные не изменены/);
  assert.equal(t.invites(), 0);
});
test("ambiguous owners cannot gain an unintended organiser role", async () => {
  const t = setup({ owners: 2 });
  await assert.rejects(t.run(), /определённый владелец/);
  assert.equal(t.invites(), 0);
});
test("failed management response cannot leak response body or token", async () => {
  const api = managementApi("private-token", async () => ({
    ok: false,
    status: 403,
    json: async () => ({ secret: "do-not-print" }),
  }));
  await assert.rejects(
    api("/projects"),
    (e) =>
      e.message.includes("HTTP 403") &&
      !e.message.includes("private-token") &&
      !e.message.includes("do-not-print"),
  );
});
