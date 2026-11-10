import { test } from "node:test";
import assert from "node:assert/strict";
import { cloudWords, initialSessionDemo, stageBoard } from "../src/session.ts";
import { insideFolder, layoutCloud } from "../src/cloud-layout.ts";

test("two exact slide questions, scoped final export, whole phrases and case-insensitive frequencies", () => {
  const b = initialSessionDemo();
  assert.equal(b.polls.length, 2);
  assert.equal(b.polls[1].max_length, 1000);
  assert.deepEqual(
    cloudWords([
      { text: " Диалог " },
      { text: "диалог" },
      { text: "Важный  разговор" },
    ]),
    [
      { text: "диалог", count: 2 },
      { text: "важный разговор", count: 1 },
    ],
  );
  b.responses = [
    {
      id: "r",
      poll_id: b.polls[0].id,
      text: "Облако",
      status: "approved",
      category: "",
      tags: "",
      resolution: "решено",
      created_at: "",
    },
  ];
  assert.equal(stageBoard(b, b.polls[1]).responses?.length, 0);
});
test("350 distinct phrases fit inside the folder without overlap and repeated words grow", () => {
  const words = Array.from({ length: 350 }, (_, i) => ({
    text: "слово " + i,
    count: i === 0 ? 30 : 1,
  }));
  const layout = layoutCloud(words, (text, size) => text.length * size * 0.57);
  assert.equal(layout.length, words.length);
  assert.deepEqual(
    layout,
    layoutCloud(words, (text, size) => text.length * size * 0.57),
  );
  for (let i = 0; i < layout.length; i++) {
    const a = layout[i];
    assert.ok(
      insideFolder(a.x - a.width / 2, a.y - a.height / 2, a.width, a.height),
    );
    for (const b of layout.slice(i + 1))
      assert.ok(
        Math.abs(a.x - b.x) >= (a.width + b.width) / 2 ||
          Math.abs(a.y - b.y) >= (a.height + b.height) / 2,
      );
  }
  assert.ok(layout[0].size > layout.at(-1)!.size);
});
