import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { ApiClient, ApiError, serverError } from "./api.js";
import { CliUsageError, OptionReader, parseArgs, requireArg } from "./args.js";
import { datasetCheckPayload, datasetPath, FORMAT_GUIDANCE, inspectDatasetDir, validFileMap } from "./dataset.js";
import { HELP_TEXT } from "./help.js";
import { hasErrors, issue, redactedArgv } from "./issues.js";
import { clearSession, expandHome, loadSessions, saveSession, sessionPath } from "./session.js";
import type { CliGlobals, CliResult, DatasetInfo, JsonObject, SessionData } from "./types.js";
import { CLI_VERSION, DEFAULT_BASE_URL } from "./version.js";

export interface RunOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

export async function runCli(rawArgv: string[], options: RunOptions = {}): Promise<CliResult> {
  try {
    const { globals, args } = parseArgs(rawArgv, options.env ?? process.env, options.cwd ?? process.cwd());
    if (globals.version) {
      return { payload: { ok: true, message: CLI_VERSION, cli_version: CLI_VERSION }, exitCode: 0 };
    }
    if (globals.help || args.length === 0) {
      return { payload: { ok: true, message: HELP_TEXT }, exitCode: 0 };
    }
    return await dispatch(globals, args);
  } catch (error) {
    if (error instanceof CliUsageError) {
      return {
        payload: {
          ok: false,
          message: error.message,
          issues: [issue("CLI_USAGE_ERROR", "error", error.message, {}, "命令参数不符合 CLI 语法。", "运行 gsb-cli --help 查看可用命令。")],
        },
        exitCode: 2,
      };
    }
    return {
      payload: {
        ok: false,
        message: "CLI 执行失败",
        issues: [issue(
          "CLI_INTERNAL_ERROR",
          "error",
          error instanceof Error ? error.message : String(error),
          {},
          "CLI 遇到未处理异常。",
          "保留命令输出并联系 CLI 维护者。",
        )],
      },
      exitCode: 1,
    };
  }
}

async function dispatch(globals: CliGlobals, args: string[]): Promise<CliResult> {
  const [command, subcommand] = args;
  const rest = args.slice(2);
  if (command === "doctor") {
    return cmdDoctor(globals);
  }
  if (command === "auth") {
    if (subcommand === "login") return cmdAuthLogin(globals);
    if (subcommand === "whoami") return cmdAuthWhoami(globals);
    if (subcommand === "logout") return cmdAuthLogout(globals);
  }
  if (command === "dataset") {
    if (subcommand === "check") return cmdDatasetCheck(globals, rest);
    if (subcommand === "upload") return cmdDatasetUpload(globals, rest);
    if (subcommand === "list") return cmdDatasetList(globals);
    if (subcommand === "guide") return { payload: { ok: true, message: "JSON 数据结构说明", format_guidance: FORMAT_GUIDANCE }, exitCode: 0 };
  }
  if (command === "task") {
    if (subcommand === "create") return cmdTaskCreate(globals, rest);
    if (subcommand === "get") return cmdTaskGet(globals, rest);
    if (subcommand === "bind") return cmdTaskBind(globals, rest);
    if (subcommand === "setup") return cmdTaskSetup(globals, rest);
    if (subcommand === "config") return cmdTaskConfig(globals, rest);
    if (subcommand === "preflight") return cmdTaskPreflight(globals, rest);
    if (subcommand === "publish") return cmdTaskPublish(globals, rest);
    if (subcommand === "archive") return cmdTaskArchive(globals, rest);
    if (subcommand === "renderer") return cmdTaskRenderer(globals, args.slice(2));
  }
  if (command === "report") {
    if (subcommand === "status") return cmdReportStatus(globals, rest);
    if (subcommand === "url") return cmdReportStatus(globals, rest);
    if (subcommand === "download") return cmdReportDownload(globals, rest);
  }
  if (command === "results") {
    if (subcommand === "summary") return cmdResultsSummary(globals, rest);
    if (subcommand === "export") return cmdResultsExport(globals, rest);
  }
  throw new CliUsageError(`unknown command: ${args.join(" ")}`);
}

async function cmdDoctor(globals: CliGlobals): Promise<CliResult> {
  const client = await buildClient(globals, { autoLogin: false });
  try {
    const user = await client.request<JsonObject>("GET", "/api/auth/me");
    return {
      payload: {
        ok: true,
        message: "平台可访问，当前 session 可用",
        cli_version: CLI_VERSION,
        base_url: client.baseUrl,
        reachable: true,
        auth: "valid",
        user,
      },
      exitCode: 0,
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return {
        payload: {
          ok: true,
          message: "平台可访问，需要登录",
          cli_version: CLI_VERSION,
          base_url: client.baseUrl,
          reachable: true,
          auth: "required",
        },
        exitCode: 0,
      };
    }
    if (error instanceof ApiError) {
      return {
        payload: {
          ok: false,
          message: "平台不可访问或 API 不兼容",
          cli_version: CLI_VERSION,
          base_url: client.baseUrl,
          reachable: false,
          issues: [issue(
            error.status === 0 ? "PLATFORM_UNREACHABLE" : "PLATFORM_API_INCOMPATIBLE",
            "error",
            "doctor 检查失败",
            { status: error.status, url: error.url, server_error: serverError(error.data) },
            "CLI 通过 --base-url 访问服务器端平台；该检查失败说明网络、认证入口或平台 API 有问题。",
            "确认 base URL、网络连通性和平台版本。",
            redactedArgv(globals.rawArgv),
          )],
        },
        exitCode: 1,
      };
    }
    throw error;
  }
}

