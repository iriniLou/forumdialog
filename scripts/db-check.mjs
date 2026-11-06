import { PGlite } from "@electric-sql/pglite";
import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const db = new PGlite();
await db.exec(
  `create schema auth; create table auth.users(id uuid primary key); create role anon;create role authenticated;create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema public,auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`,
);
await db.exec(readFileSync("supabase/migrations/001_board.sql", "utf8"));
const admin = randomUUID(),
  operator = randomUUID(),
  moderator = randomUUID();
await db.query(`insert into auth.users values ($1),($2),($3)`, [
  admin,
  operator,
  moderator,
]);
const event = (
  await db.query(
    `insert into events(title,date,code) values ('Тест','2026-11-12','TEST') returning id`,
  )
).rows[0].id;
for (const [u, r] of [
  [admin, "admin"],
  [operator, "operator"],
  [moderator, "moderator"],
])
  await db.query(`insert into admin_roles values ($1,$2,$3)`, [u, event, r]);
const pid = (
  await db.query(
    `insert into polls(event_id,title,kind,source,max_length,status) values ($1,'Короткая фраза','text','live',80,'open') returning id`,
    [event],
  )
).rows[0].id;
async function as(u, fn) {
  await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [
    u || "",
  ]);
  await db.exec(`set role ${u ? "authenticated" : "anon"}`);
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}
let checks = 0;
async function pass(name, fn) {
  await fn();
  checks++;
  console.log("PASS", name);
}
await pass(
  "seed creates the 13 v2 screens without fabricated answers",
  async () => {
    await db.exec(readFileSync("supabase/seed.sql", "utf8"));
    assert.equal(
      (
        await db.query("select count(*)::int n from polls where event_id<>$1", [
          event,
        ])
      ).rows[0].n,
      13,
    );
  },
);
await pass("RLS and grants deny all seven raw tables", async () => {
  for (const t of [
    "events",
    "polls",
    "options",
    "votes",
    "open_responses",
    "moderation_actions",
    "admin_roles",
  ])
    await as(admin, () => assert.rejects(db.query(`select * from ${t}`)));
});
await pass("private helper inaccessible to public", () =>
  as(null, () =>
    assert.rejects(db.query(`select board_data($1,true)`, [event])),
  ),
);
const u1 = randomUUID(),
  u2 = randomUUID();
for (const u of [u1, u2])
  await db.query(`insert into auth.users values ($1)`, [u]);
await pass(
  "two participants, repeat is idempotent and pending never leaks",
  async () => {
    for (const u of [u1, u2, u1])
      await as(u, () =>
        db.query(
          `select submit_response('TEST',$1,'{}','реальная тестовая фраза')`,
          [pid],
        ),
      );
    assert.equal(
      (await db.query(`select count(*)::int n from votes`)).rows[0].n,
      2,
    );
    const pub = (
      await as(null, () => db.query(`select public_board('TEST') b`))
    ).rows[0].b;
    assert.equal(pub.polls[0].cards.length, 0);
    assert.equal(pub.responses, undefined);
  },
);
await pass("80 character boundary enforced server-side", () =>
  as(admin, () =>
    assert.rejects(
      db.query(`select submit_response('TEST',$1,'{}',$2)`, [
        pid,
        "я".repeat(81),
      ]),
    ),
  ),
);
const response = (await db.query("select id from open_responses limit 1"))
  .rows[0].id;
const payload = {
  id: response,
  text: "Исправленная фраза",
  status: "approved",
  category: "решение",
  tags: "тест",
  resolution: "решено",
};
await pass(
  "operator cannot approve, moderator can; original audit protected",
  async () => {
    await as(operator, () =>
      assert.rejects(
        db.query(`select manage_event('TEST','moderate',$1)`, [payload]),
      ),
    );
    await as(moderator, () =>
      db.query(`select manage_event('TEST','moderate',$1)`, [payload]),
    );
    assert.equal(
      (await db.query("select original_text from moderation_actions")).rows[0]
        .original_text,
      "реальная тестовая фраза",
    );
    const pub = (
      await as(null, () => db.query(`select public_board('TEST') b`))
    ).rows[0].b;
    assert.equal(pub.polls[0].cards[0].text, payload.text);
  },
);
await pass(
  "moderator hides card; no raw text remains in public snapshot",
  async () => {
    await as(moderator, () =>
      db.query(`select manage_event('TEST','moderate',$1)`, [
        { ...payload, status: "hidden" },
      ]),
    );
    assert.equal(
      (await as(null, () => db.query(`select public_board('TEST') b`))).rows[0]
        .b.polls[0].cards.length,
      0,
    );
  },
);
await pass(
  "operator oral entry awaits moderation; cannot open live voting on oral source",
  async () => {
    const p = (
      await db.query(
        `insert into polls(event_id,title,kind,source,status) values ($1,'Из зала','text','oral','open') returning id`,
        [event],
      )
    ).rows[0].id;
    await as(operator, () =>
      db.query(`select manage_event('TEST','oral',$1)`, [
        { id: p, text: "Дать время на обсуждение", category: "практика" },
      ]),
    );
    await as(admin, () =>
      assert.rejects(
        db.query(`select submit_response('TEST',$1,'{}','test')`, [p]),
      ),
    );
  },
);
await pass("cross-event IDs rejected", async () => {
  const other = (
    await db.query(
      `insert into events(title,date) values ('Другое','2026-11-12') returning code`,
    )
  ).rows[0].code;
  await as(admin, () =>
    assert.rejects(
      db.query(`select submit_response($1,$2,'{}','test')`, [other, pid]),
    ),
  );
});
await pass("per identity rate limit across polls", async () => {
  const p = (
    await db.query(
      `insert into polls(event_id,title,kind,source,status) values ($1,'Другой','text','live','open') returning id`,
      [event],
    )
  ).rows[0].id;
  await as(u1, () =>
    assert.rejects(
      db.query(`select submit_response('TEST',$1,'{}','test')`, [p]),
    ),
  );
});

