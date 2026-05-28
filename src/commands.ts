import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { ApiClient, ApiError, serverError } from "./api.js";
import { CliUsageError, OptionReader, parseArgs, requireArg } from "./args.js";
import { datasetCheckPayload, datasetPath, FORMAT_GUIDANCE, inspectDatasetDir, validFileMap } from "./dataset.js";
import { HELP_TEXT } from "./help.js";
import { hasErrors, issue, redactedArgv } from "./issues.js";
import { clearSession, expandHome, loadSessions, saveSession, sessionPath } from "./session.js";
import { installSkill, skillInfo, skillTargets, uninstallSkill, type SkillInstallMode, type SkillTarget } from "./skill.js";
import type { CliGlobals, CliResult, DatasetInfo, JsonObject, SessionData } from "./types.js";
import { checkForUpdate, CLI_VERSION, DEFAULT_BASE_URL } from "./version.js";

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
  if (command === "version") {
    return cmdVersion(globals, rest.length ? rest : args.slice(1));
  }
  if (command === "skill") {
    if (subcommand === "install") return cmdSkillInstall(globals, rest);
    if (subcommand === "status") return cmdSkillStatus(globals, rest);
    if (subcommand === "uninstall") return cmdSkillUninstall(globals, rest);
  }
  if (command === "auth") {
    if (subcommand === "login") return cmdAuthLogin(globals);
    if (subcommand === "register") return cmdAuthRegister(globals);
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
    if (subcommand === "create-gsb") return cmdTaskCreateGsb(globals, rest);
    if (subcommand === "bind") return cmdTaskBind(globals, rest);
    if (subcommand === "setup") return cmdTaskSetup(globals, rest);
    if (subcommand === "configure") return cmdTaskConfigure(globals, rest);
    if (subcommand === "config") return cmdTaskConfig(globals, rest);
    if (subcommand === "preflight") return cmdTaskPreflight(globals, rest);
    if (subcommand === "publish") return cmdTaskPublish(globals, rest);
    if (subcommand === "archive") return cmdTaskArchive(globals, rest);
    if (subcommand === "renderer") return cmdTaskRenderer(globals, args.slice(2));
  }
  if (command === "report") {
    if (subcommand === "status") return cmdReportStatus(globals, rest);
    if (subcommand === "url") return cmdReportStatus(globals, rest);
    if (subcommand === "upload") return cmdReportUpload(globals, rest);
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

async function cmdVersion(globals: CliGlobals, args: string[]): Promise<CliResult> {
  const reader = new OptionReader(args);
  const force = reader.takeFlag("check");
  reader.requireNoUnknown();
  const notice = await checkForUpdate(globals.env, force);
  return {
    payload: {
      ok: true,
      message: "版本信息",
      cli_version: CLI_VERSION,
      update: notice || {
        current: CLI_VERSION,
        latest: "",
        source: "",
        available: false,
        update_command: "",
      },
    },
    exitCode: 0,
  };
}

function cmdSkillStatus(globals: CliGlobals, args: string[]): CliResult {
  const reader = new OptionReader(args);
  const target = readSkillTarget(reader.takeString("target", "all"));
  reader.requireNoUnknown();
  return {
    payload: {
      ok: true,
      message: "skill 安装状态",
      skill: {
        name: "gsb-eval",
        targets: skillTargets(target, globals.env).map((item) => skillInfo(item.target, globals.env)),
      },
    },
    exitCode: 0,
  };
}

function cmdSkillInstall(globals: CliGlobals, args: string[]): CliResult {
  const reader = new OptionReader(args);
  const target = readSkillTarget(reader.takeString("target", "all"));
  const mode = readSkillMode(reader.takeString("mode", "copy"));
  const force = reader.takeFlag("force");
  reader.requireNoUnknown();
  try {
    const skill = installSkill(target, mode, force, globals.env);
    return {
      payload: {
        ok: true,
        message: "skill 安装完成",
        skill,
        update_note: mode === "symlink"
          ? "symlink 模式：git pull 后 CLI 和 skill 会一起更新。"
          : "copy 模式：更新 CLI 包后会在 npm postinstall 阶段自动刷新 skill；手动更新可重新运行 skill install --mode copy --force。",
        restart_note: "安装或更新后，请重启 Codex/Cursor，或重新打开一个 Agent 对话。",
      },
      exitCode: 0,
    };
  } catch (error) {
    const item = issue(
      "SKILL_INSTALL_FAILED",
      "error",
      error instanceof Error ? error.message : String(error),
      { target, mode },
      "skill 安装需要写入本机 Agent skills 目录。",
      "确认目标目录可写；如果需要覆盖已有 skill，请加 --force。",
      redactedArgv(globals.rawArgv),
    );
    return { payload: { ok: false, message: item.problem, issues: [item] }, exitCode: 1 };
  }
}

function cmdSkillUninstall(globals: CliGlobals, args: string[]): CliResult {
  const reader = new OptionReader(args);
  const target = readSkillTarget(reader.takeString("target", "all"));
  reader.requireNoUnknown();
  return {
    payload: {
      ok: true,
      message: "skill 已卸载",
      skill: uninstallSkill(target, globals.env),
    },
    exitCode: 0,
  };
}

function readSkillTarget(value: string): SkillTarget {
  if (["codex", "cursor", "all"].includes(value)) {
    return value as SkillTarget;
  }
  throw new CliUsageError("--target must be codex, cursor, or all");
}

function readSkillMode(value: string): SkillInstallMode {
  if (["copy", "symlink"].includes(value)) {
    return value as SkillInstallMode;
  }
  throw new CliUsageError("--mode must be copy or symlink");
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
        "gsb-cli task create --name <task-name> --purpose <task-purpose>",
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
          "确认用户名和密码是否正确；如账号被重置或密码过期，请先处理账号状态后重新登录。如确认还没有账号，可先运行 gsb-cli auth register --username <user> --password <pass> --json。",
          redactedArgv(globals.rawArgv),
        );
        return { payload: { ok: false, message: item.problem, issues: [item] }, exitCode: 1 };
      }
      return apiFailurePayload(error, "登录", globals);
    }
    throw error;
  }
}

