# ChatBuy GSB CLI

TypeScript/Node command line client for the ChatBuy GSB evaluation platform.

The CLI is a lightweight HTTP client. Users do not need to clone or run the platform repository; they only need a reachable platform URL.

The default operating model is remote control:

- `gsb-cli` runs on the user's machine.
- `--base-url` selects the server-side GSB platform to control.
- Task creation, binding, setup, preflight, publish, summary, and export all call the server over HTTP.
- Local files are only read for `dataset check`, `dataset upload`, and `task renderer upload`.
- For remote platforms, bind tasks by uploaded dataset id. Do not bind local filesystem paths unless the server can read the same path.

## Install

From an internal npm registry:

```bash
npm install -g @bandai/gsb-cli
```

During early development, install directly from the Git repository:

```bash
npm install -g git+ssh://git@code.byted.org/BandAI/chatbuy-gsb-cli.git
```

Or run without permanent install:

```bash
npx @bandai/gsb-cli --help
```

## Quick Start

```bash
gsb-cli doctor --base-url https://<gsb-platform-url>

gsb-cli auth login \
  --base-url https://<gsb-platform-url> \
  --username <user> \
  --password <password> \
  --json

gsb-cli dataset check --a ./baseline --b ./candidate --json
gsb-cli dataset upload --a ./baseline --b ./candidate --json
gsb-cli task create --name "candidate vs baseline" --json
gsb-cli task bind <task-id> --a <dataset-a-id> --b <dataset-b-id> --json
gsb-cli task setup <task-id> --min-per-person 0 --json
gsb-cli task preflight <task-id> --json
gsb-cli task publish <task-id> --json
gsb-cli results export <task-id> --format json --output ./exports --json
```

## Global Options

These options can appear before or after the command:

- `--base-url <url>`: platform URL. Defaults to `GSB_BASE_URL` or `http://localhost:8888`.
- `--profile <name>`: local session profile. Defaults to `default`.
- `--username <user>` and `--password <password>`: optional automatic login for commands that call the platform.
- `--json`: machine-readable output.

Sessions are saved to `~/.chatbuy_gsb_eval_cli/sessions.json`. Override with `GSB_CLI_SESSION`.

## Commands

```bash
gsb-cli doctor
gsb-cli auth login --username <user> --password <password>
gsb-cli auth whoami
gsb-cli auth logout

gsb-cli dataset check <dir>
gsb-cli dataset check --a <version-a-dir> --b <version-b-dir>
gsb-cli dataset upload <dir> --name <name>
gsb-cli dataset upload --a <version-a-dir> --b <version-b-dir> --name-a <name> --name-b <name>
gsb-cli dataset list
gsb-cli dataset guide

gsb-cli task create --name <name> --mode gsb
gsb-cli task get <task-id>
gsb-cli task bind <task-id> --a <dataset-a-id-or-name-or-path> --b <dataset-b-id-or-name-or-path>
gsb-cli task setup <task-id> --name <name> --description-file ./description.md --min-per-person 0
gsb-cli task config <task-id> --transparent-mode admin_only --stats admin_only --show-trace true --require-comments false
gsb-cli task renderer status <task-id>
gsb-cli task renderer upload <task-id> ./renderer.js
gsb-cli task renderer clear <task-id>
gsb-cli task preflight <task-id>
gsb-cli task publish <task-id>

gsb-cli results summary <task-id> --all
gsb-cli results export <task-id> --format json --output ./exports
```

## Development

```bash
npm install
npm test
```

This package intentionally keeps runtime dependencies at zero. Tests use Node's built-in test runner.