await pass(
  "administrator export includes audit, operator cannot read raw queue",
  async () => {
    const a = (await as(admin, () => db.query(`select admin_board('TEST') b`)))
      .rows[0].b;
    assert.equal(a.audit.length, 2);
    assert.equal(a.audit[0].actor, undefined);
    const o = (
      await as(operator, () => db.query(`select admin_board('TEST') b`))
    ).rows[0].b;
    assert.equal(o.responses, undefined);
    assert.equal(o.audit, undefined);
    await as(moderator, () =>
      assert.rejects(db.query(`select manage_event('TEST','emergency','{}')`)),
    );
  },
);
await pass(
  "aggregate import validates N, all categories, and keeps metadata",
  async () => {
    const id = (
      await db.query(
        `insert into polls(event_id,title,kind,source) values($1,'Анкета','single','preforum') returning id`,
        [event],
      )
    ).rows[0].id;
    const opts = (
      await db.query(
        `insert into options(event_id,poll_id,label,position) values ($1,$2,'А',0),($1,$2,'Б',1) returning id`,
        [event, id],
      )
    ).rows;
    const payload = {
      id,
      n: 5,
      cutoff: "2026-11-12T09:00:00+03:00",
      sample: "Тестовая выборка",
      counts: [
        { id: opts[0].id, count: 2 },
        { id: opts[1].id, count: 3 },
      ],
    };
    await as(admin, () =>
      assert.rejects(
        db.query(`select manage_event('TEST','import',$1)`, [
          { ...payload, n: 6 },
        ]),
      ),
    );
    await as(admin, () =>
      db.query(`select manage_event('TEST','import',$1)`, [payload]),
    );
    await as(admin, () =>
      db.query(`select manage_event('TEST','status',$1)`, [
        { id, status: "results" },
      ]),
    );
    const pub = (
      await as(null, () => db.query(`select public_board('TEST') b`))
    ).rows[0].b;
    assert.equal(pub.polls[0].n, 5);
    assert.equal(
      pub.polls[0].options.reduce((a, o) => a + o.count, 0),
      5,
    );
    assert.equal(pub.polls[0].metadata.cutoff, payload.cutoff);
    await as(admin, () =>
      assert.rejects(
        db.query(`select manage_event('TEST','import',$1)`, [payload]),
      ),
    );
    await as(operator, () =>
      db.query(`select manage_event('TEST','status',$1)`, [
        { id: pid, status: "open" },
      ]),
    );
  },
);
const latencies = [],
  start = performance.now();
// 350 independent identities, scheduled over 25 seconds. PGlite serializes SQL;
// this measures local validation/storage, NOT production HTTP concurrency.
await Promise.all(
  Array.from({ length: 350 }, (_, i) =>
    new Promise((resolve) => setTimeout(resolve, (i * 25000) / 350)).then(
      async () => {
        const u = randomUUID();
        const t = performance.now();
        await db.transaction(async (tx) => {
          await tx.query("insert into auth.users values ($1)", [u]);
          await tx.query(`select set_config('request.jwt.claim.sub',$1,true)`, [
            u,
          ]);
          await tx.exec("set local role authenticated");
          await tx.query(
            `select submit_response('TEST',$1,'{}','Тест нагрузки')`,
            [pid],
          );
        });
        latencies.push(performance.now() - t);
      },
    ),
  ),
);
latencies.sort((a, b) => a - b);
assert.equal(
  (await db.query("select count(*)::int n from votes where poll_id=$1", [pid]))
    .rows[0].n,
  352,
);
await pass("close and hide are enforced", async () => {
  await as(operator, () =>
    db.query(`select manage_event('TEST','emergency','{}')`),
  );
  await as(admin, () =>
    assert.rejects(
      db.query(`select submit_response('TEST',$1,'{}','test')`, [pid]),
    ),
  );
  assert.equal(
    (await as(null, () => db.query(`select public_board('TEST') b`))).rows[0].b
      .polls.length,
    0,
  );
});
const result = {
  checks,
  load: {
    sent: 350,
    accepted: 350,
    window_ms: 25000,
    elapsed_ms: Math.round(performance.now() - start),
    p50_ms: Math.round(latencies[175]),
    p95_ms: Math.round(latencies[332]),
    max_ms: Math.round(latencies.at(-1)),
  },
  limitations:
    "Local PostgreSQL WASM only; no network, Supabase Auth issuance, 350 realtime connections, or real device validation.",
};
writeFileSync("docs/db-results.json", JSON.stringify(result, null, 2));
console.log(result);
await db.close();
