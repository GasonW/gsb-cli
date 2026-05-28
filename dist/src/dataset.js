import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import { hasErrors, issue, sample } from "./issues.js";
import { expandHome } from "./session.js";
const JSON_SUFFIX = ".json";
const CONVERTIBLE_SUFFIXES = new Set([".csv", ".xlsx", ".xls", ".jsonl", ".ndjson", ".tsv"]);
const DEFAULT_RENDER_FIELDS = new Set([
    "query",
    "response",
    "final_response",
    "conversations",
    "conversion",
    "product_cards",
    "cards",
    "trace",
    "tool_calls",
    "case_uuid",
]);
export const FORMAT_GUIDANCE = {
    platform_requirement: "每个版本是一个文件夹，文件夹第一层每个 .json 文件代表一条 case；去掉 .json 后的文件名是 query_id。",
    gsb_folder_shape: {
        version_a: "<version-a>/<same-query-id>.json",
        version_b: "<version-b>/<same-query-id>.json",
        matching_rule: "A/B 两边只有同名 .json 文件会进入评估列表；只出现在一边的文件会被忽略。",
    },
    json_file_shape: {
        minimum: "JSON 顶层必须是 object/dict，不能是数组或 JSONL 行。",
        default_renderer_fields: {
            query: "用户问题或多轮对话摘要，可选但建议提供。",
            response: "该版本要展示的回答文本；默认 renderer 主要展示这个字段。",
            product_cards: "可选，商品卡片数组；平台会做部分归一化。",
        },
        custom_fields: "服务端会保留未知顶层字段；如果要展示自定义结构，请上传 renderer.js。",
    },
    csv_xlsx_jsonl_instruction: [
        "CLI 不直接转换 CSV/XLSX/JSONL。",
        "Agent 应先把每一行或每条 JSONL 转成一个独立 JSON object 文件。",
        "A/B 两个版本目录内，同一条 case 必须使用完全相同的文件名，例如 item_0001.json。",
        "转换完成后重新运行 dataset check，再 upload/bind/publish。",
    ],
};
export function datasetPath(value) {
    return resolve(expandHome(value));
}
export function inspectDatasetDir(inputPath) {
    const path = datasetPath(inputPath);
    const info = {
        path,
        exists: existsSync(path),
        is_dir: false,
        json_files: [],
        valid_json_files: [],
        invalid_json_files: [],
        non_object_json_files: [],
        non_json_files: [],
        nested_json_files: [],
        convertible_files: [],
        sample_keys: {},
        recognized_default_field_files: 0,
        conversion_plan: null,
    };
    if (!info.exists) {
        return info;
    }
    info.is_dir = statSync(path).isDirectory();
    if (!info.is_dir) {
        return info;
    }
    const topFiles = readdirSync(path, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => join(path, entry.name))
        .sort();
    const jsonFiles = topFiles.filter((file) => extname(file).toLowerCase() === JSON_SUFFIX);
    info.json_files = jsonFiles.map((file) => basename(file));
    info.non_json_files = topFiles
        .map((file) => basename(file))
        .filter((name) => extname(name).toLowerCase() !== JSON_SUFFIX && !name.startsWith("."));
    info.convertible_files = topFiles
        .map((file) => basename(file))
        .filter((name) => CONVERTIBLE_SUFFIXES.has(extname(name).toLowerCase()));
    info.nested_json_files = findNestedJson(path).map((file) => relative(path, file));
    info.conversion_plan = buildConversionPlan(info);
    for (const file of jsonFiles) {
        const name = basename(file);
        let obj;
        try {
            obj = JSON.parse(readFileSync(file, "utf8"));
        }
        catch (error) {
            info.invalid_json_files.push({
                file: name,
                error: error instanceof Error ? error.message : String(error),
            });
            continue;
        }
        if (!isPlainObject(obj)) {
            info.non_object_json_files.push({
                file: name,
                type: Array.isArray(obj) ? "array" : typeof obj,
            });
            continue;
        }
        info.valid_json_files.push(name);
        const keys = Object.keys(obj).sort();
        info.sample_keys[name] = sample(keys, 12);
        if (keys.some((key) => DEFAULT_RENDER_FIELDS.has(key))) {
            info.recognized_default_field_files += 1;
        }
    }
    return info;
}
export function datasetCheckPayload(pathA, pathB, continueCommand, options = {}) {
    const issues = [];
    const result = {
        type: "dataset_check",
        format_guidance: FORMAT_GUIDANCE,
        datasets: {},
    };
    const details = {};
    const datasets = result.datasets;
    if (pathA) {
        const infoA = inspectDatasetDir(pathA);
        details.a = infoA;
        datasets.a = options.verbose ? infoA : summarizeDatasetInfo(infoA);
        issues.push(...issuesForDataset(infoA, pathB ? "版本 A 目录（--a）" : "输入数据目录", continueCommand));
    }
    if (pathB) {
        const infoB = inspectDatasetDir(pathB);
        details.b = infoB;
        datasets.b = options.verbose ? infoB : summarizeDatasetInfo(infoB);
        issues.push(...issuesForDataset(infoB, "版本 B 目录（--b）", continueCommand));
    }
    if (pathA && pathB) {
        const validA = new Set((details.a?.valid_json_files ?? []).map((name) => stripJsonSuffix(name)));
        const validB = new Set((details.b?.valid_json_files ?? []).map((name) => stripJsonSuffix(name)));
        const common = [...validA].filter((value) => validB.has(value)).sort();
        const onlyA = [...validA].filter((value) => !validB.has(value)).sort();
        const onlyB = [...validB].filter((value) => !validA.has(value)).sort();
        const defaultRenderableA = details.a?.recognized_default_field_files ?? 0;
        const defaultRenderableB = details.b?.recognized_default_field_files ?? 0;
        const pair = {
            count_a: validA.size,
            count_b: validB.size,
            common_count: common.length,
            only_a_count: onlyA.length,
            only_b_count: onlyB.length,
            sample_common: sample(common),
            sample_only_a: sample(onlyA),
            sample_only_b: sample(onlyB),
            default_renderable_a: defaultRenderableA,
            default_renderable_b: defaultRenderableB,
        };
        result.pair = pair;
        if (validA.size && validB.size && !common.length) {
            issues.push(issue("ZERO_COMMON_ITEMS", "error", "A/B 版本没有同名 JSON 文件，评估任务会是 0 条", pair, "平台把去掉 .json 后的文件名作为 query_id，只展示两个版本目录内都存在的同名 JSON。", "把同一条 case 在两个版本目录内保存为完全相同的文件名，例如 item_0001.json。", continueCommand));
        }
        if (onlyA.length || onlyB.length) {
            issues.push(issue("UNMATCHED_JSON_IGNORED", "warning", "部分 JSON 只存在于一个版本中，会被平台忽略", pair, "这不会阻塞上传，但这些 case 不会进入 A/B 对比评估。", "补齐缺失版本，或删除不参与评估的单边文件。", continueCommand));
        }
    }
    result.issues = issues;
    result.ok = !hasErrors(issues);
    result.message = result.ok ? "数据检查通过" : "数据检查失败";
    return result;
}
function summarizeDatasetInfo(info) {
    const sampleKeys = {};
    for (const name of sample(info.valid_json_files, 3)) {
        sampleKeys[name] = info.sample_keys[name] ?? [];
    }
    return {
        path: info.path,
        exists: info.exists,
        is_dir: info.is_dir,
        json_count: info.json_files.length,
        valid_json_count: info.valid_json_files.length,
        invalid_json_count: info.invalid_json_files.length,
        non_object_json_count: info.non_object_json_files.length,
        non_json_count: info.non_json_files.length,
        nested_json_count: info.nested_json_files.length,
        convertible_count: info.convertible_files.length,
        recognized_default_field_files: info.recognized_default_field_files,
        sample_valid_json_files: sample(info.valid_json_files, 10),
        sample_invalid_json_files: sample(info.invalid_json_files, 5),
        sample_non_object_json_files: sample(info.non_object_json_files, 5),
        sample_only_non_json_files: sample(info.non_json_files, 5),
        sample_nested_json_files: sample(info.nested_json_files, 5),
        sample_convertible_files: sample(info.convertible_files, 5),
        sample_keys: sampleKeys,
        conversion_plan: info.conversion_plan,
    };
}
export function validFileMap(info) {
    const mapping = {};
    for (const name of info.valid_json_files) {
        mapping[name] = readFileSync(join(info.path, name), "utf8");
    }
    return mapping;
}
function issuesForDataset(info, label, continueCommand) {
    const items = [];
    if (!info.exists) {
        items.push(issue("DATASET_DIR_NOT_FOUND", "error", `找不到${label}`, { path: info.path, dataset_role: label }, "平台只能上传或绑定真实存在的目录。", "确认路径是否拼写正确，或先完成数据转换输出。", continueCommand));
        return items;
    }
    if (!info.is_dir) {
        items.push(issue("DATASET_PATH_NOT_DIRECTORY", "error", `${label}不是目录`, { path: info.path, dataset_role: label }, "平台上传和绑定的单位是数据集文件夹，不是单个文件。", "把每条 case 拆成独立 JSON 文件，放入一个版本目录。", continueCommand));
        return items;
    }
    if (!info.json_files.length) {
        const conversionPlan = info.conversion_plan;
        items.push(issue(info.convertible_files.length ? "NON_JSON_INPUT" : "NO_JSON_FILES", "error", `${label}的第一层没有 .json 文件`, {
            path: info.path,
            dataset_role: label,
            convertible_files: sample(info.convertible_files),
            nested_json_files: sample(info.nested_json_files),
            conversion_plan: conversionPlan,
        }, "服务端只读取版本目录第一层的 .json 文件；CSV/XLSX/JSONL 不会被平台自动转换。", conversionPlan
            ? "按 evidence.conversion_plan 为每个源文件创建一个版本目录；把每条记录写成一个 JSON object 文件，并用同一个稳定字段生成文件名。"
            : "如果 JSON 在子目录里，请把应参与评估的 .json 文件移动到该版本目录第一层；如果当前目录只有源数据文件，请先转换。", continueCommand));
    }
    if (info.invalid_json_files.length) {
        items.push(issue("JSON_PARSE_ERROR", "error", `${label}中有 JSON 文件无法解析`, { dataset_role: label, count: info.invalid_json_files.length, samples: sample(info.invalid_json_files, 10) }, "解析失败的文件不会被服务端加载，可能导致评估条数变少或变成 0。", "修正这些文件的 JSON 语法后重新检查。", continueCommand));
    }
    if (info.non_object_json_files.length) {
        items.push(issue("JSON_ROOT_NOT_OBJECT", "error", `${label}中有 JSON 文件的顶层不是 object`, {
            dataset_role: label,
            count: info.non_object_json_files.length,
            samples: sample(info.non_object_json_files, 10),
            expected_shape: FORMAT_GUIDANCE.json_file_shape,
            folder_shape: FORMAT_GUIDANCE.gsb_folder_shape,
        }, "当前服务端按 object 读取字段；数组、字符串或数字顶层会被跳过。", "把每条 case 转成一个 JSON object，例如 {\"query\":\"...\",\"response\":\"...\"}。", continueCommand));
    }
    if (info.nested_json_files.length) {
        items.push(issue("NESTED_JSON_IGNORED", "warning", `${label}存在子目录 JSON，平台会忽略`, { dataset_role: label, count: info.nested_json_files.length, samples: sample(info.nested_json_files) }, "服务端使用目录第一层的 *.json 作为数据集内容，不递归扫描。", "如这些文件应该参与评估，请移动到版本目录第一层。", continueCommand));
    }
    if (info.non_json_files.length) {
        items.push(issue("NON_JSON_FILES_IGNORED", "warning", `${label}存在非 JSON 文件，平台会忽略`, { dataset_role: label, count: info.non_json_files.length, samples: sample(info.non_json_files) }, "上传接口只保存 .json 文件；其他文件不会进入评估。", "如这些是源数据，请先转换为 JSON 文件夹结构。", continueCommand));
    }
    if (info.valid_json_files.length && info.recognized_default_field_files === 0) {
        items.push(issue("CUSTOM_RENDERER_LIKELY_REQUIRED", "warning", `${label}的 JSON 没有默认 renderer 常用字段`, { dataset_role: label, sample_keys: Object.fromEntries(sample(Object.entries(info.sample_keys), 3)) }, "默认 renderer 主要展示 query、response、product_cards 和 trace；其他字段需要自定义 renderer 才能清晰展示。", "上传任务 renderer.js，或在转换 JSON 时补充 query/response 字段。", "gsb-cli task renderer upload <task-id> <renderer.js>"));
    }
    return items;
}
function buildConversionPlan(info) {
    const convertible = info.convertible_files.filter((name) => [".jsonl", ".ndjson"].includes(extname(name).toLowerCase()));
    if (!convertible.length) {
        return null;
    }
    const sources = [];
    const analyses = convertible.map((name, idx) => {
        const suggestion = suggestVersionDirName(name, idx + 1);
        sources.push({
            source_file: name,
            source_type: extname(name).toLowerCase().slice(1),
            directory_name_suggestion: suggestion,
            example_version_dir: `<output-root>/${suggestion.value}`,
            sample_output_file: "<chosen-version-dir>/<query_id>.json",
        });
        return analyzeJsonlFile(join(info.path, name));
    });
    let idRule = {
        recommended: "<stable-case-id-from-each-record>",
        file_name_template: "<query_id>.json",
        why: "Use a stable id present in every version so the same case has the same JSON filename inside each version directory.",
    };
    if (analyses.length >= 2) {
        let best = null;
        for (const key of ["uuid", "case_uuid", "case_id", "id", "source_id", "meta.source_id"]) {
            const sets = analyses.map((analysis) => analysis._candidate_sets[key]);
            if (sets.every(Boolean)) {
                const [first, ...rest] = sets;
                const intersection = [...first].filter((value) => rest.every((set) => set.has(value)));
                if (intersection.length && (!best || intersection.length > Number(best.shared_count))) {
                    best = { field: key, shared_count: intersection.length, sample_shared_values: sample(intersection.sort(), 5) };
                }
            }
        }
        if (best) {
            const field = String(best.field);
            idRule = {
                recommended: field,
                file_name_template: `<${field.replace(/\./g, "_")}>.json`,
                why: `Detected ${best.shared_count} shared values across JSONL files.`,
                sample_shared_values: best.sample_shared_values,
            };
        }
    }
    return {
        target_shape: "Create one output directory per source version. Directory names are arbitrary, but the same case must use the same JSON filename inside every version directory.",
        suggested_outputs: sources,
        query_id_rule: idRule,
        json_object_rule: [
            "Each output file must contain one top-level JSON object.",
            "Preserve original record fields unless there is a reason to drop them.",
            "If using the default renderer, add query/response fields or upload a task renderer for custom fields.",
        ],
        diagnostic_command_template: "gsb-cli dataset check --a <version-a-output-dir> --b <version-b-output-dir> --json",
        note: "directory_name_suggestion is only a naming suggestion derived from source filenames. The platform does not require those directory names.",
        source_analysis: analyses.map(({ _candidate_sets, ...rest }) => rest),
    };
}
function analyzeJsonlFile(path, limit = 2000) {
    const candidates = ["uuid", "case_uuid", "case_id", "id", "source_id", "meta.source_id"];
    const values = Object.fromEntries(candidates.map((key) => [key, new Set()]));
    const keys = new Set();
    const parseErrors = [];
    let records = 0;
    try {
        const lines = readFileSync(path, "utf8").split(/\r?\n/);
        for (let i = 0; i < Math.min(lines.length, limit); i += 1) {
            const line = lines[i] ?? "";
            if (!line.trim()) {
                continue;
            }
            let obj;
            try {
                obj = JSON.parse(line);
            }
            catch (error) {
                if (parseErrors.length < 5) {
                    parseErrors.push({ line: i + 1, error: error instanceof Error ? error.message : String(error) });
                }
                continue;
            }
            records += 1;
            if (!isPlainObject(obj)) {
                continue;
            }
            for (const key of Object.keys(obj)) {
                keys.add(key);
            }
            for (const key of candidates) {
                const value = getPathValue(obj, key);
                if (typeof value === "string" || typeof value === "number") {
                    values[key].add(String(value));
                }
            }
        }
    }
    catch (error) {
        parseErrors.push({ line: null, error: error instanceof Error ? error.message : String(error) });
    }
    const candidateIds = {};
    for (const [key, set] of Object.entries(values)) {
        if (set.size) {
            candidateIds[key] = { unique_count: set.size, sample: sample([...set].sort(), 5) };
        }
    }
    return {
        file: basename(path),
        records_scanned: records,
        sample_keys: sample([...keys].sort(), 16),
        parse_errors: parseErrors,
        candidate_ids: candidateIds,
        _candidate_sets: values,
    };
}
function findNestedJson(root) {
    const out = [];
    function walk(dir) {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
            }
            else if (entry.isFile() && extname(entry.name).toLowerCase() === JSON_SUFFIX && dir !== root) {
                out.push(full);
            }
        }
    }
    walk(root);
    return out.sort();
}
function getPathValue(obj, path) {
    let cur = obj;
    for (const part of path.split(".")) {
        if (!isPlainObject(cur)) {
            return undefined;
        }
        cur = cur[part];
    }
    return cur;
}
function suggestVersionDirName(fileName, index) {
    const stem = basename(fileName, extname(fileName));
    const firstToken = stem.trim().split(/[-_\s]+/, 1)[0] || "";
    if (/^[A-Za-z]*\d+[A-Za-z]*$/.test(firstToken)) {
        return {
            value: safeOutputName(firstToken, `version_${index}`),
            basis: `derived from leading filename token ${JSON.stringify(firstToken)}`,
            required: false,
        };
    }
    return {
        value: safeOutputName(stem, `version_${index}`),
        basis: "derived from sanitized source filename without extension",
        required: false,
    };
}
function safeOutputName(value, fallback = "version") {
    const name = basename(value, extname(value))
        .replace(/[^\w\-\u4e00-\u9fff]+/gu, "_")
        .replace(/^[_-]+|[_-]+$/g, "");
    return name || fallback;
}
function stripJsonSuffix(name) {
    return extname(name).toLowerCase() === JSON_SUFFIX ? basename(name, extname(name)) : name;
}
function isPlainObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