async function cmdAuthLogin(globals: CliGlobals): Promise<CliResult> {
  const username = globals.username;
  const password = globals.password || globals.env.GSB_PASSWORD;
  if (!username || !password) {
    const item = issue(
      "AUTH_CREDENTIALS_REQUIRED_OR_INVALID",
      "error",
      "登录凭据缺失或不可用",
      { has_username: Boolean(username), has_password: Boolean(password) },
      "登录 API 需要 username 和 password。",
      "提供可用的用户名和密码；密码应通过环境变量或安全参数注入，不要写入仓库文件。",
      "gsb-cli auth login --username <user>",
    );
    return { payload: { ok: false, message: item.problem, issues: [item] }, exitCode: 1 };
  }

  const baseUrl = resolveBaseUrl(globals);
  const client = new ApiClient({ baseUrl });
  try {
    const data = await client.login(username, password);
    saveSession(sessionPath(globals.env), globals.profile, {
      base_url: client.baseUrl,
      username: String(data.username || username),
      role: String(data.role || ""),
      session_token: client.sessionToken,
    });
    const payload: JsonObject = {
      ok: true,
      message: "登录成功，session 已保存",
      profile: globals.profile,
      base_url: client.baseUrl,
      username: data.username,
      role: data.role,
      force_change_pw: Boolean(data.force_change_pw),
      next_commands: [
        "gsb-cli dataset list",
        "gsb-cli task create --name <task-name>",
      ],
    };
    if (data.force_change_pw) {
      payload.issues = [issue(
        "PASSWORD_CHANGE_REQUIRED",
        "warning",
        "当前账号被要求修改默认密码",
        { username: String(data.username || username) },
        "网页端会要求修改密码；CLI 目前不处理改密流程。",
        "在网页完成密码修改，或让管理员重置为可用密码后重新登录。",
        "gsb-cli auth login --username <user>",
      )];
    }
    return { payload, exitCode: 0 };
  } catch (error) {
    if (error instanceof ApiError) {
      const server = serverError(error.data);
      if ([400, 401].includes(error.status) && ["用户不存在", "密码错误", "Username and password required"].includes(server)) {
        const item = issue(
          "AUTH_CREDENTIALS_REQUIRED_OR_INVALID",
          "error",
          "登录凭据缺失或不可用",
          { status: error.status, server_error: server, has_username: Boolean(username), has_password: Boolean(password) },
          "登录 API 需要有效的 username 和 password。",
          "确认用户名和密码是否正确；如账号被重置或密码过期，请先处理账号状态后重新登录。",
          redactedArgv(globals.rawArgv),
        );
        return { payload: { ok: false, message: item.problem, issues: [item] }, exitCode: 1 };
      }
      return apiFailurePayload(error, "登录", globals);
    }
    throw error;
  }
}

async function cmdAuthWhoami(globals: CliGlobals): Promise<CliResult> {
  const client = await buildClient(globals);
  try {
    const data = await client.request<JsonObject>("GET", "/api/auth/me");
    return { payload: { ok: true, message: "当前 session 可用", base_url: client.baseUrl, user: data }, exitCode: 0 };
  } catch (error) {
    if (error instanceof ApiError) {
      return apiFailurePayload(error, "读取当前登录用户", globals, "gsb-cli auth login --username <user>");
    }
    throw error;
  }
}

async function cmdAuthLogout(globals: CliGlobals): Promise<CliResult> {
  const client = await buildClient(globals, { autoLogin: false });
  try {
    await client.request("POST", "/api/auth/logout", {});
  } catch {
    // Clearing local session is still useful when the remote session is already gone.
  }
  clearSession(sessionPath(globals.env), globals.profile);
  return { payload: { ok: true, message: "本地 session 已清除", profile: globals.profile }, exitCode: 0 };
}

