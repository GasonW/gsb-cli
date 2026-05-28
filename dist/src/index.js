#!/usr/bin/env node
import { runCli } from "./commands.js";
import { emit } from "./format.js";
import { HELP_TEXT } from "./help.js";
import { CLI_VERSION, updateNoticeText } from "./version.js";
const rawArgv = process.argv.slice(2);
const wantsJson = rawArgv.includes("--json");
if (!wantsJson && (rawArgv.length === 0 || rawArgv.includes("--help") || rawArgv.includes("-h"))) {
    process.stdout.write(`${HELP_TEXT}\n`);
    process.exitCode = 0;
}
else if (!wantsJson && (rawArgv.includes("--version") || rawArgv.includes("-v"))) {
    process.stdout.write(`${CLI_VERSION}\n`);
    process.exitCode = 0;
}
else {
    const result = await runCli(rawArgv);
    const notice = rawArgv[0] === "version" ? "" : await updateNoticeText(process.env);
    if (!wantsJson && notice) {
        process.stderr.write(`${notice}\n`);
    }
    emit(result.payload, wantsJson);
    process.exitCode = result.exitCode;
}
