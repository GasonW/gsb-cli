# API Contract Boundary

The platform repository owns the HTTP API. This CLI depends on the following stable API surface:

- `GET /login` (CSRF bootstrap on JS/Miaoda deployments)
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `GET /api/datasets`
- `POST /api/datasets/upload`
- `POST /api/tasks`
- `GET /api/tasks/{task_id}`
- `GET /api/tasks/{task_id}/status`
- `GET /api/tasks/{task_id}/preflight`
- `POST /api/tasks/{task_id}/publish`
- `POST /api/tasks/{task_id}/archive`
- `POST /tasks/{task_id}/api/select-dirs`
- `POST /tasks/{task_id}/api/setup`
- `POST /tasks/{task_id}/api/admin-config`
- `GET /tasks/{task_id}/api/renderer`
- `POST /tasks/{task_id}/api/renderer`
- `DELETE /tasks/{task_id}/api/renderer`
- `GET /tasks/{task_id}/api/reports`
- `POST /tasks/{task_id}/api/reports`
- `GET /tasks/{task_id}/report/{file_name}`
- `GET /tasks/{task_id}/api/summary`
- `POST /tasks/{task_id}/api/export`

## Authentication Protocol

The current NestJS/PostgreSQL deployment protects API requests with Suda double-submit CSRF:

1. Before login, `GET /login` and read `suda-csrf-token` plus the optional `suda_web_did` from `Set-Cookie`.
2. Send `suda-csrf-token=<token>` in `Cookie` and the same value in `X-Suda-Csrf-Token`.
3. After login, append the returned `session_token` cookie to every API request while retaining the CSRF cookie/header pair.
4. Persist session, CSRF, and web-device cookies with file mode `0600`; never persist the password.

For backward compatibility, the client still accepts a legacy Python deployment that serves `/login` without a CSRF cookie. An old saved session that receives an explicit CSRF 403 is bootstrapped and retried once automatically.

`POST /api/auth/register` request fields:

- `username` string, required. Must satisfy platform username constraints.
- `password` string, required. Must satisfy platform password constraints.

`POST /api/tasks` request fields:

- `name` string, required. Display name shown in task lists and management pages.
- `purpose` string, optional. Creator-facing task purpose or reminder, distinct from evaluator-facing setup description.
- `mode` string, optional. Supported values are `gsb`, `review`, and the legacy `preview`; CLI defaults to `gsb`.
- `task_id` string, optional. Storage directory id. When omitted, the platform derives a stable id from `name`.

`POST /api/datasets/upload` request fields:

- `folder_name` string, required. Dataset display/storage name.
- `format` string, optional. New GSB inputs use `aidp-jsonl`; omitted means legacy JSON directory upload.
- `files` object, required. For `aidp-jsonl`, it contains exactly one `.jsonl` file; legacy uploads contain `.json` files.
- `on_duplicate` string, optional. Supported values are `fail`, `reuse`, `replace`, and `force_new`; default is `fail`.

Dataset upload response rules:

- Exact same dataset name, file names, and file content returns the existing dataset id with `reused: true`.
- Same dataset name with different content returns HTTP 409 and a structured code such as `DATASET_NAME_CONFLICT`.
- `replace` overwrites the selected same-name dataset content and returns the reused dataset id with `replaced: true`.
- `force_new` creates a new physical dataset storage name and returns the new dataset id.
- `aidp-jsonl` responses include `format`, `row_count`, and `version_names`.

`POST /tasks/{task_id}/api/select-dirs` supports two binding shapes:

- Preferred: `{ "dataset_id": "<aidp-jsonl-dataset-id>" }`. The platform snapshots its A/B rows into PostgreSQL task-item records and stores the dataset/version mapping in task config.
- Legacy: `{ "dirs": ["<server-dir-a>", "<server-dir-b>"] }`.

Direct browser upload may send exactly one `.jsonl` file as multipart form data to the same endpoint.
Binding a different raw input over an existing task returns `TASK_INPUT_REVISION_REQUIRED` unless an intentional draft replacement is explicitly requested.

For `mode=review`, multipart input uses the platform-owned `review-jsonl-v1` contract with complete
`version/response/productCards` fields for A, B, and C. The CLI can create, inspect, preflight, publish,
and export Review tasks. CLI `dataset upload` / `task bind --input` remain A/B AIDP-only; upload the
three-model Review JSONL from `urls.manage` until a dedicated CLI Review uploader is added.
Review evaluator results use complete `quality_scores` (`A/B/C`, each `0|1|2|3`) and optional
`global_comments` (`A/B/C` strings). They intentionally leave GSB winner, magnitude, and dimensions empty.

