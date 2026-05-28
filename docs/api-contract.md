# API Contract Boundary

The platform repository owns the HTTP API. This CLI depends on the following stable API surface:

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

`POST /api/auth/register` request fields:

- `username` string, required. Must satisfy platform username constraints.
- `password` string, required. Must satisfy platform password constraints.

`POST /api/tasks` request fields:

- `name` string, required. Display name shown in task lists and management pages.
- `purpose` string, optional. Creator-facing task purpose or reminder, distinct from evaluator-facing setup description.
- `mode` string, optional. Supported values are `gsb` and `preview`; CLI defaults to `gsb`.
- `task_id` string, optional. Storage directory id. When omitted, the platform derives a stable id from `name`.

`POST /api/datasets/upload` request fields:

- `folder_name` string, required. Dataset display/storage name.
- `files` object, required. Keys are `.json` file names and values are file content.
- `on_duplicate` string, optional. Supported values are `fail`, `reuse`, `replace`, and `force_new`; default is `fail`.

Dataset upload response rules:

- Exact same dataset name, file names, and file content returns the existing dataset id with `reused: true`.
- Same dataset name with different content returns HTTP 409 and a structured code such as `DATASET_NAME_CONFLICT`.
- `replace` overwrites the selected same-name dataset content and returns the reused dataset id with `replaced: true`.
- `force_new` creates a new physical dataset storage name and returns the new dataset id.

`GET /api/tasks/{task_id}/status` returns the Agent-facing task state. It should not expose raw task registry `config` internals. The stable top-level fields are:

- `task`: id, name, purpose, mode, status, owner, timestamps.
- `agent_summary`: state, `can_publish`, and `next_command`.
- `datasets`: data mode, A/B version names, and counts.
- `setup`: setup completion, total items, `min_per_person`, `anchor_count`, evaluator-facing task description, and eval dimensions.
- `visibility`: `transparent_mode`, `stats`, `show_trace`, and `require_comments`.
- `progress`: evaluator count and item count.
- `readiness`: preflight ok/failures/warnings and next command.
- `report`: archived report status visible to the requester.

`POST /tasks/{task_id}/api/reports` request fields:

- `files` object, required. Keys are report file names and values are text content.
- Accepted file suffixes are `.html` and `.json`; JSON files must contain valid JSON text.

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
