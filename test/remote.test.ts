import { strict as assert } from "node:assert";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

test("CLI logs in and creates a task against the server selected by --base-url", async () => {
  const seen: Array<{ method: string; path: string; body: unknown; cookie: string }> = [];
  const server = createServer(async (req, res) => {
    const body = await readJson(req);
    seen.push({
      method: req.method || "",
      path: req.url || "",
      body,
      cookie: req.headers.cookie || "",
    });
    if (req.method === "POST" && req.url === "/api/auth/login") {
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
          mode: "gsb",
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
    assert.equal(JSON.parse(readFileSync(sessionFile, "utf8")).default.session_token, "remote-session");

    const create = await runCli([
      "task",
      "create",
      "--base-url",
      baseUrl,
      "--name",
      "remote task",
      "--purpose",
      "Compare answer quality for the launch candidate.",
      "--json",
    ], { env });
    assert.equal(create.exitCode, 0);
    assert.deepEqual(create.payload.task, {
      id: "task_remote",
      name: "remote task",
      purpose: "Compare answer quality for the launch candidate.",
      status: "draft",
      mode: "gsb",
    });
    assert.deepEqual(seen[1]?.body, {
      name: "remote task",
      purpose: "Compare answer quality for the launch candidate.",
      mode: "gsb",
      task_id: "",
    });
    assert.deepEqual(seen.map((item) => `${item.method} ${item.path}`), [
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
    if (req.method === "POST" && req.url === "/api/auth/register") {
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
    assert.deepEqual(seen[0]?.body, { username: "new_user", password: "secret123" });
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
          { id: "ds_a", name: "baseline", path: "/srv/uploads/pm/baseline", json_count: 200 },
          { id: "ds_b", name: "candidate", path: "/srv/uploads/pm/candidate", json_count: 200 },
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
      "--a",
      "ds_a",
      "--b",
      "ds_b",
      "--json",
    ], { env: { ...process.env, GSB_CLI_SESSION: join(tmpdir(), "unused-gsb-session.json") } });

    assert.equal(create.exitCode, 0);
    assert.equal((create.payload.agent_summary as Record<string, unknown>).state, "ready_to_publish");
    const setup = seen.find((item) => item.path === "/tasks/task_1/api/setup")?.body as Record<string, unknown>;
    assert.equal(setup.min_per_person, 30);
    assert.equal(setup.anchor_count, 3);
    const config = seen.find((item) => item.path === "/tasks/task_1/api/admin-config")?.body as { visibility?: Record<string, unknown> };
    assert.deepEqual(config.visibility, {
      transparent_mode: "admin_only",
      stats: "admin_only",
      show_trace: false,
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
        html_files: ["decision_report.html"],
        json_files: ["decision_summary.json"],
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
    assert.deepEqual(status.payload.urls, {
      report: `${baseUrl}/tasks/task_1/report/decision_report.html`,
      summary: `${baseUrl}/tasks/task_1/report/decision_summary.json`,
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
  assert.equal(existsSync(join(codexRoot, "gsb-eval", "SKILL.md")), true);

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
  assert.equal(lstatSync(join(cursorRoot, "gsb-eval")).isSymbolicLink(), true);
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