function cmdDatasetCheck(globals: CliGlobals, args: string[]): CliResult {
  const reader = new OptionReader(args);
  const root = reader.takeOptionalString("root");
  const versionA = reader.takeOptionalString("version-a");
  const versionB = reader.takeOptionalString("version-b");
  const a = reader.takeOptionalString("a");
  const b = reader.takeOptionalString("b");
  reader.requireNoUnknown();
  const rest = reader.rest();

  let pathA: string | undefined;
  let pathB: string | undefined;
  if (root) {
    if (!versionA) {
      throw new CliUsageError("--root requires --version-a");
    }
    pathA = resolve(datasetPath(root), versionA);
    pathB = versionB ? resolve(datasetPath(root), versionB) : undefined;
  } else {
    pathA = a || rest[0];
    pathB = b;
  }
  if (!pathA) {
    throw new CliUsageError("dataset check requires DIR or --a");
  }
  const payload = datasetCheckPayload(pathA, pathB, redactedArgv(globals.rawArgv));
  return { payload, exitCode: payload.ok ? 0 : 1 };
}

async function cmdDatasetUpload(globals: CliGlobals, args: string[]): Promise<CliResult> {
  const reader = new OptionReader(args);
  const a = reader.takeOptionalString("a");
  const b = reader.takeOptionalString("b");
  const name = reader.takeOptionalString("name");
  const nameA = reader.takeOptionalString("name-a");
  const nameB = reader.takeOptionalString("name-b");
  reader.requireNoUnknown();
  const rest = reader.rest();
  const client = await buildClient(globals);

  let targets: Array<{ label: string; info: DatasetInfo; name?: string }> = [];
  let check: JsonObject;
  if (a || b) {
    if (!a || !b) {
      const item = issue(
        "PAIR_UPLOAD_REQUIRES_A_AND_B",
        "error",
        "缺少一个版本目录",
        { a: a || "", b: b || "" },
        "GSB 对比需要两个版本目录。",
        "补齐 --a 和 --b 后重新运行。",
        redactedArgv(globals.rawArgv),
      );
      return { payload: { ok: false, message: "成对上传需要同时提供 --a 和 --b", issues: [item] }, exitCode: 1 };
    }
    check = datasetCheckPayload(a, b, redactedArgv(globals.rawArgv));
    if (!check.ok) {
      return { payload: check, exitCode: 1 };
    }
    const datasets = check.datasets as Record<string, DatasetInfo>;
    targets = [
      { label: "a", info: datasets.a, name: nameA },
      { label: "b", info: datasets.b, name: nameB },
    ];
  } else {
    const dir = rest[0];
    if (!dir) {
      throw new CliUsageError("dataset upload requires DIR or --a/--b");
    }
    check = datasetCheckPayload(dir, undefined, redactedArgv(globals.rawArgv));
    if (!check.ok) {
      return { payload: check, exitCode: 1 };
    }
    const datasets = check.datasets as Record<string, DatasetInfo>;
    targets = [{ label: "dataset", info: datasets.a, name }];
  }

  const uploaded: JsonObject[] = [];
  try {
    for (const target of targets) {
      const res = await uploadOneDataset(client, target.info, target.name);
      uploaded.push({ label: target.label, ...res });
    }
  } catch (error) {
    if (error instanceof ApiError) {
      return apiFailurePayload(error, "上传数据集", globals);
    }
    throw error;
  }
  return {
    payload: {
      ok: true,
      message: "数据集上传完成",
      uploaded,
      warnings: (check.issues as JsonObject[]).filter((item) => item.severity === "warning"),
      next_commands: [
        "gsb-cli task create --name <task-name>",
        "gsb-cli task bind <task-id> --a <dataset-a-id> --b <dataset-b-id>",
      ],
    },
    exitCode: 0,
  };
}

async function cmdDatasetList(globals: CliGlobals): Promise<CliResult> {
  const client = await buildClient(globals);
  try {
    const data = await client.request<JsonObject>("GET", "/api/datasets");
    return { payload: { ok: true, message: "数据集列表", datasets: data }, exitCode: 0 };
  } catch (error) {
    if (error instanceof ApiError) {
      return apiFailurePayload(error, "获取数据集列表", globals);
    }
    throw error;
  }
}

async function cmdTaskCreate(globals: CliGlobals, args: string[]): Promise<CliResult> {
  const reader = new OptionReader(args);
  const name = reader.takeString("name", "");
  const mode = reader.takeString("mode", "gsb");
  const taskId = reader.takeString("task-id", "");
  reader.requireNoUnknown();
  if (!["gsb", "preview"].includes(mode)) {
    throw new CliUsageError("--mode must be gsb or preview");
  }
  const client = await buildClient(globals);
  try {
    const data = await client.request<JsonObject>("POST", "/api/tasks", { name, mode, task_id: taskId });
    const task = data.task && typeof data.task === "object" ? data.task as JsonObject : {};
    return {
      payload: {
        ok: true,
        message: "任务已创建",
        task,
        urls: {
          manage: `${client.baseUrl}/tasks/${task.id}/manage/`,
          evaluate: `${client.baseUrl}/tasks/${task.id}/`,
        },
        next_commands: [
          `gsb-cli task bind ${task.id} --a <dataset-a> --b <dataset-b>`,
          `gsb-cli task setup ${task.id} --min-per-person 0`,
        ],
      },
      exitCode: 0,
    };
  } catch (error) {
    if (error instanceof ApiError) return apiFailurePayload(error, "创建任务", globals);
    throw error;
  }
}

