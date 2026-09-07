import { strict as assert } from "node:assert";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runCli } from "../src/commands.js";
import { CLI_VERSION } from "../src/version.js";

test("CLI version matches package.json", async () => {
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string };
  const result = await runCli(["--version"]);
  assert.equal(result.payload.message, pkg.version);
  assert.equal(CLI_VERSION, pkg.version);
});

test("CLI bootstraps CSRF, logs in, and reuses the saved cookies", async () => {
  const seen: Array<{ method: string; path: string; body: unknown; cookie: string; csrf: string }> = [];
  const server = createServer(async (req, res) => {
    const body = await readJson(req);
    seen.push({
      method: req.method || "",
      path: req.url || "",
      body,
      cookie: req.headers.cookie || "",
      csrf: String(req.headers["x-suda-csrf-token"] || ""),
    });
    if (req.method === "GET" && req.url === "/login") {
      res.setHeader("set-cookie", [
        "suda-csrf-token=remote-csrf; Path=/",
        "suda_web_did=remote-web-did; Path=/; HttpOnly",
      ]);
      res.statusCode = 200;
      return res.end("<!doctype html><title>login</title>");
    }
    if (req.method === "POST" && req.url === "/api/auth/login") {
      assert.match(req.headers.cookie || "", /suda-csrf-token=remote-csrf/);
      assert.match(req.headers.cookie || "", /suda_web_did=remote-web-did/);
      assert.equal(req.headers["x-suda-csrf-token"], "remote-csrf");
      res.setHeader("set-cookie", "session_token=remote-session; Path=/");
      return sendJson(res, { username: "pm", role: "admin" });
    }
    if (req.method === "GET" && req.url === "/api/auth/me") {
      if (req.headers.cookie?.includes("remote-session")) {
        return sendJson(res, { username: "pm", role: "admin" });
      }
      return sendJson(res, { error: "unauthorized" }, 401);
    }
    if (req.method === "POST" && req.url === "/api/tasks") {
      assert.equal(req.headers.cookie?.includes("remote-session"), true);
      return sendJson(res, {
        task: {
          id: "task_remote",
          name: (body as { name?: string }).name,
          purpose: (body as { purpose?: string }).purpose,
          status: "draft",
          mode: (body as { mode?: string }).mode,
        },
      });
    }
    return sendJson(res, { error: "not found" }, 404);
  });
  await listen(server);
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address && "port" in address ? address.port : 0}`;
    const sessionFile = join(mkdtempSync(join(tmpdir(), "gsb-cli-session-")), "sessions.json");
    const env = { ...process.env, GSB_CLI_SESSION: sessionFile };

    const login = await runCli(["auth", "login", "--base-url", baseUrl, "--username", "pm", "--password", "pw", "--json"], { env });
    assert.equal(login.exitCode, 0);
    assert.equal(login.payload.base_url, baseUrl);
    const saved = JSON.parse(readFileSync(sessionFile, "utf8")).default;
    assert.equal(saved.session_token, "remote-session");
    assert.equal(saved.csrf_token, "remote-csrf");
    assert.equal(saved.web_did, "remote-web-did");
    assert.equal(statSync(sessionFile).mode & 0o777, 0o600);
    assert.equal(login.payload.auth_protocol, "suda-double-submit-csrf");

    const create = await runCli([
      "task",
      "create",
      "--base-url",
      baseUrl,
      "--name",
      "remote task",
      "--purpose",
      "Compare answer quality for the launch candidate.",
      "--mode",
      "review",
      "--json",
    ], { env });
    assert.equal(create.exitCode, 0);
    assert.deepEqual(create.payload.task, {
      id: "task_remote",
      name: "remote task",
      purpose: "Compare answer quality for the launch candidate.",
      status: "draft",
      mode: "review",
    });
    assert.deepEqual(seen[2]?.body, {
      name: "remote task",
      purpose: "Compare answer quality for the launch candidate.",
      mode: "review",
      task_id: "",
    });
    assert.match(String(create.payload.next_steps), /0\/1\/2\/3/);
    assert.match(String(create.payload.next_steps), /no GSB verdict/);
    assert.equal(seen[2]?.csrf, "remote-csrf");
    assert.match(seen[2]?.cookie || "", /session_token=remote-session/);
    assert.deepEqual(seen.map((item) => `${item.method} ${item.path}`), [
      "GET /login",
      "POST /api/auth/login",
      "POST /api/tasks",
    ]);
  } finally {
    await close(server);
  }
});

test("CLI registers a user and saves the returned session", async () => {
  const seen: Array<{ method: string; path: string; body: unknown }> = [];
  const server = createServer(async (req, res) => {
    const body = await readJson(req);
    seen.push({ method: req.method || "", path: req.url || "", body });
    if (req.method === "GET" && req.url === "/login") {
      res.setHeader("set-cookie", "suda-csrf-token=register-csrf; Path=/");
      res.statusCode = 200;
      return res.end("<!doctype html><title>login</title>");
    }
    if (req.method === "POST" && req.url === "/api/auth/register") {
      assert.equal(req.headers["x-suda-csrf-token"], "register-csrf");
      res.setHeader("set-cookie", "session_token=registered-session; Path=/");
      return sendJson(res, { ok: true, username: "new_user", role: "evaluator" });
    }
    return sendJson(res, { error: "not found" }, 404);
  });
  await listen(server);
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const sessionFile = join(mkdtempSync(join(tmpdir(), "gsb-cli-register-")), "sessions.json");
    const env = { ...process.env, GSB_CLI_SESSION: sessionFile };

    const result = await runCli([
      "auth",
      "register",
      "--base-url",
      baseUrl,
      "--username",
      "new_user",
      "--password",
      "secret123",
      "--json",
    ], { env });

    assert.equal(result.exitCode, 0);
    assert.equal(result.payload.username, "new_user");
    assert.equal(JSON.parse(readFileSync(sessionFile, "utf8")).default.session_token, "registered-session");
    assert.equal(JSON.parse(readFileSync(sessionFile, "utf8")).default.csrf_token, "register-csrf");
    assert.deepEqual(seen[1]?.body, { username: "new_user", password: "secret123" });
  } finally {
    await close(server);
  }
});

test("CLI upgrades an old session after the platform returns a CSRF gate error", async () => {
  const seen: string[] = [];
  const server = createServer(async (req, res) => {
    seen.push(`${req.method} ${req.url}`);
    if (req.method === "GET" && req.url === "/login") {
      res.setHeader("set-cookie", "suda-csrf-token=recovered-csrf; Path=/");
      res.statusCode = 200;
      return res.end("<!doctype html><title>login</title>");
    }
    if (req.method === "GET" && req.url === "/api/auth/me") {
      if (!req.headers.cookie?.includes("suda-csrf-token=recovered-csrf")) {
        res.statusCode = 403;
        return res.end("Forbidden, csrf token not found in cookie.");
      }
      assert.equal(req.headers["x-suda-csrf-token"], "recovered-csrf");
      assert.match(req.headers.cookie, /session_token=old-session/);
      return sendJson(res, { username: "pm", role: "admin" });
    }
    return sendJson(res, { error: "not found" }, 404);
  });
  await listen(server);
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const sessionFile = join(mkdtempSync(join(tmpdir(), "gsb-cli-old-session-")), "sessions.json");
    writeFileSync(sessionFile, JSON.stringify({ default: { base_url: baseUrl, session_token: "old-session" } }));

    const result = await runCli(["auth", "whoami", "--json"], {
      env: { ...process.env, GSB_CLI_SESSION: sessionFile },
    });

    assert.equal(result.exitCode, 0);
    assert.deepEqual(seen, ["GET /api/auth/me", "GET /login", "GET /api/auth/me"]);
    const upgraded = JSON.parse(readFileSync(sessionFile, "utf8")).default;
    assert.equal(upgraded.session_token, "old-session");
    assert.equal(upgraded.csrf_token, "recovered-csrf");
    assert.equal(statSync(sessionFile).mode & 0o777, 0o600);
  } finally {
    await close(server);
  }
});

test("CLI login remains compatible with a legacy server without CSRF", async () => {
  const seen: string[] = [];
  const server = createServer(async (req, res) => {
    seen.push(`${req.method} ${req.url}`);
    if (req.method === "GET" && req.url === "/login") {
      res.statusCode = 200;
      return res.end("<!doctype html><title>legacy login</title>");
    }
    if (req.method === "POST" && req.url === "/api/auth/login") {
      assert.equal(req.headers["x-suda-csrf-token"], undefined);
      res.setHeader("set-cookie", "session_token=legacy-session; Path=/");
      return sendJson(res, { username: "legacy", role: "admin" });
    }
    return sendJson(res, { error: "not found" }, 404);
  });
  await listen(server);
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const sessionFile = join(mkdtempSync(join(tmpdir(), "gsb-cli-legacy-login-")), "sessions.json");
    const result = await runCli([
      "auth", "login", "--base-url", baseUrl, "--username", "legacy", "--password", "pw", "--json",
    ], { env: { ...process.env, GSB_CLI_SESSION: sessionFile } });

    assert.equal(result.exitCode, 0);
    assert.equal(result.payload.auth_protocol, "legacy-session-cookie");
    assert.deepEqual(seen, ["GET /login", "POST /api/auth/login"]);
  } finally {
    await close(server);
  }
});

test("task create requires a task name before calling the platform", async () => {
  const result = await runCli(["task", "create", "--purpose", "missing name", "--json"], {
    env: { ...process.env, GSB_CLI_SESSION: join(tmpdir(), "unused-gsb-session.json") },
  });

  assert.equal(result.exitCode, 2);
  assert.equal(result.payload.message, "task create requires --name");
});

test("remote task bind refuses local paths and tells user to upload first", async () => {
  const localDataset = mkdtempSync(join(tmpdir(), "gsb-cli-local-dataset-"));
  mkdirSync(join(localDataset, "nested"));

  const result = await runCli([
    "task",
    "bind",
    "task_1",
    "--base-url",
    "https://gsb.example.com",
    "--a",
    localDataset,
    "--b",
    "dataset_b",
    "--json",
  ], { env: { ...process.env, GSB_CLI_SESSION: join(tmpdir(), "unused-gsb-session.json") } });

  assert.equal(result.exitCode, 1);
  const issues = result.payload.issues as Array<Record<string, unknown>>;
  assert.equal(issues[0]?.code, "DATASET_REF_LOCAL_PATH_FOR_REMOTE");
});

test("dataset upload and task bind do not expose server absolute paths in normal output", async () => {
  const datasetDir = mkdtempSync(join(tmpdir(), "gsb-cli-dataset-"));
  writeFileSync(join(datasetDir, "q1.json"), JSON.stringify({ query: "q", response: "a" }));
  const serverPath = "/data00/home/example/workspace/uploads/pm/baseline";
  const server = createServer(async (req, res) => {
    await readJson(req);
    if (req.method === "POST" && req.url === "/api/datasets/upload") {
      return sendJson(res, { ok: true, id: "ds_a", name: "baseline", path: serverPath, username: "pm", json_count: 1 });
    }
    if (req.method === "GET" && req.url === "/api/datasets") {
      return sendJson(res, { my: [{ id: "ds_a", name: "baseline", path: serverPath, username: "pm", json_count: 1 }], others: [] });
    }
    if (req.method === "POST" && req.url === "/tasks/task_1/api/select-dirs") {
      return sendJson(res, { ok: true, task_id: "task_1", data_mode: "preview", common_count: 1 });
    }
    return sendJson(res, { error: "not found" }, 404);
  });
  await listen(server);
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const env = { ...process.env, GSB_CLI_SESSION: join(tmpdir(), "unused-gsb-session.json") };

    const upload = await runCli(["dataset", "upload", datasetDir, "--base-url", baseUrl, "--name", "baseline", "--json"], { env });
    assert.equal(upload.exitCode, 0);
    assert.equal(JSON.stringify(upload.payload).includes(serverPath), false);
    const uploaded = upload.payload.uploaded as Array<Record<string, unknown>>;
    assert.deepEqual(uploaded[0], { id: "ds_a", name: "baseline", username: "pm", json_count: 1, label: "dataset", ok: true });

    const bind = await runCli(["task", "bind", "task_1", "--base-url", baseUrl, "--a", "ds_a", "--json"], { env });
    assert.equal(bind.exitCode, 0);
    assert.equal(JSON.stringify(bind.payload).includes(serverPath), false);
    const refs = bind.payload.resolved_refs as Array<Record<string, unknown>>;
    assert.deepEqual(refs[0], { kind: "dataset", id: "ds_a", name: "baseline", username: "pm", json_count: 1 });
  } finally {
    await close(server);
  }
});

test("dataset upload surfaces duplicate-name conflicts as actionable issues", async () => {
  const datasetDir = mkdtempSync(join(tmpdir(), "gsb-cli-dataset-"));
  writeFileSync(join(datasetDir, "q1.json"), JSON.stringify({ query: "q", response: "a" }));
  const server = createServer(async (req, res) => {
    await readJson(req);
    if (req.method === "POST" && req.url === "/api/datasets/upload") {
      return sendJson(res, {
        code: "DATASET_NAME_CONFLICT",
        message: "同名数据集已存在，但文件内容不完全一致",
        next_step: "确认本次上传目的后重试。",
        supported_strategies: ["reuse", "replace", "new_name", "force_new"],
      }, 409);
    }
    return sendJson(res, { error: "not found" }, 404);
  });
  await listen(server);
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const result = await runCli(["dataset", "upload", datasetDir, "--base-url", baseUrl, "--name", "baseline", "--json"], {
      env: { ...process.env, GSB_CLI_SESSION: join(tmpdir(), "unused-gsb-session.json") },
    });

    assert.equal(result.exitCode, 1);
    const issues = result.payload.issues as Array<Record<string, unknown>>;
    assert.equal(issues[0]?.code, "DATASET_NAME_CONFLICT");
    assert.equal(JSON.stringify(result.payload).includes("supported_strategies"), true);
  } finally {
    await close(server);
  }
});

test("CLI uploads and binds one AIDP-compatible JSONL dataset", async () => {
  const root = mkdtempSync(join(tmpdir(), "gsb-cli-jsonl-"));
  const input = join(root, "input.jsonl");
  writeFileSync(input, JSON.stringify({
    taskName: "launch eval",
    queryId: "q-1",
    query: "what should I buy?",
    versionAName: "model-a",
    versionBName: "model-b",
    responseA: "answer a",
    responseB: "answer b",
    productCardsA: [],
    productCardsB: [],
  }) + "\n");
  const seen: Array<{ path: string; body: unknown }> = [];
  const server = createServer(async (req, res) => {
    const body = await readJson(req);
    seen.push({ path: req.url || "", body });
    if (req.method === "POST" && req.url === "/api/datasets/upload") {
      return sendJson(res, { ok: true, id: "ds_jsonl", name: "input", format: "aidp-jsonl", row_count: 1, json_count: 1 });
    }
    if (req.method === "GET" && req.url === "/api/datasets") {
      return sendJson(res, { my: [{ id: "ds_jsonl", name: "input", path: "/srv/input", format: "aidp-jsonl", row_count: 1, json_count: 1 }], others: [] });
    }
    if (req.method === "POST" && req.url === "/tasks/task_1/api/select-dirs") {
      return sendJson(res, { ok: true, task_id: "task_1", input_format: "aidp-jsonl", common_count: 1 });
    }
    return sendJson(res, { error: "not found" }, 404);
  });
  await listen(server);
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const env = { ...process.env, GSB_CLI_SESSION: join(tmpdir(), "unused-gsb-session.json") };

    const upload = await runCli(["dataset", "upload", "--input", input, "--base-url", baseUrl, "--json"], { env });
    assert.equal(upload.exitCode, 0);
    const uploadBody = seen.find((item) => item.path === "/api/datasets/upload")?.body as Record<string, unknown>;
    assert.equal(uploadBody.format, "aidp-jsonl");
    assert.deepEqual(Object.keys(uploadBody.files as Record<string, string>), ["input.jsonl"]);

    const bind = await runCli(["task", "bind", "task_1", "--input", "ds_jsonl", "--base-url", baseUrl, "--json"], { env });
    assert.equal(bind.exitCode, 0);
    const bindBodies = seen.filter((item) => item.path === "/tasks/task_1/api/select-dirs");
    assert.deepEqual(bindBodies[0]?.body, { dataset_id: "ds_jsonl" });
  } finally {
    await close(server);
  }
});

test("task get returns agent-facing task status without raw internal config", async () => {
  const server = createServer(async (req, res) => {
    await readJson(req);
    if (req.method === "GET" && req.url === "/api/tasks/task_1/status") {
      return sendJson(res, {
        ok: true,
        message: "任务状态",
        task: { id: "task_1", name: "launch eval", status: "draft", mode: "gsb", owner: "pm" },
        agent_summary: { state: "ready_to_publish", can_publish: true, next_command: "gsb-cli task publish task_1 --json" },
        datasets: { mode: "gsb", versions: { a: "baseline", b: "candidate" }, counts: { a: 200, b: 200, common: 200 } },
        setup: { complete: true, total_items: 200, min_per_person: 30, anchor_count: 3, eval_dimensions: [] },
        visibility: { transparent_mode: "admin_only", stats: "admin_only", show_trace: false, require_comments: false },
        readiness: { ok: true, failures: [], warnings: [], next_command: "gsb-cli task publish task_1 --json" },
        report: { exists: false },
        next_commands: ["gsb-cli task publish task_1 --json"],
      });
    }
    return sendJson(res, { error: "not found" }, 404);
  });
  await listen(server);
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const result = await runCli(["task", "get", "task_1", "--base-url", baseUrl, "--json"], {
      env: { ...process.env, GSB_CLI_SESSION: join(tmpdir(), "unused-gsb-session.json") },
    });

    assert.equal(result.exitCode, 0);
    assert.equal((result.payload.agent_summary as Record<string, unknown>).state, "ready_to_publish");
    assert.equal(JSON.stringify(result.payload).includes("dir_a"), false);
    assert.equal(JSON.stringify(result.payload).includes("config"), false);
    assert.deepEqual(result.payload.urls, {
      manage: `${baseUrl}/tasks/task_1/manage/`,
      evaluate: `${baseUrl}/tasks/task_1/`,
    });
  } finally {
    await close(server);
  }
});

test("task get preserves three-model Review versions and counts", async () => {
  const server = createServer(async (req, res) => {
    await readJson(req);
    if (req.method === "GET" && req.url === "/api/tasks/triple_review/status") {
      return sendJson(res, {
        ok: true,
        task: { id: "triple_review", name: "A/B/C Review", status: "active", mode: "review", owner: "pm" },
        agent_summary: { state: "published", can_publish: false },
        datasets: {
          mode: "review",
          versions: { a: "P20613", b: "P20725", c: "P30725" },
          counts: { a: 50, b: 50, c: 50, common: 50 },
        },
        setup: { complete: true, total_items: 50, min_per_person: 50, anchor_count: 0 },
        visibility: { transparent_mode: "admin_only", stats: "admin_only", show_trace: false, require_comments: false },
        readiness: { ok: true, failures: [], warnings: [] },
        report: { exists: false },
      });
    }
    return sendJson(res, { error: "not found" }, 404);
  });
  await listen(server);
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const result = await runCli([
      "task", "get", "triple_review", "--base-url", baseUrl, "--json",
    ], {
      env: { ...process.env, GSB_CLI_SESSION: join(tmpdir(), "unused-gsb-session.json") },
    });

    assert.equal(result.exitCode, 0);
    assert.deepEqual(result.payload.datasets, {
      mode: "review",
      versions: { a: "P20613", b: "P20725", c: "P30725" },
      counts: { a: 50, b: 50, c: 50, common: 50 },
    });
  } finally {
    await close(server);
  }
});

test("task setup explains generated assignment and points to task config", async () => {
  const server = createServer(async (req, res) => {
    await readJson(req);
    if (req.method === "POST" && req.url === "/tasks/task_1/api/setup") {
      return sendJson(res, {
        ok: true,
        config: {
          total_items: 20,
          min_per_person: 10,
          anchor_items: ["q1", "q2"],
          evaluator_order: ["pm"],
          eval_dimensions: [{ id: "product_presentation", name: "商品表达", required: true }],
        },
      });
    }
    return sendJson(res, { error: "not found" }, 404);
  });
  await listen(server);
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const env = { ...process.env, GSB_CLI_SESSION: join(tmpdir(), "unused-gsb-session.json") };

    const result = await runCli(["task", "setup", "task_1", "--base-url", baseUrl, "--min-per-person", "10", "--json"], { env });

    assert.equal(result.exitCode, 0);
    assert.deepEqual(result.payload.setup_effects, {
      total_items: 20,
      min_per_person: 10,
      anchor_items_count: 2,
      anchor_items_preview: ["q1", "q2"],
      eval_dimensions: [{ id: "product_presentation", name: "商品表达", required: true }],
      evaluator_order_count: 1,
    });
    const warnings = result.payload.warnings as Array<Record<string, unknown>>;
    assert.equal(warnings.some((item) => item.code === "TASK_VISIBILITY_CONFIG_SEPARATE"), true);
    const next = result.payload.next_commands as string[];
    assert.match(next[0], /task config task_1/);
  } finally {
    await close(server);
  }
});

test("task create-gsb runs create bind setup config and preflight with defaults", async () => {
  const seen: Array<{ method: string; path: string; body: unknown }> = [];
  const server = createServer(async (req, res) => {
    const body = await readJson(req);
    seen.push({ method: req.method || "", path: req.url || "", body });
    if (req.method === "POST" && req.url === "/api/tasks") {
      return sendJson(res, { ok: true, task: { id: "task_1", name: "launch eval", status: "draft", mode: "gsb" } });
    }
    if (req.method === "GET" && req.url === "/api/datasets") {
      return sendJson(res, {
        my: [
          { id: "ds_jsonl", name: "launch-input", path: "/srv/uploads/pm/launch-input", format: "aidp-jsonl", row_count: 200, json_count: 200 },
        ],
        others: [],
      });
    }
    if (req.method === "POST" && req.url === "/tasks/task_1/api/select-dirs") {
      return sendJson(res, { ok: true, task_id: "task_1", data_mode: "gsb", common_count: 200 });
    }
    if (req.method === "POST" && req.url === "/tasks/task_1/api/setup") {
      return sendJson(res, {
        ok: true,
        config: { total_items: 200, min_per_person: 30, anchor_items: ["q1", "q2", "q3"], eval_dimensions: [] },
      });
    }
    if (req.method === "POST" && req.url === "/tasks/task_1/api/admin-config") {
      return sendJson(res, { ok: true, visibility: (body as { visibility?: unknown }).visibility });
    }
    if (req.method === "GET" && req.url === "/api/tasks/task_1/preflight") {
      return sendJson(res, { ok: true, failures: [], warnings: [], next_command: "gsb-cli task publish task_1 --json" });
    }
    if (req.method === "GET" && req.url === "/api/tasks/task_1/status") {
      return sendJson(res, {
        ok: true,
        message: "任务状态",
        task: { id: "task_1", name: "launch eval", status: "draft", mode: "gsb" },
        agent_summary: { state: "ready_to_publish", can_publish: true },
        datasets: { mode: "gsb", counts: { a: 200, b: 200, common: 200 } },
        setup: { complete: true, total_items: 200, min_per_person: 30, anchor_count: 3, eval_dimensions: [] },
        visibility: { transparent_mode: "admin_only", stats: "admin_only", show_trace: false, require_comments: false },
        readiness: { ok: true, failures: [], warnings: [] },
        report: { exists: false },
      });
    }
    return sendJson(res, { error: "not found" }, 404);
  });
  await listen(server);
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const create = await runCli([
      "task",
      "create-gsb",
      "--base-url",
      baseUrl,
      "--name",
      "launch eval",
      "--purpose",
      "Compare candidate",
      "--input",
      "ds_jsonl",
      "--json",
    ], { env: { ...process.env, GSB_CLI_SESSION: join(tmpdir(), "unused-gsb-session.json") } });

    assert.equal(create.exitCode, 0);
    assert.equal((create.payload.agent_summary as Record<string, unknown>).state, "ready_to_publish");
    const bind = seen.find((item) => item.path === "/tasks/task_1/api/select-dirs")?.body;
    assert.deepEqual(bind, { dataset_id: "ds_jsonl" });
    const setup = seen.find((item) => item.path === "/tasks/task_1/api/setup")?.body as Record<string, unknown>;
    assert.equal(setup.min_per_person, 30);
    assert.equal(setup.anchor_count, 3);
    const config = seen.find((item) => item.path === "/tasks/task_1/api/admin-config")?.body as { visibility?: Record<string, unknown> };
    assert.deepEqual(config.visibility, {
      transparent_mode: "admin_only",
      stats: "admin_only",
      show_trace: true,
      report_html: "public",
      require_comments: false,
    });
  } finally {
    await close(server);
  }
});

test("task configure combines setup and visibility updates", async () => {
  const seen: Array<{ method: string; path: string; body: unknown }> = [];
  const server = createServer(async (req, res) => {
    const body = await readJson(req);
    seen.push({ method: req.method || "", path: req.url || "", body });
    if (req.method === "GET" && req.url === "/api/tasks/task_1/status") {
      return sendJson(res, {
        ok: true,
        message: "任务状态",
        task: { id: "task_1", name: "launch eval", status: "draft", mode: "gsb" },
        agent_summary: { state: "ready_to_publish", can_publish: true },
        datasets: { mode: "gsb", counts: { a: 200, b: 200, common: 200 } },
        setup: { complete: true, total_items: 200, min_per_person: 30, anchor_count: 3, task_description: "old desc", eval_dimensions: [] },
        visibility: { transparent_mode: "admin_only", stats: "admin_only", show_trace: false, require_comments: false },
        readiness: { ok: true, failures: [], warnings: [] },
        report: { exists: false },
      });
    }
    if (req.method === "POST" && req.url === "/tasks/task_1/api/setup") {
      return sendJson(res, { ok: true, config: { total_items: 200, min_per_person: 30, anchor_items: ["q1", "q2", "q3"], eval_dimensions: [] } });
    }
    if (req.method === "POST" && req.url === "/tasks/task_1/api/admin-config") {
      return sendJson(res, { ok: true, visibility: (body as { visibility?: unknown }).visibility });
    }
    if (req.method === "GET" && req.url === "/api/tasks/task_1/preflight") {
      return sendJson(res, { ok: true, failures: [], warnings: [], next_command: "gsb-cli task publish task_1 --json" });
    }
    return sendJson(res, { error: "not found" }, 404);
  });
  await listen(server);
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const result = await runCli([
      "task",
      "configure",
      "task_1",
      "--base-url",
      baseUrl,
      "--min-per-person",
      "auto",
      "--require-comments",
      "true",
      "--show-trace",
      "false",
      "--json",
    ], { env: { ...process.env, GSB_CLI_SESSION: join(tmpdir(), "unused-gsb-session.json") } });

    assert.equal(result.exitCode, 0);
    const setup = seen.find((item) => item.path === "/tasks/task_1/api/setup")?.body as Record<string, unknown>;
    assert.equal(setup.min_per_person, 30);
    assert.equal(setup.anchor_count, 3);
    assert.equal(setup.task_description, "old desc");
    const config = seen.find((item) => item.path === "/tasks/task_1/api/admin-config")?.body as { visibility?: Record<string, unknown> };
    assert.deepEqual(config.visibility, { show_trace: false, require_comments: true });
  } finally {
    await close(server);
  }
});

test("CLI reads and downloads archived task reports from the remote platform", async () => {
  const seen: Array<string> = [];
  const server = createServer(async (req, res) => {
    seen.push(`${req.method} ${req.url}`);
    if (req.method === "GET" && req.url === "/tasks/task_1/api/reports") {
      return sendJson(res, {
        exists: true,
        latest_html: "decision_report.html",
        latest_json: "decision_summary.json",
        url: "/tasks/task_1/report/decision_report.html",
        summary_url: "/tasks/task_1/report/decision_summary.json",
        review_url: "/tasks/task_1/report/review_report.html",
        algorithm_url: "/tasks/task_1/report/decision_report.html",
        cqc_url: "/tasks/task_1/report/cqc_report.html",
        aggregate_dir: "",
        html_files: ["decision_report.html"],
        json_files: ["decision_summary.json"],
        html_sources: [{ file: "decision_report.html", source: "task" }],
        json_sources: [{ file: "decision_summary.json", source: "task" }],
      });
    }
    if (req.method === "GET" && req.url === "/tasks/task_1/report/decision_report.html") {
      res.statusCode = 200;
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end("<html><body>report</body></html>");
      return;
    }
    return sendJson(res, { error: "not found" }, 404);
  });
  await listen(server);
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const outDir = mkdtempSync(join(tmpdir(), "gsb-cli-report-"));
    const outFile = join(outDir, "report.html");
    const env = { ...process.env, GSB_CLI_SESSION: join(tmpdir(), "unused-gsb-session.json") };

    const status = await runCli(["report", "status", "task_1", "--base-url", baseUrl, "--json"], { env });
    assert.equal(status.exitCode, 0);
    assert.equal(status.payload.message, "已找到归档分析报告");
    const report = status.payload.report as Record<string, unknown>;
    assert.equal(report.aggregate_dir, "");
    assert.deepEqual(report.html_sources, [{ file: "decision_report.html", source: "task" }]);
    assert.deepEqual(report.json_sources, [{ file: "decision_summary.json", source: "task" }]);
    assert.deepEqual(status.payload.urls, {
      report: `${baseUrl}/tasks/task_1/report/decision_report.html`,
      summary: `${baseUrl}/tasks/task_1/report/decision_summary.json`,
      review: `${baseUrl}/tasks/task_1/report/review_report.html`,
      algorithm: `${baseUrl}/tasks/task_1/report/decision_report.html`,
      cqc: `${baseUrl}/tasks/task_1/report/cqc_report.html`,
    });

    const download = await runCli(["report", "download", "task_1", "--base-url", baseUrl, "--type", "html", "--output", outFile, "--json"], { env });
    assert.equal(download.exitCode, 0);
    assert.equal(readFileSync(outFile, "utf8"), "<html><body>report</body></html>");
    assert.deepEqual(seen, [
      "GET /tasks/task_1/api/reports",
      "GET /tasks/task_1/api/reports",
      "GET /tasks/task_1/report/decision_report.html",
    ]);
  } finally {
    await close(server);
  }
});

test("CLI exports report review corrections and CQC consistency", async () => {
  const server = createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/tasks/task_1/api/review-data") {
      return sendJson(res, {
        query_reviews: [
          {
            query_id: "q-1",
            reviewer_id: "owner",
            review_status: "completed",
            review_schema_version: "chatbuy-query-review/v2",
            pointwise_reviews: {
              candidate: { score: 0, rationale: "底线问题", worker_feedback: "需识别底线问题" },
            },
            pairwise_reviews: {
              overall: { score: 0, rationale: "两版相当", worker_feedback: "整体胜负需重判" },
            },
            comment_decisions: {
              "worker-a::candidate:0": { decision: "accepted" },
              "worker-a::general:0": { decision: "rejected", rationale: "与原文不符" },
            },
            case_issue_reviews: {
              response_issue_sets: {
                candidate: { issues: [{ issue_id: "issue-1", label: "专业性不足", cause_role: "primary", issue_scope: "pointwise", issue_scopes: ["pointwise", "relative"], summary: "人工修正后的原因" }] },
                baseline: { issues: [] },
              },
              relative_issue_set: { target_model: "candidate", baseline_model: "baseline", issues: [] },
            },
          },
        ],
        case_review_drafts: [
          {
            query_id: "q-1",
            response_issue_sets: {
              candidate: { issues: [{ issue_id: "issue-1", label: "专业性不足", cause_role: "primary", issue_scope: "pointwise", issue_scopes: ["pointwise"], summary: "AI 原因" }] },
              baseline: { issues: [] },
            },
            relative_issue_set: { target_model: "candidate", baseline_model: "baseline", issues: [] },
          },
        ],
        records: [
          {
            query_id: "q-1",
            evaluator: "worker-a",
            pointwise_scores_by_model: { candidate: 1, baseline: 2 },
            pairwise_dimension_ids: ["overall", "need_fit"],
            pointwise_corrections: { candidate: {
              original_score: 1,
              corrected_score: 0,
              reason_code: "missed_issue",
              rationale: "回答存在底线问题，应为 0 分",
              worker_feedback: "漏掉底线问题",
              comment_refs: ["candidate:0"],
            } },
            pairwise_corrections: { overall: {
              candidate_model_id: "candidate",
              baseline_model_id: "baseline",
              original_score: -1,
              corrected_score: 0,
              reason_code: "wrong_judgment",
              rationale: "两版整体表现相当",
              worker_feedback: "整体胜负判断偏差",
              comment_refs: ["general:0"],
            } },
            reviewer_id: "owner",
            reviewed_at: "2026-08-29T10:00:00+08:00",
          },
          {
            query_id: "q-2",
            evaluator: "worker-a",
            pointwise_scores_by_model: { candidate: 2, baseline: 2 },
            pairwise_dimension_ids: ["overall", "need_fit"],
            pointwise_corrections: {},
            pairwise_corrections: {},
          },
        ],
      });
    }
    return sendJson(res, { error: "not found" }, 404);
  });
  await listen(server);
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const outDir = mkdtempSync(join(tmpdir(), "gsb-cli-report-review-"));
    const outFile = join(outDir, "review.json");
    const result = await runCli([
      "report", "review", "task_1", "--base-url", baseUrl, "--output", outFile, "--json",
    ], { env: { ...process.env, GSB_CLI_SESSION: join(tmpdir(), "unused-gsb-session.json") } });

    assert.equal(result.exitCode, 0);
    const review = result.payload.review as Record<string, unknown>;
    assert.equal(review.corrected_question_count, 1);
    assert.equal(review.corrected_score_count, 2);
    assert.equal(review.covered_score_count, 8);
    assert.equal(review.cqc_consistency_rate, 0.75);
    const querySummary = review.query_review_summary as Record<string, unknown>;
    assert.equal(querySummary.reviewed_question_count, 1);
    assert.equal(querySummary.completed_question_count, 1);
    assert.equal(querySummary.final_score_count, 2);
    assert.equal(querySummary.accepted_comment_count, 1);
    assert.equal(querySummary.rejected_comment_count, 1);
    assert.equal(querySummary.final_issue_count, 1);
    assert.equal(querySummary.primary_issue_count, 1);
    assert.equal(querySummary.issue_modified_count, 1);
    assert.equal((querySummary.by_reviewer as Array<Record<string, unknown>>)[0].reviewer_id, "owner");
    assert.equal((review.by_question as Array<Record<string, unknown>>)[0].query_id, "q-1");
    assert.equal((review.by_question as Array<Record<string, unknown>>)[0].corrected_scores, 2);
    const exported = JSON.parse(readFileSync(outFile, "utf8"));
    assert.equal(exported.corrections.length, 1);
    assert.equal(exported.corrections[0].pointwise_corrections.candidate.rationale, "回答存在底线问题，应为 0 分");
    assert.equal(exported.corrections[0].pairwise_corrections.overall.worker_feedback, "整体胜负判断偏差");
  } finally {
    await close(server);
  }
});

test("CLI uploads archived task reports to the remote platform", async () => {
  const seen: Array<{ method: string; path: string; body: unknown }> = [];
  const server = createServer(async (req, res) => {
    const body = await readJson(req);
    seen.push({ method: req.method || "", path: req.url || "", body });
    if (req.method === "POST" && req.url === "/tasks/task_1/api/reports") {
      return sendJson(res, {
        ok: true,
        saved: Object.keys((body as { files?: Record<string, string> }).files || {}),
        skipped: [],
        report: {
          exists: true,
          latest_html: "decision_report.html",
          latest_json: "decision_summary.json",
          url: "/tasks/task_1/report/decision_report.html",
          summary_url: "/tasks/task_1/report/decision_summary.json",
        },
      });
    }
    return sendJson(res, { error: "not found" }, 404);
  });
  await listen(server);
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const reportDir = mkdtempSync(join(tmpdir(), "gsb-cli-report-upload-"));
    const htmlFile = join(reportDir, "decision_report.html");
    const jsonFile = join(reportDir, "decision_summary.json");
    writeFileSync(htmlFile, "<html><body>report</body></html>");
    writeFileSync(jsonFile, "{\"ok\":true}");

    const upload = await runCli([
      "report",
      "upload",
      "task_1",
      "--base-url",
      baseUrl,
      htmlFile,
      jsonFile,
      "--json",
    ], { env: { ...process.env, GSB_CLI_SESSION: join(tmpdir(), "unused-gsb-session.json") } });

    assert.equal(upload.exitCode, 0);
    assert.deepEqual(upload.payload.saved, ["decision_report.html", "decision_summary.json"]);
    assert.deepEqual(upload.payload.urls, {
      report: `${baseUrl}/tasks/task_1/report/decision_report.html`,
      summary: `${baseUrl}/tasks/task_1/report/decision_summary.json`,
    });
    assert.deepEqual(seen[0]?.body, {
      files: {
        "decision_report.html": "<html><body>report</body></html>",
        "decision_summary.json": "{\"ok\":true}",
      },
    });
  } finally {
    await close(server);
  }
});

test("CLI uploads the Review stage without final report or CQC files", async () => {
  const seen: Array<{ method: string; path: string; body: unknown }> = [];
  const server = createServer(async (req, res) => {
    const body = await readJson(req);
    seen.push({ method: req.method || "", path: req.url || "", body });
    if (req.method === "POST" && req.url === "/tasks/task_1/api/reports") {
      return sendJson(res, {
        ok: true,
        saved: Object.keys((body as { files?: Record<string, string> }).files || {}),
        skipped: [],
        report: {
          exists: true,
          review_url: "/tasks/task_1/report/review_report.html",
        },
      });
    }
    return sendJson(res, { error: "not found" }, 404);
  });
  await listen(server);
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const reportDir = mkdtempSync(join(tmpdir(), "gsb-cli-review-stage-upload-"));
    const reviewFile = join(reportDir, "review_report.html");
    const draftFile = join(reportDir, "case-review-draft.jsonl");
    writeFileSync(reviewFile, "<html><body>Review</body></html>");
    writeFileSync(draftFile, '{"query_id":"q-1"}\n');

    const upload = await runCli([
      "report", "upload", "task_1", "--base-url", baseUrl,
      reviewFile, draftFile, "--json",
    ], { env: { ...process.env, GSB_CLI_SESSION: join(tmpdir(), "unused-gsb-session.json") } });

    assert.equal(upload.exitCode, 0);
    assert.deepEqual(upload.payload.saved, ["review_report.html", "case-review-draft.jsonl"]);
    assert.deepEqual(seen[0]?.body, {
      files: {
        "review_report.html": "<html><body>Review</body></html>",
        "case-review-draft.jsonl": '{"query_id":"q-1"}\n',
      },
    });
  } finally {
    await close(server);
  }
});

test("CLI rejects fixed task review links in a v2 decision report before upload", async () => {
  const reportDir = mkdtempSync(join(tmpdir(), "gsb-cli-report-v2-preflight-"));
  const htmlFile = join(reportDir, "decision_report.html");
  const jsonFile = join(reportDir, "decision_summary.json");
  writeFileSync(htmlFile, '<html><a href="/tasks/task_1/review/?q=q1">case</a></html>');
  writeFileSync(jsonFile, JSON.stringify({
    protocol_version: "gsb-decision-v2",
    source_analysis_run_id: "run-1",
  }));

  const upload = await runCli([
    "report", "upload", "task_1", htmlFile, jsonFile, "--json",
  ], { env: { ...process.env, GSB_CLI_SESSION: join(tmpdir(), "unused-gsb-session.json") } });

  assert.equal(upload.exitCode, 2);
  assert.match(String(upload.payload.message), /review links must use/);
});

test("CLI requires all two-stage artifacts when a v2 decision report links them", async () => {
  const reportDir = mkdtempSync(join(tmpdir(), "gsb-cli-report-two-stage-preflight-"));
  const htmlFile = join(reportDir, "decision_report.html");
  const jsonFile = join(reportDir, "decision_summary.json");
  writeFileSync(htmlFile, '<html><a href="review_report.html">Review</a><a href="cqc_report.html">CQC</a></html>');
  writeFileSync(jsonFile, JSON.stringify({
    protocol_version: "gsb-decision-v2",
    source_analysis_run_id: "run-1",
  }));

  const upload = await runCli([
    "report", "upload", "task_1", htmlFile, jsonFile, "--json",
  ], { env: { ...process.env, GSB_CLI_SESSION: join(tmpdir(), "unused-gsb-session.json") } });

  assert.equal(upload.exitCode, 2);
  assert.match(String(upload.payload.message), /two-stage upload requires/);
});

test("CLI rejects fixed task artifact links in a v2 decision report before upload", async () => {
  const reportDir = mkdtempSync(join(tmpdir(), "gsb-cli-report-v2-artifact-preflight-"));
  const htmlFile = join(reportDir, "decision_report.html");
  const jsonFile = join(reportDir, "decision_summary.json");
  writeFileSync(htmlFile, '<html><a data-web-href="/tasks/task_1/artifacts/download?path=benchmark.jsonl">download</a></html>');
  writeFileSync(jsonFile, JSON.stringify({
    protocol_version: "gsb-decision-v2",
    source_analysis_run_id: "run-1",
  }));

  const upload = await runCli([
    "report", "upload", "task_1", htmlFile, jsonFile, "--json",
  ], { env: { ...process.env, GSB_CLI_SESSION: join(tmpdir(), "unused-gsb-session.json") } });

  assert.equal(upload.exitCode, 2);
  assert.match(String(upload.payload.message), /artifact links must use/);
});

test("CLI archives a completed task through the remote platform API", async () => {
  const seen: Array<string> = [];
  const server = createServer(async (req, res) => {
    seen.push(`${req.method} ${req.url}`);
    if (req.method === "POST" && req.url === "/api/tasks/task_1/archive") {
      return sendJson(res, { ok: true, status: "archived" });
    }
    return sendJson(res, { error: "not found" }, 404);
  });
  await listen(server);
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const env = { ...process.env, GSB_CLI_SESSION: join(tmpdir(), "unused-gsb-session.json") };

    const result = await runCli(["task", "archive", "task_1", "--base-url", baseUrl, "--json"], { env });

    assert.equal(result.exitCode, 0);
    assert.equal(result.payload.status, "archived");
    assert.deepEqual(seen, ["POST /api/tasks/task_1/archive"]);
  } finally {
    await close(server);
  }
});

test("skill install copies bundled skill into the selected Agent skills directory", async () => {
  const root = mkdtempSync(join(tmpdir(), "gsb-cli-skill-"));
  const codexRoot = join(root, "codex-skills");
  const env = {
    ...process.env,
    GSB_CLI_CODEX_SKILLS_DIR: codexRoot,
  };

  const install = await runCli(["skill", "install", "--target", "codex", "--mode", "copy", "--force", "--json"], { env });
  assert.equal(install.exitCode, 0);
  assert.equal(existsSync(join(codexRoot, "gsb-cli", "SKILL.md")), true);
  assert.equal(existsSync(join(codexRoot, "gsb-cli", "references", "agent-cli.md")), true);
  assert.equal(existsSync(join(codexRoot, "gsb-cli", "references", "data-format.md")), true);
  const installedSkill = readFileSync(join(codexRoot, "gsb-cli", "SKILL.md"), "utf8");
  assert.match(installedSkill, /name: gsb-cli/);
  assert.match(installedSkill, /gsb-analysis/);

  const status = await runCli(["skill", "status", "--target", "codex", "--json"], { env });
  assert.equal(status.exitCode, 0);
  const skill = status.payload.skill as { targets?: Array<Record<string, unknown>> };
  assert.equal(skill.targets?.[0]?.mode, "copy");
  assert.equal(skill.targets?.[0]?.valid, true);
});

test("skill install can symlink bundled skill for development", async () => {
  const root = mkdtempSync(join(tmpdir(), "gsb-cli-skill-link-"));
  const cursorRoot = join(root, "cursor-skills");
  const env = {
    ...process.env,
    GSB_CLI_CURSOR_SKILLS_DIR: cursorRoot,
  };

  const install = await runCli(["skill", "install", "--target", "cursor", "--mode", "symlink", "--force", "--json"], { env });
  assert.equal(install.exitCode, 0);
  assert.equal(lstatSync(join(cursorRoot, "gsb-cli")).isSymbolicLink(), true);
});

test("version command reports newer remote version without changing JSON shape", async () => {
  const server = createServer(async (_req, res) => {
    return sendJson(res, { version: "9.9.9" });
  });
  await listen(server);
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const env = {
      ...process.env,
      GSB_CLI_UPDATE_CACHE: join(mkdtempSync(join(tmpdir(), "gsb-cli-update-")), "cache.json"),
      GSB_CLI_LATEST_VERSION_URL: `http://127.0.0.1:${address.port}/latest.json`,
      GSB_CLI_NPM_PACKAGE: "",
      GSB_CLI_GITHUB_PACKAGE_URL: "",
    };

    const result = await runCli(["version", "--check", "--json"], { env });

    assert.equal(result.exitCode, 0);
    const update = result.payload.update as Record<string, unknown>;
    assert.equal(update.available, true);
    assert.equal(update.latest, "9.9.9");
  } finally {
    await close(server);
  }
});

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("error", reject);
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) {
        resolve({});
        return;
      }
      resolve(JSON.parse(raw));
    });
  });
}

function sendJson(res: ServerResponse, body: unknown, status = 200): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

function listen(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
}

function close(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}
