import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
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
    writeSessions(path, sessions);
}
export function clearSession(path, profile) {
    const sessions = loadSessions(path);
    if (!(profile in sessions)) {
        return;
    }
    delete sessions[profile];
    writeSessions(path, sessions);
}
export function clearAllSessions(path) {
    try {
        rmSync(path);
    }
    catch {
        // Nothing to clear.
    }
}
function writeSessions(path, sessions) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(sessions, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    chmodSync(temporary, 0o600);
    renameSync(temporary, path);
    chmodSync(path, 0o600);
}