async function cmdTaskGet(globals: CliGlobals, args: string[]): Promise<CliResult> {
  const taskId = requireArg(args, 0, "task-id");
  const client = await buildClient(globals);
  try {
    const data = await client.request<JsonObject>("GET", `/api/tasks/${encodeURIComponent(taskId)}`);
    return { payload: { ok: true, message: "任务详情", task: data }, exitCode: 0 };
  } catch (error) {
    if (error instanceof ApiError) return apiFailurePayload(error, "读取任务详情", globals);
    throw error;
  }
}

async function cmdTaskBind(globals: CliGlobals, args: string[]): Promise<CliResult> {
  const taskId = requireArg(args, 0, "task-id");
  const reader = new OptionReader(args.slice(1));
  const a = reader.takeOptionalString("a");
  const b = reader.takeOptionalString("b");
  reader.requireNoUnknown();
  if (!a) {
    throw new CliUsageError("task bind requires --a");
  }
  const client = await buildClient(globals);
  try {
    const refs = [await resolveDatasetRef(client, a)];
    if (b) {
      refs.push(await resolveDatasetRef(client, b));
    }
    const data = await client.request<JsonObject>("POST", `/tasks/${encodeURIComponent(taskId)}/api/select-dirs`, {
      dirs: refs.map((ref) => ref.path),
    });
    const issues: JsonObject[] = [];
    if (data.data_mode === "gsb" && Number(data.common_count || 0) <= 0) {
      issues.push(issue(
        "ZERO_COMMON_ITEMS_AFTER_BIND",
        "error",
        "数据源已绑定但共同题数为 0",
        { count_a: data.count_a, count_b: data.count_b, common_count: data.common_count },
        "平台只展示 A/B 同名 JSON 文件。共同题数为 0 时发布会被 preflight 阻止。",
        "修正 A/B 文件名后重新上传并绑定。",
        `gsb-cli task preflight ${String(data.task_id || taskId)} --json`,
      ));
    }
    const ok = !hasErrors(issues);
    return {
      payload: {
        ok,
        message: ok ? "数据源已绑定" : "数据源绑定后发现阻塞问题",
        selection: data,
        resolved_refs: refs,
        issues,
        next_commands: [
          `gsb-cli task setup ${String(data.task_id || taskId)} --min-per-person 0`,
          `gsb-cli task preflight ${String(data.task_id || taskId)}`,
        ],
      },
      exitCode: ok ? 0 : 1,
    };
  } catch (error) {
    if (error instanceof DatasetRefError) {
      const item = issue(
        String(error.evidence.code || "DATASET_REF_ERROR"),
        "error",
        "数据集引用无法解析",
        error.evidence,
        "绑定接口需要服务端可访问的数据集路径。远端平台推荐先 dataset upload，再使用返回的 dataset id 绑定。",
        "先运行 dataset list，使用明确的 id；或先 dataset upload。",
        redactedArgv(globals.rawArgv),
      );
      return { payload: { ok: false, message: item.problem, issues: [item] }, exitCode: 1 };
    }
    if (error instanceof ApiError) return apiFailurePayload(error, "绑定数据源", globals);
    throw error;
  }
}

async function cmdTaskSetup(globals: CliGlobals, args: string[]): Promise<CliResult> {
  const taskId = requireArg(args, 0, "task-id");
  const reader = new OptionReader(args.slice(1));
  const name = reader.takeString("name", "");
  const descriptionFile = reader.takeOptionalString("description-file");
  const description = descriptionFile ? readFileSync(expandHome(descriptionFile), "utf8") : reader.takeString("description", "");
  const minPerPerson = reader.takeNumber("min-per-person", 0);
  const anchorCount = reader.takeNumber("anchor-count");
  reader.requireNoUnknown();
  const payload: JsonObject = {
    task_name: name,
    task_description: description,
    min_per_person: minPerPerson ?? 0,
  };
  if (anchorCount !== undefined) {
    payload.anchor_count = anchorCount;
  }
  const client = await buildClient(globals);
  try {
    const data = await client.request<JsonObject>("POST", `/tasks/${encodeURIComponent(taskId)}/api/setup`, payload);
    return {
      payload: {
        ok: true,
        message: "任务分配策略已保存",
        config: data.config ?? {},
        next_commands: [
          `gsb-cli task preflight ${taskId}`,
          `gsb-cli task publish ${taskId}`,
        ],
      },
      exitCode: 0,
    };
  } catch (error) {
    if (error instanceof ApiError) return apiFailurePayload(error, "配置任务分配策略", globals);
    throw error;
  }
}

