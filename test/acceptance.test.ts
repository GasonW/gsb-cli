import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { test } from "node:test";
import { runCli } from "../src/commands.js";

test("acceptance blocks changed input before upload", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gsb-acceptance-"));
  const input = join(dir, "input.jsonl"); const audit = join(dir, "summary.json");
  writeFileSync(input, "{}\n"); writeFileSync(audit, JSON.stringify({ local_pass: true, input_sha256: "stale" }));
  const result = await runCli(["dataset", "upload", "--input", input, "--name", "test", "--acceptance", audit]);
  assert.equal(result.exitCode, 2);
  assert.match(String(result.payload.message), /input changed/);
});

test("verify-task checks both sides and refuses mismatching server rows", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gsb-readback-"));
  const row = { taskName: "t", queryId: "q", query: "query", versionAName: "A", versionBName: "B", responseA: "a", responseB: "b", productCardsA: [], productCardsB: [] };
  const text = JSON.stringify(row) + "\n";
  const input = join(dir, "input.jsonl"), audit = join(dir, "summary.json");
  writeFileSync(input, text); writeFileSync(audit, JSON.stringify({ local_pass: true, input_sha256: createHash("sha256").update(text).digest("hex") }));
  let mismatch = false;
  const server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url?.includes("/status")) res.end(JSON.stringify({ datasets: { counts: { a: 1, b: 1, common: 1 } } }));
    else res.end(JSON.stringify({ content: JSON.stringify(mismatch ? { ...row, responseB: "wrong" } : row) }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const addr = server.address(); assert(addr && typeof addr === "object");
    const output = join(dir, "server.jsonl");
    const args = ["dataset", "verify-task", "t", "--input", input, "--acceptance", audit, "--base-url", `http://127.0.0.1:${addr.port}`];
    const env = { ...process.env, GSB_CLI_SESSION: join(dir, "session.json") };
    const result = await runCli([...args, "--output", output], { env });
    assert.equal(result.exitCode, 0); assert.deepEqual(JSON.parse(readFileSync(output, "utf8")), row);
    mismatch = true;
    const failed = join(dir, "failed.jsonl");
    assert.equal((await runCli([...args, "--output", failed], { env })).exitCode, 2);
    assert.equal(existsSync(failed), false);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});