`GET /api/tasks/{task_id}/status` returns the Agent-facing task state. It should not expose raw task registry `config` internals. The stable top-level fields are:

- `task`: id, name, purpose, mode, status, owner, timestamps.
- `agent_summary`: state, `can_publish`, and `next_command`.
- `datasets`: data mode, available A/B/C version names, and counts.
- `setup`: setup completion, total items, `min_per_person`, `anchor_count`, evaluator-facing task description, and eval dimensions.
- `visibility`: `transparent_mode`, `stats`, `show_trace`, and `require_comments`.
- `progress`: evaluator count and item count.
- `readiness`: preflight ok/failures/warnings and next command.
- `report`: archived report status visible to the requester.

`POST /tasks/{task_id}/api/reports` request fields:

- `files` object, required. Keys are report file names and values are text content.
- Accepted file suffixes are `.html` and `.json`; JSON files must contain valid JSON text.
- Reports are stored in PostgreSQL `legacy_reports` and discovered by task ID. `report status` returns `report_dir: "database://legacy_reports"` and `source: "database"`; callers must not infer a server filesystem path.
- For `gsb-decision-v2`, the CLI uploads exactly `decision_report.html` and `decision_summary.json`, requires `source_analysis_run_id`, and rejects review links that are not task-relative `../review/?q=<query-id>`. Immutable run artifacts remain local under `report/runs/<analysis-run-id>/` and are not part of this HTTP payload.
- The v2 HTML is an evaluation-analysis surface, not a launch-decision surface: it uses real model version names; separates question scope from annotation-record processing; reports question-level Pointwise mean/zero/`>=2` rates; reports G/S/B plus both win rates excluding Same; and translates 95% intervals into a significance/stability statement. Raw rating-record distributions, protocol, run id, checksum, and launch recommendations are not reader-visible HTML fields; they may remain in the JSON/audit lineage.
- Report attachment links use `GET /tasks/<task-id>/artifacts/download?path=<workspace-relative-path>`. The endpoint requires the same task/statistics permission as the report and only accepts files resolved from the task source reference, model-run manifests, benchmark manifests, or task raw-result directories. It returns `Content-Disposition: attachment`; arbitrary workspace paths return 404.
- Report status keeps `aggregate_dir`, `html_sources`, and `json_sources` as empty compatibility fields.

`POST /tasks/{task_id}/api/export` JSON results include evaluator records with:

- `comments` object keyed by actual version name plus `general`.
- `comments[version].items` as the canonical version-level global comment list. Each item may contain `id`, `side`, `version_key`, `version`, `target_type: "global"`, `comment`, `feedback_type`, `images`, and timestamps.
- `comments[version].pros` and `comments[version].cons` as compatibility text derived from positive and negative global comments.
- `anchored_comments` as the shared comment item list for text selections, cards, blocks, and global comments. Consumers that need only locatable highlights should ignore entries with `target_type: "global"`.

Compatibility rule:

1. Platform changes should be additive within `/api/v1` or the current unversioned equivalent.
2. CLI releases should pass tests against the latest platform test server before publishing.
3. Breaking API changes require a new API version and a CLI compatibility check in `gsb-cli doctor`.
4. Any platform capability or HTTP API change must update this CLI, the public CLI docs, and the corresponding GSB skill in the same change set.

## Bundled Skill Contract

The npm package ships `skills/gsb-eval/` with the CLI. `npm install` runs `scripts/postinstall.mjs`, which calls:

```bash
gsb-cli skill install --target all --mode copy --force --json
```

Environment controls:

- `GSB_CLI_SKILL_TARGET=codex|cursor|all`
- `GSB_CLI_SKILL_MODE=copy|symlink`
- `GSB_CLI_SKIP_SKILL_INSTALL=1`

The skill must describe commands that exist in this package version. If command syntax changes, update `skills/gsb-eval/SKILL.md`, `skills/gsb-eval/references/`, `README.md`, source, generated `dist/`, and tests together.

## Version Check Contract

The CLI may emit a human-only update notice when a newer version is available. This notice is written to stderr and is skipped for `--json`.

Check order:

1. `GSB_CLI_LATEST_VERSION_URL`
2. npm registry package metadata
3. GitHub `package.json` on `main`

The result is cached under `~/.chatbuy_gsb_eval_cli/update_check.json` by default. `GSB_CLI_NO_UPDATE_CHECK=1` disables the notice.