async function cmdTaskConfig(globals: CliGlobals, args: string[]): Promise<CliResult> {
  const taskId = requireArg(args, 0, "task-id");
  const reader = new OptionReader(args.slice(1));
  const visibility: JsonObject = {};
  const transparentMode = reader.takeOptionalString("transparent-mode");
  const stats = reader.takeOptionalString("stats");
  const showTrace = reader.takeBoolean("show-trace");
  const requireComments = reader.takeBoolean("require-comments");
  reader.requireNoUnknown();
  if (transparentMode !== undefined) visibility.transparent_mode = transparentMode;
  if (stats !== undefined) visibility.stats = stats;
  if (showTrace !== undefined) visibility.show_trace = showTrace;
  if (requireComments !== undefined) visibility.require_comments = requireComments;
  if (!Object.keys(visibility).length) {
    const item = issue(
      "NO_CONFIG_FIELDS",
      "error",
      "task config 命令缺少要更新的字段",
      {},
      "空配置不会改变任务行为。",
      "传入 --transparent-mode、--stats、--show-trace 或 --require-comments。",
      redactedArgv(globals.rawArgv),
    );
    return { payload: { ok: false, message: "没有提供任何权限配置", issues: [item] }, exitCode: 1 };
  }
  const client = await buildClient(globals);
  try {
    const data = await client.request<JsonObject>("POST", `/tasks/${encodeURIComponent(taskId)}/api/admin-config`, { visibility });
    return { payload: { ok: true, message: "权限配置已保存", visibility: data.visibility ?? visibility }, exitCode: 0 };
  } catch (error) {
    if (error instanceof ApiError) return apiFailurePayload(error, "配置任务权限", globals);
    throw error;
  }
}

async function cmdTaskPreflight(globals: CliGlobals, args: string[]): Promise<CliResult> {
  const taskId = requireArg(args, 0, "task-id");
  const client = await buildClient(globals);
  try {
    const data = await client.request<JsonObject>("GET", `/api/tasks/${encodeURIComponent(taskId)}/preflight`);
    data.message = data.message || (data.ok ? "preflight 通过" : "preflight 失败");
    return { payload: data, exitCode: data.ok ? 0 : 1 };
  } catch (error) {
    if (error instanceof ApiError) return apiFailurePayload(error, "运行发布 preflight", globals);
    throw error;
  }
}

async function cmdTaskPublish(globals: CliGlobals, args: string[]): Promise<CliResult> {
  const taskId = requireArg(args, 0, "task-id");
  const client = await buildClient(globals);
  try {
    const preflight = await client.request<JsonObject>("GET", `/api/tasks/${encodeURIComponent(taskId)}/preflight`);
    if (!preflight.ok) {
      return {
        payload: {
          ok: false,
          message: "发布已阻止：preflight 存在阻塞问题",
          preflight,
          issues: preflight.failures ?? [],
        },
        exitCode: 1,
      };
    }
    const data = await client.request<JsonObject>("POST", `/api/tasks/${encodeURIComponent(taskId)}/publish`, {});
    return {
      payload: {
        ok: true,
        message: "任务已发布",
        status: data.status,
        preflight_warnings: preflight.warnings ?? [],
        urls: { evaluate: `${client.baseUrl}/tasks/${taskId}/` },
      },
      exitCode: 0,
    };
  } catch (error) {
    if (error instanceof ApiError) return apiFailurePayload(error, "发布任务", globals);
    throw error;
  }
}

async function cmdTaskArchive(globals: CliGlobals, args: string[]): Promise<CliResult> {
  const taskId = requireArg(args, 0, "task-id");
  const client = await buildClient(globals);
  try {
    const data = await client.request<JsonObject>("POST", `/api/tasks/${encodeURIComponent(taskId)}/archive`, {});
    return {
      payload: {
        ok: true,
        message: "任务已归档",
        task_id: taskId,
        status: data.status ?? "archived",
        server_response: data,
      },
      exitCode: 0,
    };
  } catch (error) {
    if (error instanceof ApiError) return apiFailurePayload(error, "归档任务", globals);
    throw error;
  }
}

