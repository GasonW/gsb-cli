#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.env.GSB_CLI_SKIP_SKILL_INSTALL === "1") {
  if (process.env.GSB_CLI_POSTINSTALL_VERBOSE === "1") {
    console.log("[gsb-cli] skill 自动安装已跳过（GSB_CLI_SKIP_SKILL_INSTALL=1）");
  }
  process.exit(0);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = process.env.GSB_CLI_SKILL_TARGET || "all";
const mode = process.env.GSB_CLI_SKILL_MODE || "copy";
const cli = resolve(root, "dist", "src", "index.js");

const result = spawnSync(
  process.execPath,
  [
    cli,
    "skill",
    "install",
    "--target",
    target,
    "--mode",
    mode,
    "--force",
    "--json",
  ],
  {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GSB_CLI_NO_UPDATE_CHECK: "1",
    },
  },
);

if (result.status === 0) {
  if (process.env.GSB_CLI_POSTINSTALL_VERBOSE === "1" && result.stdout.trim()) {
    console.log(result.stdout.trim());
  }
  process.exit(0);
}

const detail = result.stderr.trim() || result.stdout.trim() || result.error?.message || "unknown error";
console.warn(`[gsb-cli] skill 自动安装失败: ${detail}`);
