import { CLI_VERSION } from "./version.js";

export const HELP_TEXT = `gsb-cli ${CLI_VERSION}

Usage:
  gsb-cli [global options] <command> [args]

Global options may appear before or after the command:
  --base-url <url>      GSB platform URL. Defaults to GSB_BASE_URL or http://localhost:8888
  --profile <name>      Local session profile. Defaults to default
  --username <user>     Optional automatic login username
  --password <pass>     Optional automatic login password. Prefer GSB_PASSWORD in automation
  --json                Print machine-readable JSON
  --help                Show help
  --version             Show version

Commands:
  doctor
  auth login --username <user> --password <pass>
  auth whoami
  auth logout

  dataset check <dir>
  dataset check --a <version-a-dir> --b <version-b-dir>
  dataset check --root <root> --version-a <name> --version-b <name>
  dataset upload <dir> --name <name>
  dataset upload --a <version-a-dir> --b <version-b-dir> --name-a <name> --name-b <name>
  dataset list
  dataset guide

  task create --name <name> --mode gsb
  task get <task-id>
  task bind <task-id> --a <dataset-a-id-or-name> --b <dataset-b-id-or-name>
  task setup <task-id> --name <name> --description-file ./description.md --min-per-person 0
  task config <task-id> --transparent-mode admin_only --stats admin_only --show-trace true --require-comments false
  task renderer status <task-id>
  task renderer upload <task-id> ./renderer.js
  task renderer clear <task-id>
  task preflight <task-id>
  task publish <task-id>

  results summary <task-id> --all
  results export <task-id> --format json --output ./exports

Remote use:
  The CLI runs locally and controls the server selected by --base-url over HTTP.
  Local files are only read for dataset/renderer upload; after upload, bind tasks by dataset id.
`;