async function cmdTaskRenderer(globals: CliGlobals, args: string[]): Promise<CliResult> {
  const subcommand = args[0];
  const taskId = requireArg(args, 1, "task-id");
  const client = await buildClient(globals);
  if (subcommand === "status") {
    try {
      const data = await client.request<JsonObject>("GET", `/tasks/${encodeURIComponent(taskId)}/api/renderer`);
      return { payload: { ok: true, message: "renderer 状态", renderer: data }, exitCode: 0 };
    } catch (error) {
      if (error instanceof ApiError) return apiFailurePayload(error, "读取 renderer 状态", globals);
      throw error;
    }
  }
  if (subcommand === "upload") {
    const file = requireArg(args, 2, "renderer-file");
    const path = expandHome(file);
    if (!existsSync(path) || !statSync(path).isFile()) {
      const item = issue(
        "RENDERER_FILE_NOT_FOUND",
        "error",
        "renderer 文件不存在",
        { path },
        "上传接口需要读取本地 renderer.js 内容。",
        "确认文件路径，或让 Agent 先生成 renderer.js。",
        redactedArgv(globals.rawArgv),
      );
      return { payload: { ok: false, message: item.problem, issues: [item] }, exitCode: 1 };
    }
    const content = readFileSync(path, "utf8");
    const warnings = content.includes("renderPanel")
      ? []
      : [issue(
        "RENDER_PANEL_NOT_FOUND",
        "warning",
        "renderer 中没有发现 renderPanel 标识",
        { path },
        "评估页通过 renderPanel(data, ...) 渲染左右面板；缺少该函数可能导致仍使用默认渲染。",
        "确认 renderer.js 定义了全局 renderPanel 函数。",
        redactedArgv(globals.rawArgv),
      )];
    try {
      const data = await client.request<JsonObject>("POST", `/tasks/${encodeURIComponent(taskId)}/api/renderer`, { content });
      return {
        payload: {
          ok: true,
          message: "renderer 已上传",
          server_response: data,
          warnings,
          next_commands: [`gsb-cli task preflight ${taskId}`],
        },
        exitCode: 0,
      };
    } catch (error) {
      if (error instanceof ApiError) return apiFailurePayload(error, "上传 renderer", globals);
      throw error;
    }
  }
  if (subcommand === "clear") {
    try {
      const data = await client.request<JsonObject>("DELETE", `/tasks/${encodeURIComponent(taskId)}/api/renderer`, {});
      return { payload: { ok: true, message: "已恢复全局默认 renderer", server_response: data }, exitCode: 0 };
    } catch (error) {
      if (error instanceof ApiError) return apiFailurePayload(error, "清除 renderer", globals);
      throw error;
    }
  }
  throw new CliUsageError("unknown task renderer command");
}

async function cmdReportStatus(globals: CliGlobals, args: string[]): Promise<CliResult> {
  const taskId = requireArg(args, 0, "task-id");
  const client = await buildClient(globals);
  try {
    const report = await getReportInfo(client, taskId);
    return {
      payload: {
        ok: true,
        message: report.exists ? "已找到归档分析报告" : "暂无归档分析报告",
        task_id: taskId,
        report,
        urls: buildReportUrls(client.baseUrl, report),
      },
      exitCode: 0,
    };
  } catch (error) {
    if (error instanceof ApiError) return apiFailurePayload(error, "读取归档分析报告", globals);
    throw error;
  }
}

async function cmdReportDownload(globals: CliGlobals, args: string[]): Promise<CliResult> {
  const taskId = requireArg(args, 0, "task-id");
  const reader = new OptionReader(args.slice(1));
  const type = reader.takeString("type", "html");
  const file = reader.takeOptionalString("file");
  const outputArg = reader.takeOptionalString("output");
  reader.requireNoUnknown();
  if (!["html", "json"].includes(type)) {
    throw new CliUsageError("--type must be html or json");
  }

  const client = await buildClient(globals);
  try {
    const report = await getReportInfo(client, taskId);
    if (!report.exists) {
      const item = issue(
        "REPORT_NOT_FOUND",
        "error",
        "暂无归档分析报告",
        { task_id: taskId, report },
        "平台只会展示已经写入任务 report 目录的归档报告；CLI 不会在本地生成远端报告。",
        "先在平台侧生成报告，确认任务管理页能看到“分析报告”，再重新运行 report download。",
        redactedArgv(globals.rawArgv),
      );
      return { payload: { ok: false, message: item.problem, issues: [item], report }, exitCode: 1 };
    }

    const selected = selectReportFile(taskId, report, type, file);
    const downloaded = await client.request("GET", selected.url, undefined, { expectBytes: true });
    let output = outputArg ? resolve(expandHome(outputArg)) : resolve(globals.cwd, selected.fileName);
    if (existsSync(output) && statSync(output).isDirectory()) {
      output = resolve(output, selected.fileName);
    }
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, downloaded.bytes);
    return {
      payload: {
        ok: true,
        message: "归档分析报告已下载",
        task_id: taskId,
        report_type: type,
        file_name: selected.fileName,
        output_path: output,
        bytes: downloaded.bytes.length,
        urls: buildReportUrls(client.baseUrl, report),
      },
      exitCode: 0,
    };
  } catch (error) {
    if (error instanceof ApiError) return apiFailurePayload(error, "下载归档分析报告", globals);
    throw error;
  }
}

