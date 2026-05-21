const globalValueFlags = {
    "--base-url": "baseUrl",
    "--profile": "profile",
    "--username": "username",
    "--password": "password",
};
export function parseArgs(rawArgv, env = process.env, cwd = process.cwd()) {
    const globals = {
        profile: "default",
        json: false,
        help: false,
        version: false,
        rawArgv,
        env,
        cwd,
    };
    const cleaned = [];
    for (let i = 0; i < rawArgv.length; i += 1) {
        const part = rawArgv[i] ?? "";
        if (part === "--json") {
            globals.json = true;
            continue;
        }
        if (part === "--help" || part === "-h") {
            globals.help = true;
            continue;
        }
        if (part === "--version" || part === "-v") {
            globals.version = true;
            continue;
        }
        const eq = part.indexOf("=");
        const key = eq >= 0 ? part.slice(0, eq) : part;
        if (key in globalValueFlags) {
            const target = globalValueFlags[key];
            const value = eq >= 0 ? part.slice(eq + 1) : rawArgv[i + 1];
            if (value === undefined) {
                throw new CliUsageError(`${key} requires a value`);
            }
            globals[target] = value;
            if (eq < 0) {
                i += 1;
            }
            continue;
        }
        cleaned.push(part);
    }
    return { globals, args: cleaned };
}
export class CliUsageError extends Error {
    constructor(message) {
        super(message);
        this.name = "CliUsageError";
    }
}
export class OptionReader {
    values;
    constructor(values) {
        this.values = [...values];
    }
    rest() {
        return [...this.values];
    }
    takeString(name, defaultValue = "") {
        const flag = `--${name}`;
        for (let i = 0; i < this.values.length; i += 1) {
            const value = this.values[i] ?? "";
            if (value === flag) {
                const next = this.values[i + 1];
                if (next === undefined) {
                    throw new CliUsageError(`${flag} requires a value`);
                }
                this.values.splice(i, 2);
                return next;
            }
            if (value.startsWith(`${flag}=`)) {
                this.values.splice(i, 1);
                return value.slice(flag.length + 1);
            }
        }
        return defaultValue;
    }
    takeOptionalString(name) {
        const value = this.takeString(name, "\u0000");
        return value === "\u0000" ? undefined : value;
    }
    takeNumber(name, defaultValue) {
        const raw = this.takeOptionalString(name);
        if (raw === undefined) {
            return defaultValue;
        }
        const value = Number.parseInt(raw, 10);
        if (!Number.isFinite(value)) {
            throw new CliUsageError(`--${name} expects an integer, got ${raw}`);
        }
        return value;
    }
    takeFloat(name, defaultValue) {
        const raw = this.takeOptionalString(name);
        if (raw === undefined) {
            return defaultValue;
        }
        const value = Number.parseFloat(raw);
        if (!Number.isFinite(value)) {
            throw new CliUsageError(`--${name} expects a number, got ${raw}`);
        }
        return value;
    }
    takeBoolean(name) {
        const raw = this.takeOptionalString(name);
        if (raw === undefined) {
            return undefined;
        }
        const normalized = raw.trim().toLowerCase();
        if (["1", "true", "yes", "y", "on", "是"].includes(normalized)) {
            return true;
        }
        if (["0", "false", "no", "n", "off", "否"].includes(normalized)) {
            return false;
        }
        throw new CliUsageError(`--${name} expects boolean, got ${raw}`);
    }
    takeFlag(name) {
        const flag = `--${name}`;
        const idx = this.values.indexOf(flag);
        if (idx >= 0) {
            this.values.splice(idx, 1);
            return true;
        }
        return false;
    }
    requireNoUnknown() {
        const unknown = this.values.find((value) => value.startsWith("-"));
        if (unknown) {
            throw new CliUsageError(`unknown option ${unknown}`);
        }
    }
}
export function requireArg(args, index, name) {
    const value = args[index];
    if (!value || value.startsWith("-")) {
        throw new CliUsageError(`${name} is required`);
    }
    return value;
}
