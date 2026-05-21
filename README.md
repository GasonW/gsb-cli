# ChatBuy GSB CLI

Command line client for the ChatBuy GSB evaluation platform.

`gsb-cli` runs on your machine and controls a GSB platform server through HTTP APIs. You do **not** need to clone or run the platform repository to use the CLI.

## What It Does

- Checks local GSB dataset folders before upload.
- Uploads local version folders to a remote GSB platform.
- Creates, binds, configures, preflights, and publishes GSB tasks.
- Uploads task-specific `renderer.js` files.
- Reads task summaries and exports evaluation results.

The CLI is a client, not the platform server. Pick the server with `--base-url`.

## Requirements

- Node.js `>= 20.11`
- npm `>= 10`
- A reachable ChatBuy GSB platform URL, for example `https://gsb.example.com`
- A platform account with permission to create or manage tasks

Check your Node version:

```bash
node -v
npm -v
```

## Install

### Recommended: Install From GitHub

The package is hosted in this public GitHub repository. Install it globally with npm:

```bash
npm install -g https://github.com/GasonW/gsb-cli/archive/refs/heads/main.tar.gz
```

This installs the latest `main` branch.

You can also install a specific commit or tag:

```bash
npm install -g https://github.com/GasonW/gsb-cli/archive/<tag-or-commit>.tar.gz
```

Verify the install:

```bash
gsb-cli --version
gsb-cli --help
```

### Run Without Installing

Use `npx` when you want a one-off run:

```bash
npx --yes https://github.com/GasonW/gsb-cli/archive/refs/heads/main.tar.gz --help
```

### Update

Reinstall from the latest GitHub archive:

```bash
npm uninstall -g gsb-cli
npm install -g https://github.com/GasonW/gsb-cli/archive/refs/heads/main.tar.gz
```

### Uninstall

```bash
npm uninstall -g gsb-cli
```

### Future npm Registry Install

If this package is later published to npm or an internal npm registry, installation becomes:

```bash
npm install -g gsb-cli
```

For a private/internal registry:

```bash
npm install -g gsb-cli --registry=https://<registry-url>
```

## Quick Start

Set your platform URL once:

```bash
export GSB_BASE_URL="https://<gsb-platform-url>"
```

Check that the server is reachable:

```bash
gsb-cli doctor
```

Log in:

```bash
gsb-cli auth login \
  --username <user> \
  --password <password> \
  --json
```

For automation, prefer an environment variable for the password:

```bash
export GSB_PASSWORD="<password>"
gsb-cli auth login --username <user> --json
```

Create and publish a GSB task:

```bash
gsb-cli dataset check --a ./baseline --b ./candidate --json
gsb-cli dataset upload --a ./baseline --b ./candidate --json

gsb-cli task create --name "candidate vs baseline" --json
gsb-cli task bind <task-id> --a <dataset-a-id> --b <dataset-b-id> --json
gsb-cli task setup <task-id> --min-per-person 0 --json
gsb-cli task preflight <task-id> --json
gsb-cli task publish <task-id> --json
```

Export results:

```bash
gsb-cli results summary <task-id> --all --json
gsb-cli results export <task-id> --format json --output ./exports --json
```

## Remote Platform Usage

This is the default and recommended model:

```bash
gsb-cli --base-url https://<gsb-platform-url> auth login --username <user> --password <password>
gsb-cli --base-url https://<gsb-platform-url> dataset upload --a ./baseline --b ./candidate
```

Important behavior:

- `dataset check` reads local files only for validation.
- `dataset upload` sends local JSON files to the server.
- `task bind` should use dataset IDs returned by `dataset upload`.
- Do not bind local filesystem paths to a remote platform. The remote server cannot read your laptop's paths.

Local path binding is only useful when the platform server runs on the same machine and can read the same path.

## Data Format

Each version is a folder. Each case is one JSON file in the top level of that folder:

```text
baseline/
  item_0001.json
  item_0002.json
candidate/
  item_0001.json
  item_0002.json
```

Rules:

- The same case must use the same filename in both version folders.
- Only top-level `.json` files are used.
- Each JSON file must contain one top-level object.
- CSV, XLSX, JSONL, and nested JSON are not uploaded directly; convert them into the folder shape above first.

## Global Options

Global options may appear before or after the command:

- `--base-url <url>`: GSB platform URL. Defaults to `GSB_BASE_URL` or `http://localhost:8888`.
- `--profile <name>`: local session profile. Defaults to `default`.
- `--username <user>`: optional automatic login username.
- `--password <password>`: optional automatic login password. Prefer `GSB_PASSWORD` for automation.
- `--json`: print machine-readable JSON.
- `--help`: show help.
- `--version`: show CLI version.

Sessions are saved to:

```text
~/.chatbuy_gsb_eval_cli/sessions.json
```

Override the session file path with:

```bash
export GSB_CLI_SESSION="/path/to/sessions.json"
```

## Commands

```bash
gsb-cli doctor

gsb-cli auth login --username <user> --password <password>
gsb-cli auth whoami
gsb-cli auth logout

gsb-cli dataset check <dir>
gsb-cli dataset check --a <version-a-dir> --b <version-b-dir>
gsb-cli dataset check --root <root> --version-a <name> --version-b <name>
gsb-cli dataset upload <dir> --name <name>
gsb-cli dataset upload --a <version-a-dir> --b <version-b-dir> --name-a <name> --name-b <name>
gsb-cli dataset list
gsb-cli dataset guide

gsb-cli task create --name <name> --mode gsb
gsb-cli task get <task-id>
gsb-cli task bind <task-id> --a <dataset-a-id-or-name> --b <dataset-b-id-or-name>
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

## Troubleshooting

### `gsb-cli: command not found`

Check npm's global bin directory:

```bash
npm bin -g
```

Make sure that directory is in your `PATH`, then reinstall:

```bash
npm install -g https://github.com/GasonW/gsb-cli/archive/refs/heads/main.tar.gz
```

### `doctor` says the platform is unreachable

Confirm the URL and network:

```bash
gsb-cli doctor --base-url https://<gsb-platform-url>
```

If the platform is behind VPN or office network restrictions, connect to that network first.

### Remote bind fails with a local path

For remote platforms, upload first:

```bash
gsb-cli dataset upload --a ./baseline --b ./candidate --json
gsb-cli task bind <task-id> --a <dataset-a-id> --b <dataset-b-id> --json
```

The remote server cannot read paths like `/Users/me/data/baseline` on your laptop.

## Development

Clone this CLI repository only if you are developing the CLI itself:

```bash
git clone https://github.com/GasonW/gsb-cli.git
cd gsb-cli
npm install
npm test
```

Build:

```bash
npm run build
```

Run locally:

```bash
node dist/src/index.js --help
```

This package intentionally keeps runtime dependencies at zero. Tests use Node's built-in test runner.
