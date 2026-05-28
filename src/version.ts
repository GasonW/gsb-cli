import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const CLI_VERSION = "0.1.4";
export const DEFAULT_BASE_URL = "http://localhost:8888";

const DEFAULT_CACHE_PATH = join(homedir(), ".chatbuy_gsb_eval_cli", "update_check.json");
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_NPM_PACKAGE = "gsb-cli";
const DEFAULT_GITHUB_PACKAGE_URL = "https://raw.githubusercontent.com/GasonW/gsb-cli/main/package.json";

export interface UpdateNotice {
  current: string;
  latest: string;
  source: string;
  available: boolean;
  update_command: string;
}

interface UpdateCache {
  checked_at?: number;
  current_version?: string;
  latest_version?: string;
  source?: string;
}

export async function checkForUpdate(env: NodeJS.ProcessEnv = process.env, force = false): Promise<UpdateNotice | null> {
  const cachePath = env.GSB_CLI_UPDATE_CACHE || DEFAULT_CACHE_PATH;
  const ttlMs = Number.parseInt(env.GSB_CLI_UPDATE_TTL_MS || "", 10) || DEFAULT_TTL_MS;
  const now = Date.now();
  let cache = loadCache(cachePath);
  if (force || now - Number(cache.checked_at || 0) >= ttlMs) {
    const latest = await fetchLatestVersion(env);
    cache = {
      checked_at: now,
      current_version: CLI_VERSION,
      latest_version: latest.version,
      source: latest.source,
    };
    saveCache(cachePath, cache);
  }
  const latestVersion = String(cache.latest_version || "");
  const source = String(cache.source || "");
  if (latestVersion && isNewerVersion(latestVersion, CLI_VERSION)) {
    return {
      current: CLI_VERSION,
      latest: latestVersion,
      source,
      available: true,
      update_command: updateCommand(source, env),
    };
  }
  return null;
}

export async function updateNoticeText(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  if (env.GSB_CLI_NO_UPDATE_CHECK === "1") {
    return "";
  }
  const notice = await checkForUpdate(env, false);
  if (!notice) {
    return "";
  }
  return `gsb-cli 有新版本：当前 ${notice.current}，最新 ${notice.latest}。建议更新：${notice.update_command}`;
}

async function fetchLatestVersion(env: NodeJS.ProcessEnv): Promise<{ version: string; source: string }> {
  const sources = [
    () => fetchManifestVersion(env.GSB_CLI_LATEST_VERSION_URL || ""),
    () => fetchNpmVersion(env.GSB_CLI_NPM_PACKAGE || DEFAULT_NPM_PACKAGE),
    () => fetchPackageJsonVersion(env.GSB_CLI_GITHUB_PACKAGE_URL || DEFAULT_GITHUB_PACKAGE_URL),
  ];
  for (const source of sources) {
    try {
      const result = await source();
      if (result.version) {
        return result;
      }
    } catch {
      // Update checks are advisory and must not break normal CLI work.
    }
  }
  return { version: "", source: "" };
}

async function fetchManifestVersion(url: string): Promise<{ version: string; source: string }> {
  if (!url) {
    return { version: "", source: "" };
  }
  const text = await fetchText(url);
  try {
    const data = JSON.parse(text) as Record<string, unknown>;
    return { version: String(data.version || data.latest || ""), source: url };
  } catch {
    return { version: text.trim().split(/\s+/)[0] || "", source: url };
  }
}

async function fetchNpmVersion(packageName: string): Promise<{ version: string; source: string }> {
  if (!packageName) {
    return { version: "", source: "" };
  }
  const data = JSON.parse(await fetchText(`https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`)) as Record<string, unknown>;
  return { version: String(data.version || ""), source: `npm:${packageName}` };
}

async function fetchPackageJsonVersion(url: string): Promise<{ version: string; source: string }> {
  const data = JSON.parse(await fetchText(url)) as Record<string, unknown>;
  return { version: String(data.version || ""), source: url };
}

async function fetchText(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      return "";
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function loadCache(path: string): UpdateCache {
  if (!existsSync(path)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as UpdateCache;
  } catch {
    return {};
  }
}

function saveCache(path: string, cache: UpdateCache): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(cache, null, 2)}\n`);
  } catch {
    // Cache writes are best-effort.
  }
}

function updateCommand(source: string, env: NodeJS.ProcessEnv): string {
  if (source.startsWith("npm:")) {
    const packageName = source.slice("npm:".length) || env.GSB_CLI_NPM_PACKAGE || DEFAULT_NPM_PACKAGE;
    return `npm install -g ${packageName}@latest`;
  }
  return "npm install -g https://github.com/GasonW/gsb-cli/archive/refs/heads/main.tar.gz";
}

function isNewerVersion(latest: string, current: string): boolean {
  const a = parseSemver(latest);
  const b = parseSemver(current);
  if (a.major !== b.major) return a.major > b.major;
  if (a.minor !== b.minor) return a.minor > b.minor;
  if (a.patch !== b.patch) return a.patch > b.patch;
  return Boolean(b.suffix && !a.suffix);
}

function parseSemver(value: string): { major: number; minor: number; patch: number; suffix: string } {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?([\-+].*)?$/.exec(value.trim());
  return {
    major: Number.parseInt(match?.[1] || "0", 10),
    minor: Number.parseInt(match?.[2] || "0", 10),
    patch: Number.parseInt(match?.[3] || "0", 10),
    suffix: match?.[4] || "",
  };
}