async function cmdResultsSummary(globals: CliGlobals, args: string[]): Promise<CliResult> {
  const taskId = requireArg(args, 0, "task-id");
  const reader = new OptionReader(args.slice(1));
  const all = reader.takeFlag("all");
  reader.requireNoUnknown();
  const client = await buildClient(globals);
  const query = all ? "?all=1" : "";
  try {
    const data = await client.request<JsonObject>("GET", `/tasks/${encodeURIComponent(taskId)}/api/summary${query}`);
    return { payload: { ok: true, message: "评估结论摘要", summary: data }, exitCode: 0 };
  } catch (error) {
    if (error instanceof ApiError) return apiFailurePayload(error, "读取评估结论", globals);
    throw error;
  }
}

async function getReportInfo(client: ApiClient, taskId: string): Promise<JsonObject> {
  return client.request<JsonObject>("GET", `/tasks/${encodeURIComponent(taskId)}/api/reports`);
}

function buildReportUrls(baseUrl: string, report: JsonObject): JsonObject {
  const urls: JsonObject = {};
  if (typeof report.url === "string" && report.url) {
    urls.report = absoluteUrl(baseUrl, report.url);
  }
  if (typeof report.summary_url === "string" && report.summary_url) {
    urls.summary = absoluteUrl(baseUrl, report.summary_url);
  }
  return urls;
}

function selectReportFile(taskId: string, report: JsonObject, type: string, file?: string): { fileName: string; url: string } {
  const selectedFile = file || String(type === "json" ? report.latest_json || "" : report.latest_html || "");
  if (!selectedFile) {
    throw new CliUsageError(`no archived ${type} report found for task ${taskId}`);
  }
  const fileName = basename(selectedFile);
  const expectedSuffix = type === "json" ? ".json" : ".html";
  if (!fileName.endsWith(expectedSuffix)) {
    throw new CliUsageError(`--type ${type} requires a ${expectedSuffix} report file`);
  }
  return {
    fileName,
    url: `/tasks/${encodeURIComponent(taskId)}/report/${encodeURIComponent(fileName)}`,
  };
}

function absoluteUrl(baseUrl: string, url: string): string {
  if (/^https?:\/\//i.test(url)) {
    return url;
  }
  return `${baseUrl}/${url.replace(/^\/+/, "")}`;
}

async function cmdResultsExport(globals: CliGlobals, args: string[]): Promise<CliResult> {
  const taskId = requireArg(args, 0, "task-id");
  const reader = new OptionReader(args.slice(1));
  const format = reader.takeString("format", "json");
  const scope = reader.takeString("scope", "all");
  const outputArg = reader.takeOptionalString("output");
  const timeout = reader.takeNumber("timeout", 60) ?? 60;
  const interval = reader.takeFloat("interval", 1) ?? 1;
  reader.requireNoUnknown();
  if (!["json", "csv", "zip"].includes(format)) {
    throw new CliUsageError("--format must be json, csv, or zip");
  }
  const client = await buildClient(globals);
  try {
    const start = await client.request<JsonObject>("POST", `/tasks/${encodeURIComponent(taskId)}/api/export`, { format, scope });
    const pollUrl = typeof start.poll_url === "string" ? start.poll_url : "";
    if (!pollUrl) {
      const item = issue(
        "EXPORT_POLL_URL_MISSING",
        "error",
        "服务端导出响应缺少 poll_url",
        { response: start },
        "CLI 无法确认导出任务何时完成。",
        "检查服务端导出接口返回值。",
        redactedArgv(globals.rawArgv),
      );
      return { payload: { ok: false, message: "导出任务未返回 poll_url", issues: [item] }, exitCode: 1 };
    }

    const deadline = Date.now() + timeout * 1000;
    let status: JsonObject = {};
    while (Date.now() < deadline) {
      status = await client.request<JsonObject>("GET", pollUrl);
      if (status.status === "done") break;
      if (status.status === "error") {
        const item = issue(
          "EXPORT_JOB_FAILED",
          "error",
          "服务端导出任务失败",
          { status },
          "导出后台任务执行出错。",
          "根据 error 修复后重新导出。",
          redactedArgv(globals.rawArgv),
        );
        return { payload: { ok: false, message: item.problem, issues: [item] }, exitCode: 1 };
      }
      await delay(interval * 1000);
    }
    if (status.status !== "done") {
      const item = issue(
        "EXPORT_TIMEOUT",
        "error",
        "等待导出完成超时",
        { timeout_seconds: timeout, last_status: status },
        "导出任务可能仍在后台运行，也可能卡住。",
        "稍后重试，或在网页任务管理页查看导出状态。",
        redactedArgv(globals.rawArgv),
      );
      return { payload: { ok: false, message: item.problem, issues: [item] }, exitCode: 1 };
    }
    if (typeof status.download_url !== "string") {
      throw new CliUsageError("export status missing download_url");
    }
    const downloaded = await client.request("GET", status.download_url, undefined, { expectBytes: true });
    const fileName = typeof status.file_name === "string" ? status.file_name : `export.${format}`;
    let output = outputArg ? resolve(expandHome(outputArg)) : resolve(globals.cwd, fileName);
    if (existsSync(output) && statSync(output).isDirectory()) {
      output = resolve(output, fileName);
    }
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, downloaded.bytes);
    return {
      payload: {
        ok: true,
        message: "评估结论已导出",
        output_path: output,
        file_name: fileName,
        bytes: downloaded.bytes.length,
      },
      exitCode: 0,
    };
  } catch (error) {
    if (error instanceof ApiError) return apiFailurePayload(error, "导出评估结论", globals);
    throw error;
  }
}

