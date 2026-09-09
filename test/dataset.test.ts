import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { datasetCheckPayload, jsonlCheckPayload } from "../src/dataset.js";

function aidpRow(queryId: string) {
  return {
    taskName: "test",
    queryId,
    query: "what should I buy?",
    versionAName: "model-a",
    versionBName: "model-b",
    responseA: "a",
    responseB: "b",
    productCardsA: [],
    productCardsB: [],
  };
}

test("dataset check validates one AIDP-compatible JSONL input", () => {
  const root = mkdtempSync(join(tmpdir(), "gsb-cli-jsonl-"));
  const input = join(root, "input.jsonl");
  writeFileSync(input, `${JSON.stringify(aidpRow("q-1"))}\n${JSON.stringify(aidpRow("q-2"))}\n`);

  const payload = jsonlCheckPayload(input, "gsb-cli dataset check --input input.jsonl");

  assert.equal(payload.ok, true);
  assert.equal(payload.row_count, 2);
  assert.deepEqual(payload.version_names, { A: "model-a", B: "model-b" });
});

test("dataset check rejects duplicate JSONL query ids", () => {
  const root = mkdtempSync(join(tmpdir(), "gsb-cli-jsonl-"));
  const input = join(root, "input.jsonl");
  writeFileSync(input, `${JSON.stringify(aidpRow("q-1"))}\n${JSON.stringify(aidpRow("q-1"))}\n`);

  const payload = jsonlCheckPayload(input, "gsb-cli dataset check --input input.jsonl");
  const issues = payload.issues as Array<Record<string, unknown>>;

  assert.equal(payload.ok, false);
  assert.equal(issues.some((item) => item.code === "INPUT_DUPLICATE_QUERY_ID"), true);
});

test("dataset check accepts a JSON records wrapper with Trace", () => {
  const root = mkdtempSync(join(tmpdir(), "gsb-cli-json-"));
  const input = join(root, "input.json");
  const row = aidpRow("q-1") as Record<string, unknown>;
  row.traceA = [JSON.stringify({ kind: "message", type: "tool_call", name: "search" })];
  row.traceB = [];
  writeFileSync(input, JSON.stringify({ records: [row] }));

  const payload = jsonlCheckPayload(input, "gsb-cli dataset check --input input.json");

  assert.equal(payload.ok, true);
  assert.equal(payload.row_count, 1);
});

test("dataset check rejects non-serialized Trace events", () => {
  const root = mkdtempSync(join(tmpdir(), "gsb-cli-json-"));
  const input = join(root, "input.json");
  const row = aidpRow("q-1") as Record<string, unknown>;
  row.traceA = [{ type: "tool_call" }];
  writeFileSync(input, JSON.stringify([row]));

  const payload = jsonlCheckPayload(input, "gsb-cli dataset check --input input.json");
  const issues = payload.issues as Array<Record<string, unknown>>;

  assert.equal(payload.ok, false);
  assert.equal(issues.some((item) => item.code === "INPUT_TRACE_INVALID"), true);
});

test("dataset check rejects streaming Trace events", () => {
  const root = mkdtempSync(join(tmpdir(), "gsb-cli-json-"));
  const input = join(root, "input.json");
  const row = aidpRow("q-1") as Record<string, unknown>;
  row.traceA = [JSON.stringify({ kind: "stream_event", data: { delta: "partial" } })];
  row.traceB = [];
  writeFileSync(input, JSON.stringify([row]));

  const payload = jsonlCheckPayload(input, "gsb-cli dataset check --input input.json");
  const issues = payload.issues as Array<Record<string, unknown>>;

  assert.equal(payload.ok, false);
  assert.equal(issues.some((item) => item.code === "INPUT_TRACE_INVALID"), true);
});

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
    default_renderable_a: 2,
    default_renderable_b: 1,
  });
  const datasets = payload.datasets as Record<string, Record<string, unknown>>;
  assert.equal(Array.isArray(datasets.a?.json_files), false);
  assert.equal(datasets.a?.json_count, 2);
  assert.equal(datasets.a?.valid_json_count, 2);
  const issues = payload.issues as Array<Record<string, unknown>>;
  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.code, "UNMATCHED_JSON_IGNORED");
  assert.equal(issues[0]?.severity, "warning");
});

test("dataset check verbose includes full file lists", () => {
  const root = mkdtempSync(join(tmpdir(), "gsb-cli-dataset-"));
  const a = join(root, "a");
  mkdirSync(a);
  writeFileSync(join(a, "item_1.json"), JSON.stringify({ query: "q1", response: "a1" }));

  const payload = datasetCheckPayload(a, undefined, "gsb-cli dataset check a --verbose", { verbose: true });
  const datasets = payload.datasets as Record<string, Record<string, unknown>>;

  assert.deepEqual(datasets.a?.json_files, ["item_1.json"]);
  assert.deepEqual(datasets.a?.valid_json_files, ["item_1.json"]);
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
