import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { datasetCheckPayload } from "../src/dataset.js";

test("dataset check accepts matched JSON files and warns about unmatched files", () => {
  const root = mkdtempSync(join(tmpdir(), "gsb-cli-dataset-"));
  const a = join(root, "a");
  const b = join(root, "b");
  mkdirSync(a);
  mkdirSync(b);
  writeFileSync(join(a, "item_1.json"), JSON.stringify({ query: "q1", response: "a1" }));
  writeFileSync(join(b, "item_1.json"), JSON.stringify({ query: "q1", response: "b1" }));
  writeFileSync(join(a, "only_a.json"), JSON.stringify({ query: "q2", response: "a2" }));

  const payload = datasetCheckPayload(a, b, "gsb-cli dataset check --a a --b b");

  assert.equal(payload.ok, true);
  assert.deepEqual(payload.pair, {
    count_a: 2,
    count_b: 1,
    common_count: 1,
    only_a_count: 1,
    only_b_count: 0,
    sample_common: ["item_1"],
    sample_only_a: ["only_a"],
    sample_only_b: [],
  });
  const issues = payload.issues as Array<Record<string, unknown>>;
  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.code, "UNMATCHED_JSON_IGNORED");
  assert.equal(issues[0]?.severity, "warning");
});

test("dataset check fails when both sides have no common query ids", () => {
  const root = mkdtempSync(join(tmpdir(), "gsb-cli-dataset-"));
  const a = join(root, "a");
  const b = join(root, "b");
  mkdirSync(a);
  mkdirSync(b);
  writeFileSync(join(a, "a_only.json"), JSON.stringify({ query: "q1", response: "a1" }));
  writeFileSync(join(b, "b_only.json"), JSON.stringify({ query: "q1", response: "b1" }));

  const payload = datasetCheckPayload(a, b, "gsb-cli dataset check --a a --b b");

  assert.equal(payload.ok, false);
  const issues = payload.issues as Array<Record<string, unknown>>;
  assert.equal(issues.some((item) => item.code === "ZERO_COMMON_ITEMS"), true);
});
