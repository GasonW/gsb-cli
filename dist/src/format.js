export function emit(payload, json) {
    if (json) {
        process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
        return;
    }
    process.stdout.write(`${humanText(payload)}\n`);
}
export function humanText(payload) {
    const lines = [];
    const ok = payload.ok !== false;
    lines.push(`${ok ? "OK" : "FAILED"}: ${String(payload.message || payload.type || "result")}`);
    for (const key of ["base_url", "profile", "username", "role", "output_path", "cli_version"]) {
        if (payload[key] !== undefined && payload[key] !== "") {
            lines.push(`${key}: ${String(payload[key])}`);
        }
    }
    if (isRecord(payload.update)) {
        lines.push(`update: latest=${payload.update.latest ?? ""} available=${payload.update.available ?? false}`);
        if (payload.update.update_command) {
            lines.push(`update command: ${payload.update.update_command}`);
        }
    }
    if (isRecord(payload.skill)) {
        lines.push(`skill: ${payload.skill.name ?? ""}`);
        for (const target of asRecordArray(payload.skill.targets)) {
            const state = target.exists !== undefined ? `exists=${target.exists}` : `removed=${target.removed ?? ""}`;
            lines.push(`target[${target.target ?? ""}]: ${target.path ?? ""} ${target.mode ? `mode=${target.mode} ` : ""}${state} version=${target.version ?? ""}`);
        }
    }
    if (isRecord(payload.task)) {
        lines.push(`task: ${payload.task.id ?? ""} | ${payload.task.name ?? ""} | ${payload.task.status ?? ""} | ${payload.task.mode ?? ""}`);
    }
    if (isRecord(payload.agent_summary)) {
        lines.push(`state: ${payload.agent_summary.state ?? ""} | can_publish=${payload.agent_summary.can_publish ?? ""}`);
    }
    if (isRecord(payload.datasets) && isRecord(payload.datasets.counts)) {
        const counts = payload.datasets.counts;
        lines.push(`datasets: mode=${payload.datasets.mode ?? ""} A=${counts.a ?? ""} B=${counts.b ?? ""} common=${counts.common ?? ""}`);
    }
    if (isRecord(payload.selection)) {
        lines.push(`selection: task=${payload.selection.task_id ?? ""} mode=${payload.selection.data_mode ?? ""} common=${payload.selection.common_count ?? ""}`);
    }
    if (Array.isArray(payload.uploaded)) {
        for (const item of payload.uploaded) {
            if (isRecord(item)) {
                lines.push(`uploaded[${item.label ?? ""}]: id=${item.id ?? ""} name=${item.name ?? ""} json_count=${item.json_count ?? ""} reused=${item.reused ?? false} replaced=${item.replaced ?? false}`);
            }
        }
    }
    if (isRecord(payload.datasets) && payload.type !== "dataset_check") {
        for (const group of ["my", "others"]) {
            const items = payload.datasets[group];
            if (!Array.isArray(items)) {
                continue;
            }
            for (const ds of items) {
                if (isRecord(ds)) {
                    lines.push(`${group}: ${ds.id ?? ""} | ${ds.name ?? ""} | ${ds.json_count ?? ""} | ${ds.path ?? ""}`);
                }
            }
        }
    }
    if (payload.type === "dataset_check" && isRecord(payload.datasets)) {
        for (const [label, info] of Object.entries(payload.datasets)) {
            if (isRecord(info)) {
                lines.push(`dataset ${label}: ${info.path ?? ""} | json=${info.json_count ?? arrayLen(info.json_files)} valid=${info.valid_json_count ?? arrayLen(info.valid_json_files)}`);
            }
        }
        if (isRecord(payload.pair)) {
            const p = payload.pair;
            lines.push(`pair: A=${p.count_a} B=${p.count_b} common=${p.common_count} only_a=${p.only_a_count} only_b=${p.only_b_count}`);
        }
    }
    const combined = dedupeRecords([
        ...asRecordArray(payload.issues),
        ...asRecordArray(payload.failures),
        ...asRecordArray(payload.warnings),
        ...asRecordArray(payload.preflight_warnings),
        ...asRecordArray(isRecord(payload.preflight) ? payload.preflight.failures : undefined),
        ...asRecordArray(payload.checks).filter((item) => item.status !== "pass"),
        ...asRecordArray(isRecord(payload.preflight) ? payload.preflight.checks : undefined).filter((item) => item.status !== "pass"),
    ]);
    for (const item of combined) {
        lines.push("");
        lines.push(`[${item.severity ?? item.status ?? ""}] ${item.code ?? ""}: ${item.problem ?? ""}`);
        if (item.evidence !== undefined && Object.keys(asRecord(item.evidence)).length) {
            lines.push(`evidence: ${compact(item.evidence)}`);
        }
        if (item.why) {
            lines.push(`why: ${item.why}`);
        }
        if (item.next_step) {
            lines.push(`next: ${item.next_step}`);
        }
        if (isRecord(item.continue_after_fix)) {
            lines.push(`continue: ${item.continue_after_fix.command ?? ""}`);
            if (item.continue_after_fix.intent) {
                lines.push(`intent: ${item.continue_after_fix.intent}`);
            }
            if (item.continue_after_fix.precondition) {
                lines.push(`precondition: ${item.continue_after_fix.precondition}`);
            }
        }
    }
    if (isRecord(payload.urls)) {
        for (const [key, value] of Object.entries(payload.urls)) {
            lines.push(`url[${key}]: ${String(value)}`);
        }
    }
    if (Array.isArray(payload.next_commands)) {
        for (const cmd of payload.next_commands) {
            lines.push(`next command: ${String(cmd)}`);
        }
    }
    if (payload.update_note) {
        lines.push(String(payload.update_note));
    }
    if (payload.restart_note) {
        lines.push(String(payload.restart_note));
    }
    return lines.join("\n");
}
function arrayLen(value) {
    return Array.isArray(value) ? value.length : 0;
}
function asRecord(value) {
    return isRecord(value) ? value : {};
}
function asRecordArray(value) {
    return Array.isArray(value) ? value.filter(isRecord) : [];
}
function compact(value) {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return text.length <= 500 ? text : `${text.slice(0, 497)}...`;
}
function dedupeRecords(items) {
    const seen = new Set();
    const out = [];
    for (const item of items) {
        const key = JSON.stringify(item);
        if (!seen.has(key)) {
            seen.add(key);
            out.push(item);
        }
    }
    return out;
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
