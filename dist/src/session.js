import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";
export function expandHome(value) {
    if (value === "~") {
        return homedir();
    }
    if (value.startsWith("~/")) {
        return resolve(homedir(), value.slice(2));
    }
    return value;
}
export function sessionPath(env = process.env) {
    return expandHome(env.GSB_CLI_SESSION || "~/.chatbuy_gsb_eval_cli/sessions.json");
}
export function loadSessions(path) {
    try {
        return JSON.parse(readFileSync(path, "utf8"));
    }
    catch {
        return {};
    }
}
export function saveSession(path, profile, data) {
    const sessions = loadSessions(path);
    sessions[profile] = data;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(sessions, null, 2)}\n`, "utf8");
}
export function clearSession(path, profile) {
    const sessions = loadSessions(path);
    if (!(profile in sessions)) {
        return;
    }
    delete sessions[profile];
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(sessions, null, 2)}\n`, "utf8");
}
export function clearAllSessions(path) {
    try {
        rmSync(path);
    }
    catch {
        // Nothing to clear.
    }
}