async function cmdAuthRegister(globals: CliGlobals): Promise<CliResult> {
  const username = globals.username;
  const password = globals.password || globals.env.GSB_PASSWORD;
  if (!username || !password) {
    const item = issue(
      "AUTH_REGISTER_CREDENTIALS_REQUIRED",
      "error",
      "注册凭据缺失",
      { has_username: Boolean(username), has_password: Boolean(password) },
      "注册 API 需要 username 和 password。CLI 不会自动生成账号，避免误注册。",
      "先向用户确认要注册的账号和密码；密码至少 6 位，建议通过 GSB_PASSWORD 注入。",
      "gsb-cli auth register --username <user>",
    );
    return { payload: { ok: false, message: item.problem, issues: [item] }, exitCode: 1 };
  }

  const baseUrl = resolveBaseUrl(globals);
  const client = new ApiClient({ baseUrl });
  try {
    const data = await client.register(username, password);
    saveSession(sessionPath(globals.env), globals.profile, {
      base_url: client.baseUrl,
      username: String(data.username || username),
      role: String(data.role || ""),
      session_token: client.sessionToken,
    });
    return {
      payload: {
        ok: true,
        message: "注册成功，session 已保存",
        profile: globals.profile,
        base_url: client.baseUrl,
        username: data.username || username,
        role: data.role || "evaluator",
        next_commands: [
          "gsb-cli auth whoami --json",
          "gsb-cli dataset check --a <baseline-dir> --b <candidate-dir> --json",
          "gsb-cli dataset upload --a <baseline-dir> --b <candidate-dir> --json",
        ],
      },
      exitCode: 0,
    };
  } catch (error) {
    if (error instanceof ApiError) {
      const server = serverError(error.data);
      if (error.status === 400) {
        const item = issue(
          "AUTH_REGISTER_FAILED",
          "error",
          "注册失败",
          { status: error.status, server_error: server, has_username: Boolean(username), has_password: Boolean(password) },
          "平台注册接口拒绝了该账号信息，常见原因是用户名已存在、用户名格式不合法或密码少于 6 位。",
          "按 server_error 修正账号信息；如果已有账号，改用 gsb-cli auth login。",
          redactedArgv(globals.rawArgv),
        );
        return { payload: { ok: false, message: item.problem, issues: [item] }, exitCode: 1 };
      }
      return apiFailurePayload(error, "注册账号", globals);
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
  const verbose = reader.takeFlag("verbose");
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
  const payload = datasetCheckPayload(pathA, pathB, redactedArgv(globals.rawArgv), { verbose });
  return { payload, exitCode: payload.ok ? 0 : 1 };
}

async function cmdDatasetUpload(globals: CliGlobals, args: string[]): Promise<CliResult> {
  const reader = new OptionReader(args);
  const a = reader.takeOptionalString("a");
  const b = reader.takeOptionalString("b");
  const name = reader.takeOptionalString("name");
  const nameA = reader.takeOptionalString("name-a");
  const nameB = reader.takeOptionalString("name-b");
  const reuse = reader.takeFlag("reuse");
  const replace = reader.takeFlag("replace");
  const forceNew = reader.takeFlag("force-new");
  const newName = reader.takeOptionalString("new-name");
  reader.requireNoUnknown();
  const rest = reader.rest();
  const strategyFlags = [reuse ? "reuse" : "", replace ? "replace" : "", forceNew ? "force_new" : ""].filter(Boolean);
  if (strategyFlags.length > 1) {
    throw new CliUsageError("choose only one of --reuse, --replace, --force-new");
  }
  if (newName && (a || b)) {
    throw new CliUsageError("--new-name is only supported for single dataset upload; use --name-a/--name-b for paired upload");
  }
  const duplicateStrategy = strategyFlags[0] as "reuse" | "replace" | "force_new" | undefined;
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
    targets = [
      { label: "a", info: inspectDatasetDir(a), name: nameA },
      { label: "b", info: inspectDatasetDir(b), name: nameB },
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
    targets = [{ label: "dataset", info: inspectDatasetDir(dir), name: newName || name }];
  }

  const uploaded: JsonObject[] = [];
  try {
    for (const target of targets) {
      const res = await uploadOneDataset(client, target.info, target.name, duplicateStrategy);
      uploaded.push(publicDatasetPayload(target.label, res));
    }
  } catch (error) {
    if (error instanceof ApiError) {
      const duplicate = datasetUploadFailurePayload(error, globals);
      return duplicate ?? apiFailurePayload(error, "上传数据集", globals);
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
        "gsb-cli task create --name <task-name> --purpose <task-purpose>",
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
  const purpose = reader.takeString("purpose", "");
  const mode = reader.takeString("mode", "gsb");
  const taskId = reader.takeString("task-id", "");
  reader.requireNoUnknown();
  if (!name.trim()) {
    throw new CliUsageError("task create requires --name");
  }
  if (!["gsb", "preview"].includes(mode)) {
    throw new CliUsageError("--mode must be gsb or preview");
  }
  const client = await buildClient(globals);
  try {
    const data = await client.request<JsonObject>("POST", "/api/tasks", { name, purpose, mode, task_id: taskId });
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
    const data = await fetchTaskStatus(client, taskId);
    return { payload: withTaskUrls(data, client, taskId), exitCode: 0 };
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
        resolved_refs: refs.map(publicDatasetRef),
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

async function cmdTaskCreateGsb(globals: CliGlobals, args: string[]): Promise<CliResult> {
  const reader = new OptionReader(args);
  const name = reader.takeString("name", "");
  const purpose = reader.takeString("purpose", "");
  const taskId = reader.takeString("task-id", "");
  const a = reader.takeOptionalString("a");
  const b = reader.takeOptionalString("b");
  const descriptionFile = reader.takeOptionalString("description-file");
  const description = descriptionFile ? readFileSync(expandHome(descriptionFile), "utf8") : reader.takeString("description", "");
  const minPerPersonRaw = parseOptionalNumberOrAuto("min-per-person", reader.takeOptionalString("min-per-person"));
  const anchorCountRaw = parseOptionalNumberOrAuto("anchor-count", reader.takeOptionalString("anchor-count"));
  const transparentMode = reader.takeString("transparent-mode", "admin_only");
  const stats = reader.takeString("stats", "admin_only");
  const showTrace = reader.takeBoolean("show-trace") ?? false;
  const requireComments = reader.takeBoolean("require-comments") ?? false;
  const publish = reader.takeFlag("publish");
  reader.requireNoUnknown();
  if (!name.trim()) {
    throw new CliUsageError("task create-gsb requires --name");
  }
  if (!a || !b) {
    throw new CliUsageError("task create-gsb requires --a and --b");
  }
  const client = await buildClient(globals);
  try {
    const createData = await client.request<JsonObject>("POST", "/api/tasks", { name, purpose, mode: "gsb", task_id: taskId });
    const task = isJsonObject(createData.task) ? createData.task : {};
    const createdTaskId = String(task.id || taskId || "");
    const refs = [await resolveDatasetRef(client, a), await resolveDatasetRef(client, b)];
    const bindData = await client.request<JsonObject>("POST", `/tasks/${encodeURIComponent(createdTaskId)}/api/select-dirs`, {
      dirs: refs.map((ref) => ref.path),
    });
    const commonCount = Number(bindData.common_count || 0);
    const minPerPerson = resolveMinPerPerson(minPerPersonRaw, commonCount);
    const anchorCount = resolveAnchorCount(anchorCountRaw, commonCount, minPerPerson);
    const setupData = await client.request<JsonObject>("POST", `/tasks/${encodeURIComponent(createdTaskId)}/api/setup`, {
      task_name: name,
      task_description: description,
      min_per_person: minPerPerson,
      anchor_count: anchorCount,
    });
    const configData = await client.request<JsonObject>("POST", `/tasks/${encodeURIComponent(createdTaskId)}/api/admin-config`, {
      visibility: {
        transparent_mode: transparentMode,
        stats,
        show_trace: showTrace,
        require_comments: requireComments,
      },
    });
    const preflight = await client.request<JsonObject>("GET", `/api/tasks/${encodeURIComponent(createdTaskId)}/preflight`);
    let publishData: JsonObject | undefined;
    if (publish) {
      if (!preflight.ok) {
        return {
          payload: {
            ok: false,
            message: "任务已创建并配置，但 preflight 未通过，未发布",
            task: publicTaskFromStatus(await fetchTaskStatus(client, createdTaskId)),
            preflight,
            issues: preflight.failures ?? [],
            next_commands: preflight.next_command ? [preflight.next_command] : [`gsb-cli task configure ${createdTaskId} --json`],
          },
          exitCode: 1,
        };
      }
      publishData = await client.request<JsonObject>("POST", `/api/tasks/${encodeURIComponent(createdTaskId)}/publish`, {});
    }
    const status = await fetchTaskStatus(client, createdTaskId);
    const payload = withTaskUrls(status, client, createdTaskId);
    payload.message = publish ? "GSB 任务已创建、配置并发布" : "GSB 任务已创建并配置";
    payload.steps = [
      { name: "create", ok: true, task_id: createdTaskId },
      { name: "bind", ok: true, common_count: commonCount, resolved_refs: refs.map(publicDatasetRef) },
      { name: "setup", ok: true, min_per_person: minPerPerson, anchor_count: anchorCount, setup_effects: summarizeSetupEffects(setupData) },
      { name: "config", ok: true, visibility: configData.visibility ?? {} },
      { name: "preflight", ok: Boolean(preflight.ok), failures: preflight.failures ?? [], warnings: preflight.warnings ?? [] },
      ...(publish ? [{ name: "publish", ok: Boolean(publishData?.ok), status: publishData?.status ?? "" }] : []),
    ];
    payload.next_commands = publish
      ? [`gsb-cli task get ${createdTaskId} --json`, `gsb-cli results summary ${createdTaskId} --all --json`]
      : [preflight.next_command || `gsb-cli task publish ${createdTaskId} --json`];
    return { payload, exitCode: preflight.ok ? 0 : 1 };
  } catch (error) {
    if (error instanceof DatasetRefError) {
      const item = issue(
        String(error.evidence.code || "DATASET_REF_ERROR"),
        "error",
        "数据集引用无法解析",
        error.evidence,
        "create-gsb 需要绑定平台可访问的数据集。远端平台推荐先 dataset upload，再使用返回的 dataset id。",
        "先运行 dataset upload 或 dataset list，使用明确的 dataset id。",
        redactedArgv(globals.rawArgv),
      );
      return { payload: { ok: false, message: item.problem, issues: [item] }, exitCode: 1 };
    }
    if (error instanceof ApiError) return apiFailurePayload(error, "创建 GSB 任务", globals);
    throw error;
  }
}

async function cmdTaskConfigure(globals: CliGlobals, args: string[]): Promise<CliResult> {
  const taskId = requireArg(args, 0, "task-id");
  const reader = new OptionReader(args.slice(1));
  const name = reader.takeString("name", "");
  const descriptionFile = reader.takeOptionalString("description-file");
  const descriptionRaw = descriptionFile ? readFileSync(expandHome(descriptionFile), "utf8") : reader.takeOptionalString("description");
  const minPerPersonRaw = parseOptionalNumberOrAuto("min-per-person", reader.takeOptionalString("min-per-person"));
  const anchorCountRaw = parseOptionalNumberOrAuto("anchor-count", reader.takeOptionalString("anchor-count"));
  const transparentMode = reader.takeOptionalString("transparent-mode");
  const stats = reader.takeOptionalString("stats");
  const showTrace = reader.takeBoolean("show-trace");
  const requireComments = reader.takeBoolean("require-comments");
  const publish = reader.takeFlag("publish");
  reader.requireNoUnknown();

  const setupRequested = Boolean(name || descriptionRaw !== undefined || minPerPersonRaw !== undefined || anchorCountRaw !== undefined);
  const visibility: JsonObject = {};
  if (transparentMode !== undefined) visibility.transparent_mode = transparentMode;
  if (stats !== undefined) visibility.stats = stats;
  if (showTrace !== undefined) visibility.show_trace = showTrace;
  if (requireComments !== undefined) visibility.require_comments = requireComments;
  const configRequested = Object.keys(visibility).length > 0;
  if (!setupRequested && !configRequested && !publish) {
    const item = issue(
      "NO_CONFIGURE_FIELDS",
      "error",
      "task configure 命令缺少要更新的字段",
      {},
      "空配置不会改变任务行为。",
      "传入题量、说明、锚点、评论必填、透明模式、统计权限或 trace 展示等配置。",
      redactedArgv(globals.rawArgv),
    );
    return { payload: { ok: false, message: "没有提供任何配置", issues: [item] }, exitCode: 1 };
  }

  const client = await buildClient(globals);
  try {
    const before = await fetchTaskStatus(client, taskId);
    const counts = isJsonObject(before.datasets) && isJsonObject(before.datasets.counts) ? before.datasets.counts : {};
    const commonCount = Number(counts.common || 0);
    const currentSetup = isJsonObject(before.setup) ? before.setup : {};
    const steps: JsonObject[] = [];
    if (setupRequested) {
      const minPerPerson = minPerPersonRaw === undefined
        ? Number(currentSetup.min_per_person || resolveMinPerPerson("auto", commonCount))
        : resolveMinPerPerson(minPerPersonRaw, commonCount);
      const anchorCount = anchorCountRaw === undefined
        ? Number(currentSetup.anchor_count || resolveAnchorCount("auto", commonCount, minPerPerson))
        : resolveAnchorCount(anchorCountRaw, commonCount, minPerPerson);
      const setupData = await client.request<JsonObject>("POST", `/tasks/${encodeURIComponent(taskId)}/api/setup`, {
        task_name: name || String((before.task as JsonObject | undefined)?.name || ""),
        task_description: descriptionRaw ?? String(currentSetup.task_description || ""),
        min_per_person: minPerPerson,
        anchor_count: anchorCount,
      });
      steps.push({ name: "setup", ok: true, min_per_person: minPerPerson, anchor_count: anchorCount, setup_effects: summarizeSetupEffects(setupData) });
    }
    if (configRequested) {
      const configData = await client.request<JsonObject>("POST", `/tasks/${encodeURIComponent(taskId)}/api/admin-config`, { visibility });
      steps.push({ name: "config", ok: true, visibility: configData.visibility ?? visibility });
    }
    const preflight = await client.request<JsonObject>("GET", `/api/tasks/${encodeURIComponent(taskId)}/preflight`);
    steps.push({ name: "preflight", ok: Boolean(preflight.ok), failures: preflight.failures ?? [], warnings: preflight.warnings ?? [] });
    let publishData: JsonObject | undefined;
    if (publish) {
      if (!preflight.ok) {
        return {
          payload: {
            ok: false,
            message: "配置已保存，但 preflight 未通过，未发布",
            preflight,
            issues: preflight.failures ?? [],
            next_commands: preflight.next_command ? [preflight.next_command] : [`gsb-cli task configure ${taskId} --json`],
          },
          exitCode: 1,
        };
      }
      publishData = await client.request<JsonObject>("POST", `/api/tasks/${encodeURIComponent(taskId)}/publish`, {});
      steps.push({ name: "publish", ok: Boolean(publishData.ok), status: publishData.status ?? "" });
    }
    const status = await fetchTaskStatus(client, taskId);
    const payload = withTaskUrls(status, client, taskId);
    payload.message = publish ? "任务配置已保存并发布" : "任务配置已保存";
    payload.steps = steps;
    payload.next_commands = publish
      ? [`gsb-cli task get ${taskId} --json`, `gsb-cli results summary ${taskId} --all --json`]
      : [preflight.next_command || `gsb-cli task publish ${taskId} --json`];
    return { payload, exitCode: 0 };
  } catch (error) {
    if (error instanceof ApiError) return apiFailurePayload(error, "配置任务", globals);
    throw error;
  }
}

async function cmdTaskSetup(globals: CliGlobals, args: string[]): Promise<CliResult> {
  const taskId = requireArg(args, 0, "task-id");
  const reader = new OptionReader(args.slice(1));
  const name = reader.takeString("name", "");
  const descriptionFile = reader.takeOptionalString("description-file");
  const description = descriptionFile ? readFileSync(expandHome(descriptionFile), "utf8") : reader.takeString("description", "");
  const minPerPerson = parseOptionalNumberOrAuto("min-per-person", reader.takeOptionalString("min-per-person"));
  const anchorCount = parseOptionalNumberOrAuto("anchor-count", reader.takeOptionalString("anchor-count"));
  reader.requireNoUnknown();
  const payload: JsonObject = {
    task_name: name,
    task_description: description,
  };
  if (minPerPerson !== undefined && minPerPerson !== "auto") {
    payload.min_per_person = minPerPerson;
  }
  if (anchorCount !== undefined) {
    if (anchorCount !== "auto") payload.anchor_count = anchorCount;
  }
  const client = await buildClient(globals);
  try {
    const data = await client.request<JsonObject>("POST", `/tasks/${encodeURIComponent(taskId)}/api/setup`, payload);
    const config = isJsonObject(data.config) ? data.config : {};
    const anchorItems = Array.isArray(config.anchor_items) ? config.anchor_items : [];
    const evalDimensions = Array.isArray(config.eval_dimensions) ? config.eval_dimensions : [];
    const evaluatorOrder = Array.isArray(config.evaluator_order) ? config.evaluator_order : [];
    const setupEffects: JsonObject = {
      total_items: config.total_items ?? null,
      min_per_person: config.min_per_person ?? (minPerPerson === "auto" ? null : minPerPerson) ?? null,
      anchor_items_count: anchorItems.length,
      anchor_items_preview: anchorItems.slice(0, 10),
      eval_dimensions: evalDimensions,
      evaluator_order_count: evaluatorOrder.length,
    };
    const warnings: JsonObject[] = [
      issue(
        "SETUP_ASSIGNMENT_GENERATED",
        "warning",
        "task setup 已生成并保存分配策略",
        {
          total_items: setupEffects.total_items,
          min_per_person: setupEffects.min_per_person,
          anchor_items_count: setupEffects.anchor_items_count,
          anchor_count_source: anchorCount === undefined || anchorCount === "auto" ? "platform_default" : "cli --anchor-count",
        },
        "平台会在 setup 时生成 anchor_items；未传 --anchor-count 时，平台按固定规则从共同题中抽样。evaluator_order 会随评估者首次进入继续更新。",
        "如需控制锚点数量，重新运行 task setup 并传入 --anchor-count；如当前策略符合预期，继续 task config。",
      ),
      issue(
        "TASK_VISIBILITY_CONFIG_SEPARATE",
        "warning",
        "可见性和评论必填配置需要单独运行 task config",
        { fields: ["transparent_mode", "stats", "show_trace", "require_comments"] },
        "task setup 只保存任务说明和分配策略；require_comments、transparent_mode、stats、show_trace 属于权限/展示配置。",
        `按任务要求运行 gsb-cli task config ${taskId} --transparent-mode admin_only --stats admin_only --show-trace false --require-comments false --json，然后再 preflight。`,
        `gsb-cli task config ${taskId} --transparent-mode admin_only --stats admin_only --show-trace false --require-comments false --json`,
      ),
    ];
    if (evalDimensions.length) {
      warnings.push(issue(
        "SETUP_EVAL_DIMENSIONS_PRESENT",
        "warning",
        "平台返回了额外评估维度",
        { eval_dimensions: evalDimensions },
        "平台可能根据数据内容或版本名推断 product_presentation、shopping_guidance_quality 等任务维度；这会影响评估页展示和结果解释。",
        "确认这些维度符合本次任务；如果不符合，需要在平台侧调整任务配置或重新 setup。",
      ));
    }
    return {
      payload: {
        ok: true,
        message: "任务分配策略已保存",
        config,
        setup_effects: setupEffects,
        warnings,
        next_commands: [
          `gsb-cli task config ${taskId} --transparent-mode admin_only --stats admin_only --show-trace false --require-comments false --json`,
          `gsb-cli task preflight ${taskId} --json`,
          `gsb-cli task publish ${taskId} --json`,
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
    if (data.next_command && !data.next_commands) {
      data.next_commands = [data.next_command];
    }
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

async function cmdReportUpload(globals: CliGlobals, args: string[]): Promise<CliResult> {
  const taskId = requireArg(args, 0, "task-id");
  const reader = new OptionReader(args.slice(1));
  reader.requireNoUnknown();
  const files = reader.rest();
  if (files.length === 0) {
    throw new CliUsageError("report upload requires at least one .html or .json file");
  }

  const fileMap: Record<string, string> = {};
  for (const file of files) {
    const path = resolve(expandHome(file));
    if (!existsSync(path) || !statSync(path).isFile()) {
      throw new CliUsageError(`report file not found: ${file}`);
    }
    const fileName = basename(path);
    const lowerName = fileName.toLowerCase();
    const acceptedSuffix = lowerName.endsWith(".html") || lowerName.endsWith(".json");
    if (!acceptedSuffix) {
      throw new CliUsageError(`report upload only accepts .html and .json files: ${file}`);
    }
    if (fileName in fileMap) {
      throw new CliUsageError(`duplicate report file name: ${fileName}`);
    }
    fileMap[fileName] = readFileSync(path, "utf8");
  }

  const client = await buildClient(globals);
  try {
    const data = await client.request<JsonObject>("POST", `/tasks/${encodeURIComponent(taskId)}/api/reports`, { files: fileMap });
    const report = data.report && typeof data.report === "object" ? data.report as JsonObject : {};
    return {
      payload: {
        ok: true,
        message: "归档分析报告已上传",
        task_id: taskId,
        saved: data.saved || [],
        skipped: data.skipped || [],
        report,
        urls: buildReportUrls(client.baseUrl, report),
      },
      exitCode: 0,
    };
  } catch (error) {
    if (error instanceof ApiError) return apiFailurePayload(error, "上传归档分析报告", globals);
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

async function uploadOneDataset(
  client: ApiClient,
  info: DatasetInfo,
  name?: string,
  onDuplicate?: "reuse" | "replace" | "force_new",
): Promise<JsonObject> {
  const payload: JsonObject = {
    folder_name: name || basename(info.path),
    files: validFileMap(info),
  };
  if (onDuplicate) payload.on_duplicate = onDuplicate;
  return client.request<JsonObject>("POST", "/api/datasets/upload", payload);
}

function publicDatasetPayload(label: string, data: JsonObject): JsonObject {
  const payload = publicDatasetRef(data);
  payload.label = label;
  payload.ok = data.ok;
  return payload;
}

function publicDatasetRef(data: JsonObject): JsonObject {
  const out: JsonObject = {};
  for (const key of ["kind", "id", "name", "username", "json_count", "uploaded_at", "reused", "replaced", "storage_name", "duplicate"]) {
    if (data[key] !== undefined) {
      out[key] = data[key];
    }
  }
  return out;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function datasetUploadFailurePayload(error: ApiError, globals: CliGlobals): CliResult | null {
  const detail = error.data && typeof error.data === "object" ? error.data as JsonObject : {};
  const code = String(detail.code || "");
  if (!code.startsWith("DATASET_")) {
    return null;
  }
  const item = issue(
    code,
    "error",
    String(detail.message || detail.error || "数据集上传冲突"),
    detail,
    "平台会阻止同名但内容不同的数据集被静默覆盖，避免后续任务绑定到错误数据。",
    String(detail.next_step || "确认本次上传目的后，使用 --reuse、--replace、--new-name 或 --force-new 重新上传。"),
    redactedArgv(globals.rawArgv),
  );
  return { payload: { ok: false, message: item.problem, issues: [item], duplicate: detail }, exitCode: 1 };
}

function parseOptionalNumberOrAuto(name: string, raw: string | undefined): number | "auto" | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (raw.trim().toLowerCase() === "auto") {
    return "auto";
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) {
    throw new CliUsageError(`--${name} expects an integer or auto, got ${raw}`);
  }
  return value;
}

function defaultMinPerPerson(totalItems: number): number {
  if (totalItems <= 0) return 0;
  return Math.min(totalItems, Math.max(10, Math.ceil(totalItems * 0.15)));
}

function defaultAnchorCount(totalItems: number, minPerPerson: number): number {
  if (totalItems <= 0 || minPerPerson <= 0) return 0;
  return Math.min(totalItems, minPerPerson, Math.max(3, Math.ceil(minPerPerson * 0.10)));
}

function resolveMinPerPerson(value: number | "auto" | undefined, totalItems: number): number {
  if (value === undefined || value === "auto") {
    return defaultMinPerPerson(totalItems);
  }
  if (value <= 0) {
    return totalItems;
  }
  return totalItems > 0 ? Math.min(value, totalItems) : value;
}

function resolveAnchorCount(value: number | "auto" | undefined, totalItems: number, minPerPerson: number): number {
  if (value === undefined || value === "auto") {
    return defaultAnchorCount(totalItems, minPerPerson);
  }
  if (value <= 0) {
    return 0;
  }
  return Math.min(value, totalItems, minPerPerson);
}

async function fetchTaskStatus(client: ApiClient, taskId: string): Promise<JsonObject> {
  try {
    return await client.request<JsonObject>("GET", `/api/tasks/${encodeURIComponent(taskId)}/status`);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) {
      throw error;
    }
    const task = await client.request<JsonObject>("GET", `/api/tasks/${encodeURIComponent(taskId)}`);
    let preflight: JsonObject = {};
    try {
      preflight = await client.request<JsonObject>("GET", `/api/tasks/${encodeURIComponent(taskId)}/preflight`);
    } catch {
      preflight = {};
    }
    return legacyTaskStatus(taskId, task, preflight);
  }
}

function legacyTaskStatus(taskId: string, task: JsonObject, preflight: JsonObject): JsonObject {
  const counts = isJsonObject(preflight.counts) ? preflight.counts : {};
  const status = String(task.status || "");
  const ready = Boolean(preflight.ok);
  const state = status === "active" ? "published" : (ready ? "ready_to_publish" : "needs_fix");
  return {
    ok: true,
    message: "任务状态",
    task: {
      id: String(task.id || taskId),
      name: String(task.name || ""),
      purpose: String(task.purpose || ""),
      mode: String(task.mode || preflight.mode || "gsb"),
      status,
      owner: String(task.owner || ""),
      created_at: String(task.created_at || ""),
      updated_at: String(task.updated_at || ""),
    },
    agent_summary: { state, can_publish: ready && status === "draft", next_command: preflight.next_command || "" },
    datasets: { mode: preflight.data_mode || "", versions: {}, counts },
    setup: { complete: ready, total_items: counts.common ?? 0, min_per_person: task.item_count ?? 0, anchor_count: 0, eval_dimensions: [], task_description: "" },
    visibility: {},
    progress: { evaluator_count: task.evaluator_count ?? 0, item_count: task.item_count ?? 0 },
    readiness: { ok: ready, failures: preflight.failures ?? [], warnings: preflight.warnings ?? [], next_command: preflight.next_command ?? "" },
    report: task.report ?? { exists: false },
    next_commands: preflight.next_command ? [preflight.next_command] : [],
  };
}

function publicTaskFromStatus(status: JsonObject): JsonObject {
  return isJsonObject(status.task) ? status.task : {};
}

function withTaskUrls(status: JsonObject, client: ApiClient, taskId: string): JsonObject {
  return {
    ...status,
    urls: {
      manage: `${client.baseUrl}/tasks/${taskId}/manage/`,
      evaluate: `${client.baseUrl}/tasks/${taskId}/`,
    },
  };
}

function summarizeSetupEffects(data: JsonObject): JsonObject {
  const config = isJsonObject(data.config) ? data.config : {};
  const anchorItems = Array.isArray(config.anchor_items) ? config.anchor_items : [];
  const evalDimensions = Array.isArray(config.eval_dimensions) ? config.eval_dimensions : [];
  return {
    total_items: config.total_items ?? null,
    min_per_person: config.min_per_person ?? null,
    anchor_items_count: anchorItems.length,
    eval_dimensions: evalDimensions,
  };
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
