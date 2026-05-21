import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";
import type { SessionData } from "./types.js";

export function expandHome(value: string): string {
  if (value === "~") {
    return homedir();
  }
  if (value.startsWith("~/")) {
    return resolve(homedir(), value.slice(2));
  }
  return value;
}

export function sessionPath(env: NodeJS.ProcessEnv = process.env): string {
  return expandHome(env.GSB_CLI_SESSION || "~/.chatbuy_gsb_eval_cli/sessions.json");
}

export function loadSessions(path: string): Record<string, SessionData> {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, SessionData>;
  } catch {
    return {};
  }
}

export function saveSession(path: string, profile: string, data: SessionData): void {
  const sessions = loadSessions(path);
  sessions[profile] = data;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(sessions, null, 2)}\n`, "utf8");
}

export function clearSession(path: string, profile: string): void {
  const sessions = loadSessions(path);
  if (!(profile in sessions)) {
    return;
  }
  delete sessions[profile];
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(sessions, null, 2)}\n`, "utf8");
}

export function clearAllSessions(path: string): void {
  try {
    rmSync(path);
  } catch {
    // Nothing to clear.
  }
}
