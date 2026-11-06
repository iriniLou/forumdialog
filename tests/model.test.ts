import { test } from "node:test";
import assert from "node:assert/strict";
import { initialDemo, csv, parseAggregates, report } from "../src/model.ts";
test("v2 has one phone question, six oral prompts and no fabricated answers", () => {
  const b = initialDemo();
  assert.equal(b.polls.filter((p) => p.source === "live").length, 1);
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
      category: "решение",
      tags: "время",
      resolution: "решено",
      created_at: "2026-11-12T07:30:00Z",
    },
  ];
  assert.match(report(b), /oral.*2026-11-12.*решено/);
});