async function uploadOneDataset(client: ApiClient, info: DatasetInfo, name?: string): Promise<JsonObject> {
  return client.request<JsonObject>("POST", "/api/datasets/upload", {
    folder_name: name || basename(info.path),
    files: validFileMap(info),
  });
}

async function resolveDatasetRef(client: ApiClient, ref: string): Promise<JsonObject & { path: string }> {
  const localPath = datasetPath(ref);
  if (existsSync(localPath)) {
    if (!isLocalBaseUrl(client.baseUrl)) {
      throw new DatasetRefError({
        code: "DATASET_REF_LOCAL_PATH_FOR_REMOTE",
        ref,
        base_url: client.baseUrl,
        local_path: localPath,
        required_flow: "远端平台不能读取你本机的文件路径；先运行 dataset upload，再用返回的 dataset id 绑定。",
      });
    }
    return { kind: "path", path: localPath, name: basename(localPath) };
  }

  const grouped = await client.request<JsonObject>("GET", "/api/datasets");
  const my = Array.isArray(grouped.my) ? grouped.my : [];
  const others = Array.isArray(grouped.others) ? grouped.others : [];
  const allItems = [...my, ...others].filter((item): item is JsonObject => typeof item === "object" && item !== null);
  const exact = allItems.filter((item) => item.id === ref || item.name === ref || item.path === ref);
  if (exact.length === 1) {
    return { kind: "dataset", ...exact[0], path: String(exact[0].path || "") };
  }
  if (exact.length > 1) {
    throw new DatasetRefError({
      code: "DATASET_REF_AMBIGUOUS",
      ref,
      matches: exact.map((item) => ({ id: item.id, name: item.name, path: item.path })),
    });
  }
  throw new DatasetRefError({
    code: "DATASET_REF_NOT_FOUND",
    ref,
    known_samples: allItems.slice(0, 8).map((item) => ({ id: item.id, name: item.name })),
  });
}

class DatasetRefError extends Error {
  readonly evidence: JsonObject;

  constructor(evidence: JsonObject) {
    super(String(evidence.code || "DATASET_REF_ERROR"));
    this.evidence = evidence;
  }
}

async function buildClient(globals: CliGlobals, options: { autoLogin?: boolean } = {}): Promise<ApiClient> {
  const saved = loadSessions(sessionPath(globals.env))[globals.profile] || {};
  const baseUrl = resolveBaseUrl(globals, saved);
  const client = new ApiClient({
    baseUrl,
    sessionToken: globals.env.GSB_SESSION_TOKEN || saved.session_token || "",
  });
  const username = globals.username || globals.env.GSB_USERNAME;
  const password = globals.password || globals.env.GSB_PASSWORD;
  if (options.autoLogin !== false && username && password) {
    const data = await client.login(username, password);
    saveSession(sessionPath(globals.env), globals.profile, {
      base_url: client.baseUrl,
      username: String(data.username || username),
      role: String(data.role || ""),
      session_token: client.sessionToken,
    });
  }
  return client;
}

function resolveBaseUrl(globals: CliGlobals, saved: SessionData = {}): string {
  return (globals.baseUrl || saved.base_url || globals.env.GSB_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function apiFailurePayload(error: ApiError, action: string, globals: CliGlobals, continueCommand = ""): CliResult {
  const detail = error.data && typeof error.data === "object" ? error.data as JsonObject : { raw: error.data };
  const item = issue(
    error.status === 0 ? "API_UNREACHABLE" : "API_REQUEST_FAILED",
    "error",
    `${action}失败`,
    { status: error.status, url: error.url, server_error: serverError(error.data) },
    "CLI 调用的是服务器端平台真实 API；该错误表示服务端拒绝了当前操作或服务不可达。",
    "先根据 server_error 修正认证、权限、任务状态或输入数据；如果是 401，请重新登录。",
    continueCommand || redactedArgv(globals.rawArgv),
  );
  const payload: JsonObject = { ok: false, message: item.problem, issues: [item] };
  if (detail.preflight && typeof detail.preflight === "object") {
    payload.preflight = detail.preflight;
    const failures = (detail.preflight as JsonObject).failures;
    if (Array.isArray(failures)) {
      payload.issues = [item, ...failures];
    }
  }
  return { payload, exitCode: 1 };
}

function isLocalBaseUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    return ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}
