import { strict as assert } from "node:assert";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runCli } from "../src/commands.js";

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
      return sendJson(res, { task: { id: "task_remote", name: (body as { name?: string }).name, status: "draft", mode: "gsb" } });
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

    const create = await runCli(["task", "create", "--base-url", baseUrl, "--name", "remote task", "--json"], { env });
    assert.equal(create.exitCode, 0);
    assert.deepEqual(create.payload.task, { id: "task_remote", name: "remote task", status: "draft", mode: "gsb" });
    assert.deepEqual(seen.map((item) => `${item.method} ${item.path}`), [
      "POST /api/auth/login",
      "POST /api/tasks",
    ]);
  } finally {
    await close(server);
  }
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
