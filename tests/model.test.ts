import { test } from "node:test";
import assert from "node:assert/strict";
import {
  initialDemo,
  csv,
  parseAggregates,
  report,
  normaliseAggregate,
  percentage,
} from "../src/model.ts";
test("forum has a short phone question and anonymous question box, six oral prompts and no fabricated answers", () => {
  const b = initialDemo();
  assert.equal(b.polls.filter((p) => p.source === "live").length, 2);
  assert.equal(b.polls[0].max_length, 80);
  assert.equal(b.polls.filter((p) => p.source === "oral").length, 6);
  assert.ok(b.polls.every((p) => p.n === 0));
  assert.equal(b.responses?.length, 0);
});
test("CSV has BOM, quotes, Russian, guards Excel formulas", () => {
  assert.equal(
    csv([["=1+1", "а;б", '"текст"']]),
    '\uFEFF"\'=1+1";"а;б";"""текст"""',
  );
});
test("aggregate import rejects unknown labels, duplicates and bad counts", () => {
  const p = {
    ...initialDemo().polls[7],
    options: [
      { id: "a", label: "А", count: 0 },
      { id: "b", label: "Б", count: 0 },
    ],
  };
  assert.deepEqual(parseAggregates("категория;число\nА;2\nБ;3", p), [
    { id: "a", count: 2 },
    { id: "b", count: 3 },
  ]);
  for (const text of ["А;-1", "Чужой;5", "А;1\nА;2", "А;1000001"])
    assert.throws(() => parseAggregates(text, p));
});
test("memo keeps source, time and expert status", () => {
  const b = initialDemo();
  b.responses = [
    {
      id: "r",
      poll_id: "p1",
      text: "Больше обсуждать",
      status: "approved",
      category: "",
      tags: "время",
      resolution: "решено",
      created_at: "2026-11-13T07:30:00Z",
    },
  ];
  assert.match(report(b), /oral.*2026-11-13.*решено/);
  assert.match(report(b), /Без категории\n- .*Больше обсуждать/);
});

test("provided real snapshot sums to 140 for both questions and never populates demo counts", async () => {
  const { readFileSync } = await import("node:fs");
  const { validateSnapshot } = await import(
    "../scripts/preforum-bootstrap.mjs"
  );
  const snapshot = validateSnapshot(
    JSON.parse(readFileSync("data/preforum-2026-11-06.json", "utf8")),
  );
  const b = initialDemo();
  for (const item of snapshot.polls) {
    assert.equal(item.n, 140);
    const poll = b.polls.find((p) => p.metadata?.aggregate_key === item.key)!;
    const data = normaliseAggregate(snapshot, poll);
    assert.equal(data.n, 140);
    assert.equal(
      data.counts.reduce((a, c) => a + c.count, 0),
      140,
    );
    assert.ok(poll.options.every((o) => o.count === 0));
    assert.equal(data.preliminary, "yes");
  }
  assert.equal(percentage(61, 140), "43,6");
});
