import type { Issue, JsonObject } from "./types.js";

export function issue(
  code: string,
  severity: Issue["severity"],
  problem: string,
  evidence: JsonObject = {},
  why = "",
  nextStep = "",
  continueCommand = "",
): Issue {
  const payload: Issue = {
    code,
    severity,
    status: severity === "error" ? "fail" : severity === "warning" ? "warn" : "info",
    problem,
    evidence,
    why,
    next_step: nextStep,
  };
  const hint = continueAfterFixHint(code, continueCommand, severity);
  if (hint) {
    payload.continue_after_fix = hint;
  }
  return payload;
}

export function hasErrors(items: Array<Record<string, unknown>>): boolean {
  return items.some((item) => item.severity === "error" || item.status === "fail");
}

export function sample<T>(values: Iterable<T>, limit = 8): T[] {
  return Array.from(values).slice(0, limit);
}

export function redactedArgv(rawArgv: string[]): string {
  const parts = ["gsb-cli"];
  for (let i = 0; i < rawArgv.length; i += 1) {
    const part = rawArgv[i] ?? "";
    if (part === "--password") {
      parts.push("--password", "<password>");
      i += 1;
      continue;
    }
    if (part.startsWith("--password=")) {
      parts.push("--password=<password>");
      continue;
    }
    parts.push(part);
  }
  return parts.join(" ");
}

function continueAfterFixHint(
  code: string,
  command: string,
  severity: Issue["severity"],
): Issue["continue_after_fix"] | undefined {
  if (!command) {
    return undefined;
  }

  let intent = "继续完成刚才失败的 CLI 操作。";
  let precondition = "已经按 next_step 修复阻塞问题。";

  if (severity === "warning") {
    intent = "如果选择处理该 warning，处理完成后继续原流程。";
    precondition = "已确认该 warning 是否会影响当前任务质量。";
  } else if (code.startsWith("AUTH_") || code === "PASSWORD_CHANGE_REQUIRED") {
    intent = "继续完成登录或继续执行刚才因认证受阻的操作。";
    precondition = "已经取得可用账号凭据；密码不要写入仓库文件或日志。";
  } else if (
    [
      "NON_JSON_INPUT",
      "NO_JSON_FILES",
      "JSON_PARSE_ERROR",
      "JSON_ROOT_NOT_OBJECT",
      "DATASET_DIR_NOT_FOUND",
      "DATASET_PATH_NOT_DIRECTORY",
      "PAIR_UPLOAD_REQUIRES_A_AND_B",
    ].includes(code)
  ) {
    intent = "继续完成刚才的数据检查或数据上传。";
    precondition = "数据目录已经按 next_step 修复；如命令中有占位符，已替换为真实路径。";
  } else if (["ZERO_COMMON_ITEMS", "UNMATCHED_JSON_IGNORED"].includes(code)) {
    intent = "继续完成刚才的数据上传、绑定或发布流程。";
    precondition = "同一条 case 在每个版本目录内的 JSON 文件名已经按需修复。";
  } else if (code.startsWith("DATASET_REF_") || code === "ZERO_COMMON_ITEMS_AFTER_BIND") {
    intent = "继续完成刚才的数据源绑定。";
    precondition = "已选择服务端可访问且唯一的数据集引用；必要时已重新上传数据集。";
  } else if (
    [
      "DATA_SOURCE_NOT_BOUND",
      "EMPTY_VERSION_DATASET",
      "SETUP_ZERO_ITEMS",
      "MIN_PER_PERSON_INVALID",
      "SETUP_MISSING",
      "PREVIEW_DATA_NOT_BOUND",
      "SETUP_DATA_COUNT_MISMATCH",
    ].includes(code)
  ) {
    intent = "继续完成刚才的任务配置或发布流程。";
    precondition = "任务数据源和分配策略已经按 next_step 修复。";
  } else if (code.startsWith("RENDER") || code === "DEFAULT_RENDERER_IN_USE" || code === "CUSTOM_RENDERER_LIKELY_REQUIRED") {
    intent = "继续完成 renderer 上传或任务发布流程。";
    precondition = "renderer.js 已存在且满足任务渲染要求，或已确认默认 renderer 足够。";
  } else if (code.startsWith("EXPORT_")) {
    intent = "继续完成刚才的结果导出。";
    precondition = "导出问题已处理；如果是超时，已决定重试或调整超时时间。";
  }

  return { command, intent, precondition };
}
