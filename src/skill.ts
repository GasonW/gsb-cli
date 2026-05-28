import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { JsonObject } from "./types.js";

export const SKILL_NAME = "gsb-eval";

export type SkillTarget = "codex" | "cursor" | "all";
export type SkillInstallMode = "copy" | "symlink";

const COPY_EXCLUDES = new Set([
  ".DS_Store",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  "node_modules",
]);

export function packageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(join(dir, "package.json"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  throw new Error("找不到 package.json，无法定位包根目录");
}

export function skillSourceDir(): string {
  return join(packageRoot(), "skills", SKILL_NAME);
}

export function skillTargets(target: SkillTarget, env: NodeJS.ProcessEnv = process.env): Array<{ target: Exclude<SkillTarget, "all">; root: string; dest: string }> {
  const labels: Array<Exclude<SkillTarget, "all">> = target === "all" ? ["codex", "cursor"] : [target];
  return labels.map((label) => {
    const root = targetRoot(label, env);
    return { target: label, root, dest: join(root, SKILL_NAME) };
  });
}

export function readSkillVersion(path: string): string {
  const skillFile = join(path, "SKILL.md");
  if (!existsSync(skillFile)) {
    return "";
  }
  const text = readFileSync(skillFile, "utf8");
  return /^version:\s*(.+?)\s*$/m.exec(text)?.[1]?.trim().replace(/^["']|["']$/g, "") || "";
}

export function skillInfo(target: Exclude<SkillTarget, "all">, env: NodeJS.ProcessEnv = process.env): JsonObject {
  const [{ root, dest }] = skillTargets(target, env);
  const exists = existsSync(dest);
  const info: JsonObject = {
    target,
    skills_root: root,
    path: dest,
    exists,
    mode: "missing",
    points_to: "",
    version: "",
    valid: false,
  };
  if (!exists) {
    return info;
  }
  const stat = lstatSync(dest);
  if (stat.isSymbolicLink()) {
    info.mode = "symlink";
    try {
      info.points_to = realpathSync(dest);
    } catch {
      info.points_to = "";
    }
  } else {
    info.mode = "copy";
  }
  info.version = readSkillVersion(dest);
  info.valid = existsSync(join(dest, "SKILL.md"));
  return info;
}

export function installSkill(target: SkillTarget, mode: SkillInstallMode, force: boolean, env: NodeJS.ProcessEnv = process.env): JsonObject {
  const source = skillSourceDir();
  const resolvedSource = realpathSync(source);
  if (!existsSync(join(source, "SKILL.md"))) {
    throw new Error(`打包的 skill 文件缺失: ${source}`);
  }
  const results: JsonObject[] = [];
  const sourceVersion = readSkillVersion(source);
  for (const item of skillTargets(target, env)) {
    if (existsSync(item.dest)) {
      const current = lstatSync(item.dest);
      if (mode === "symlink" && current.isSymbolicLink()) {
        try {
          if (realpathSync(item.dest) === resolvedSource) {
            results.push({ ...skillInfo(item.target, env), action: "already_installed" });
            continue;
          }
        } catch {
          // 符号链接损坏，继续覆盖安装
        }
      }
      if (mode === "copy" && current.isDirectory()) {
        const destVersion = readSkillVersion(item.dest);
        if (destVersion && destVersion === sourceVersion) {
          results.push({ ...skillInfo(item.target, env), action: "already_installed" });
          continue;
        }
      }
      if (!force) {
        throw new Error(`skill 目标已存在: ${item.dest}；使用 --force 覆盖`);
      }
      rmSync(item.dest, { recursive: true, force: true });
    }
    mkdirSync(item.root, { recursive: true });
    if (mode === "symlink") {
      symlinkSync(source, item.dest, "dir");
    } else {
      copySkill(source, item.dest);
    }
    results.push({ ...skillInfo(item.target, env), action: "install" });
  }
  return {
    name: SKILL_NAME,
    source,
    targets: results,
  };
}

export function uninstallSkill(target: SkillTarget, env: NodeJS.ProcessEnv = process.env): JsonObject {
  const results: JsonObject[] = [];
  for (const item of skillTargets(target, env)) {
    const existed = existsSync(item.dest);
    if (existed) {
      rmSync(item.dest, { recursive: true, force: true });
    }
    results.push({ target: item.target, path: item.dest, removed: existed });
  }
  return { name: SKILL_NAME, targets: results };
}

function copySkill(source: string, dest: string): void {
  cpSync(source, dest, {
    recursive: true,
    filter: (src) => {
      const segments = src.split(/[\\/]/);
      return !segments.some((seg) => COPY_EXCLUDES.has(seg));
    },
  });
}

function targetRoot(target: Exclude<SkillTarget, "all">, env: NodeJS.ProcessEnv): string {
  if (target === "codex" && env.GSB_CLI_CODEX_SKILLS_DIR) {
    return env.GSB_CLI_CODEX_SKILLS_DIR;
  }
  if (target === "cursor" && env.GSB_CLI_CURSOR_SKILLS_DIR) {
    return env.GSB_CLI_CURSOR_SKILLS_DIR;
  }
  return target === "codex"
    ? join(homedir(), ".codex", "skills")
    : join(homedir(), ".cursor", "skills");
}
