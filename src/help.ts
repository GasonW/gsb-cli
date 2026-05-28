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
  version --check

  skill install --target codex --mode copy --force
  skill status --target all
  skill uninstall --target codex

  Skill 管理：将 gsb-eval skill 安装到 Codex/Cursor Agent 目录。
  npm install 时自动以 copy 模式安装。开发时推荐 symlink：
    gsb-cli skill install --target codex --mode symlink
  环境变量 GSB_CLI_SKILL_TARGET=all|codex|cursor 控制目标，
  GSB_CLI_SKIP_SKILL_INSTALL=1 跳过自动安装。

  auth login --username <user> --password <pass>
  auth register --username <user> --password <pass>
  auth whoami
  auth logout

  dataset check <dir> --verbose
  dataset check --a <version-a-dir> --b <version-b-dir>
  dataset check --root <root> --version-a <name> --version-b <name>
  dataset upload <dir> --name <name>
  dataset upload --a <version-a-dir> --b <version-b-dir> --name-a <name> --name-b <name>
  dataset list
  dataset guide

  task create --name <name> --purpose <purpose> --mode gsb
  task get <task-id>
  task create-gsb --name <name> --a <dataset-a> --b <dataset-b> --description-file ./description.md --publish
  task configure <task-id> --min-per-person auto --require-comments false --show-trace false
  task bind <task-id> --a <dataset-a-id-or-name> --b <dataset-b-id-or-name>
  task setup <task-id> --name <name> --description-file ./description.md --min-per-person auto
  task config <task-id> --transparent-mode admin_only --stats admin_only --show-trace false --require-comments false
  task renderer status <task-id>
  task renderer upload <task-id> ./renderer.js
  task renderer clear <task-id>
  task preflight <task-id>
  task publish <task-id>
  task archive <task-id>

  report status <task-id>
  report url <task-id>
  report upload <task-id> ./decision_report.html ./decision_summary.json
  report download <task-id> --type html --output ./report.html

  results summary <task-id> --all
  results export <task-id> --format json --output ./exports

Remote use:
  The CLI runs locally and controls the server selected by --base-url over HTTP.
  Local files are only read for dataset/renderer upload; after upload, bind tasks by dataset id.
`;
