# gsb-cli

> 在本地命令行控制远端 GSB 评估平台：检查数据、上传版本、创建任务、发布评估、导出结果。

![Node](https://img.shields.io/badge/node-%3E%3D20.11-339933)
![npm](https://img.shields.io/badge/install-npm-blue)
![License](https://img.shields.io/badge/license-MIT-lightgrey)

`gsb-cli` 是 ChatBuy GSB 评估平台的命令行客户端。它只负责通过 HTTP API 操作平台服务，不包含平台后端，也不要求使用者 clone 平台仓库。

适合：

- PM / 评估负责人快速创建 GSB 人工评估任务；
- Agent 自动化上传数据、发布任务、导出结果；
- 多人共用同一个远端 GSB 平台，但每个人只在本机安装一个轻量 CLI。

## 为什么需要 gsb-cli

过去要做一次 GSB 任务，常见流程是打开网页、手动上传、手动绑定、手动检查发布状态。这个过程对人还可以，对 Agent 和批量任务不稳定。

`gsb-cli` 把这些动作变成可复制的命令：

| 能力 | 说明 |
| --- | --- |
| 数据检查 | 在上传前检查 A/B 文件是否一一对应、JSON 是否有效、默认 renderer 是否可能展示为空 |
| 数据上传 | 把本地版本目录上传到远端 GSB 平台 |
| 任务管理 | 创建任务、绑定数据集、配置分配策略、发布前检查、发布任务 |
| Renderer 管理 | 上传或清除任务级 `renderer.js` |
| 结果回收 | 查询全员汇总，导出 JSON / CSV / ZIP 结果 |
| Agent 友好 | 所有核心命令支持 `--json`，失败时返回可修复的结构化问题 |

## 工作方式

```text
你的电脑
  └─ gsb-cli
       ├─ 读取本地数据目录
       ├─ 上传 JSON 文件 / renderer.js
       └─ 通过 HTTP API 控制远端平台

远端 GSB 平台
  ├─ 保存数据集
  ├─ 创建和发布评估任务
  └─ 导出评估结果
```

关键点：

- `gsb-cli` 在本地运行。
- `--base-url` 决定要控制哪一个 GSB 平台。
- 远端平台不能读取你电脑上的 `/Users/...` 路径。
- 远端使用时，先 `dataset upload`，再用返回的 dataset id 做 `task bind`。

## 30 秒安装

要求：

- Node.js `>= 20.11`
- npm `>= 10`

检查版本：

```bash
node -v
npm -v
```

从 npm 安装：

```bash
npm install -g gsb-cli
```

安装包内自带 `gsb-eval` Agent skill。`npm install` 会默认把 skill 复制到 Codex 和 Cursor 的 skills 目录：

- Codex: `~/.codex/skills/gsb-eval`
- Cursor: `~/.cursor/skills/gsb-eval`

如果只想安装到某一个 Agent，或跳过自动安装：

```bash
GSB_CLI_SKILL_TARGET=codex npm install -g gsb-cli
GSB_CLI_SKIP_SKILL_INSTALL=1 npm install -g gsb-cli
```

验证：

```bash
gsb-cli --version
gsb-cli --help
gsb-cli skill status --target all
```

一次性运行，不全局安装：

```bash
npx --yes gsb-cli --help
```

更新：

```bash
npm install -g gsb-cli@latest
```

如果需要从 GitHub main 分支安装开发版：

```bash
npm install -g https://github.com/GasonW/gsb-cli/archive/refs/heads/main.tar.gz
```

CLI 会定期检查最新版本并在非 JSON 输出里提示。手动检查：

```bash
gsb-cli version --check
```

检查结果默认缓存 24 小时，可用 `GSB_CLI_NO_UPDATE_CHECK=1` 关闭提醒。JSON 输出不会带版本提醒，方便 Agent 稳定解析。

卸载：

```bash
npm uninstall -g gsb-cli
```

## 2 分钟完成一个 GSB 任务

先指定平台地址：

```bash
export GSB_BASE_URL="https://<gsb-platform-url>"
```

检查平台是否可访问：

```bash
gsb-cli doctor
```

登录：

```bash
gsb-cli auth login \
  --username <user> \
  --password <password> \
  --json
```

如果用户确认没有账号，可以注册并自动保存 session。不要在登录失败后替用户静默注册新账号：

```bash
gsb-cli auth register \
  --username <user> \
  --password <password> \
  --json
```

如果不想把密码写进命令历史：

```bash
export GSB_PASSWORD="<password>"
gsb-cli auth login --username <user> --json
```

准备两个版本目录：

```text
baseline/
  item_0001.json
  item_0002.json

candidate/
  item_0001.json
  item_0002.json
```

检查并上传：

```bash
gsb-cli dataset check --a ./baseline --b ./candidate --json
gsb-cli dataset upload --a ./baseline --b ./candidate --json
```

同名数据集上传规则：

- 文件名和内容完全一致时，平台直接复用已有 dataset id，返回 `reused: true`。
- 同名但内容不同或只有部分文件重名时，默认停止上传，要求明确本次目的。
- 明确复用、覆盖、改名或强制新增时，使用 `--reuse`、`--replace`、`--new-name <name>` 或 `--force-new`。

一站式创建 GSB 任务：

```bash
gsb-cli task create-gsb \
  --name "candidate vs baseline" \
  --purpose "评估 candidate 相比 baseline 的回答质量和上线风险" \
  --a <dataset-a-id> \
  --b <dataset-b-id> \
  --description-file ./task_description.md \
  --json
```

`--purpose` 是给任务创建者和管理员回忆任务目的用的备注；`--description` 或 `--description-file` 是给评估者看的评估说明，两者不要混用。`--task-id` 通常可以省略，平台会根据任务名生成存储目录 id。

`task create-gsb` 会串联 `create → bind → setup → config → preflight`。确认无误后发布：

```bash
gsb-cli task publish <task-id> --json
```

如果希望创建后直接发布：

```bash
gsb-cli task create-gsb \
  --name "candidate vs baseline" \
  --purpose "评估 candidate 相比 baseline 的回答质量和上线风险" \
  --a <dataset-a-id> \
  --b <dataset-b-id> \
  --description-file ./task_description.md \
  --publish \
  --json
```

修改已有任务配置：

```bash
gsb-cli task configure <task-id> \
  --min-per-person auto \
  --require-comments false \
  --transparent-mode admin_only \
  --stats admin_only \
  --show-trace false \
  --json
```

关键配置项分布：

| 配置项 | 命令 | 说明 |
| --- | --- | --- |
| `--min-per-person` | `task create-gsb` / `task configure` | 每位评估者最少评估题数；默认 `auto`，即共同题数的 15%，最小 10，不能超过共同题数；`0` 表示全量 |
| `--anchor-count` | `task create-gsb` / `task configure` | 锚点题数量；默认 `auto`，即 `min_per_person` 的 10%，最小 3，不能超过可用题数 |
| `--description` / `--description-file` | `task create-gsb` / `task configure` | 给评估者看的任务说明 |
| `--transparent-mode` | `task create-gsb` / `task configure` | 版本名可见性，常用 `admin_only` |
| `--stats` | `task create-gsb` / `task configure` | 统计面板可见性，常用 `admin_only` |
| `--show-trace` | `task create-gsb` / `task configure` | 是否展示 trace，默认 `false` |
| `--require-comments` | `task create-gsb` / `task configure` | 是否强制评论必填，默认 `false` |

底层命令 `task create`、`task bind`、`task setup`、`task config` 仍可用于精细控制。Agent 常规使用应优先走 `task create-gsb` 和 `task configure`，避免漏配评论、透明模式、统计权限或 trace 展示。

导出结果：

```bash
gsb-cli results summary <task-id> --all --json
gsb-cli results export <task-id> --format json --output ./exports --json
```

如果本地已经生成 HTML 报告 / JSON 摘要，可以上传到任务归档；也可以查看和下载平台侧已有报告：

```bash
gsb-cli report upload <task-id> ./decision_report.html ./decision_summary.json --json
gsb-cli report status <task-id> --json
gsb-cli report download <task-id> --type html --output ./decision_report.html --json
gsb-cli report download <task-id> --type json --output ./decision_summary.json --json
```

`report upload` 会把本地 `.html` 和 `.json` 文本文件写入任务归档。上传需要当前账号有任务管理权限。

如果任务已经完成，也可以把任务归档：

```bash
gsb-cli task archive <task-id> --json
```

## 数据格式

每个版本是一个目录，每条 case 是目录第一层的一个 JSON 文件。

```text
version_a/
  q_0001.json
  q_0002.json

version_b/
  q_0001.json
  q_0002.json
```

规则：

- A/B 两边同一条 case 必须使用完全相同的文件名。
- 文件名去掉 `.json` 后就是 `query_id`。
- 只读取目录第一层的 `.json` 文件，不递归读取子目录。
- 每个 JSON 文件的顶层必须是 object。
- CSV、XLSX、JSONL、NDJSON、TSV 需要先转换成“一条 case 一个 JSON 文件”的目录结构。

最小 JSON 示例：

```json
{
  "query": "用户想买一台适合露营的便携咖啡机",
  "response": "推荐优先考虑手压式或胶囊式便携咖啡机..."
}
```

如果你的字段不是 `query` / `response`，可以上传任务级 `renderer.js`：

```bash
gsb-cli task renderer upload <task-id> ./renderer.js --json
```

## 常用命令

| 场景 | 命令 |
| --- | --- |
| 检查平台 | `gsb-cli doctor` |
| 检查 CLI 版本 | `gsb-cli version --check` |
| 查看 skill 安装 | `gsb-cli skill status --target all` |
| 手动安装 skill | `gsb-cli skill install --target codex --mode copy --force` |
| 登录 | `gsb-cli auth login --username <user> --password <password>` |
| 注册账号 | `gsb-cli auth register --username <user> --password <password>` |
| 查看当前用户 | `gsb-cli auth whoami` |
| 退出登录 | `gsb-cli auth logout` |
| 检查数据 | `gsb-cli dataset check --a ./baseline --b ./candidate` |
| 上传数据 | `gsb-cli dataset upload --a ./baseline --b ./candidate` |
| 查看数据集 | `gsb-cli dataset list` |
| 一站式创建任务 | `gsb-cli task create-gsb --name "candidate vs baseline" --purpose "评估 candidate 相比 baseline 的回答质量和上线风险" --a <dataset-a-id> --b <dataset-b-id>` |
| 查看任务状态 | `gsb-cli task get <task-id>` |
| 修改任务配置 | `gsb-cli task configure <task-id> --min-per-person auto --require-comments false --show-trace false` |
| 底层创建任务 | `gsb-cli task create --name "candidate vs baseline" --purpose "评估 candidate 相比 baseline 的回答质量和上线风险"` |
| 绑定数据 | `gsb-cli task bind <task-id> --a <dataset-a-id> --b <dataset-b-id>` |
| 底层配置任务 | `gsb-cli task setup <task-id> --min-per-person auto` |
| 底层配置权限/评论 | `gsb-cli task config <task-id> --transparent-mode admin_only --stats admin_only --show-trace false --require-comments false` |
| 发布前检查 | `gsb-cli task preflight <task-id>` |
| 发布任务 | `gsb-cli task publish <task-id>` |
| 归档任务 | `gsb-cli task archive <task-id>` |
| 上传 renderer | `gsb-cli task renderer upload <task-id> ./renderer.js` |
| 上传归档报告 | `gsb-cli report upload <task-id> ./decision_report.html ./decision_summary.json` |
| 查看归档报告 | `gsb-cli report status <task-id>` |
| 下载 HTML 报告 | `gsb-cli report download <task-id> --type html --output ./decision_report.html` |
| 下载 JSON 摘要 | `gsb-cli report download <task-id> --type json --output ./decision_summary.json` |
| 查看汇总 | `gsb-cli results summary <task-id> --all` |
| 导出结果 | `gsb-cli results export <task-id> --format json --output ./exports` |

## 全局参数

全局参数可以放在命令前，也可以放在命令后。

| 参数 | 说明 |
| --- | --- |
| `--base-url <url>` | GSB 平台地址。默认读取 `GSB_BASE_URL`，否则使用 `http://localhost:8888` |
| `--profile <name>` | 本地 session profile，默认 `default` |
| `--username <user>` | 可选；配合 `--password` 或 `GSB_PASSWORD` 自动登录 |
| `--password <password>` | 可选；自动登录密码，自动化场景建议用 `GSB_PASSWORD` |
| `--json` | 输出机器可解析 JSON |
| `--help` | 查看帮助 |
| `--version` | 查看版本 |

本地 session 默认保存到：

```text
~/.chatbuy_gsb_eval_cli/sessions.json
```

可以通过环境变量覆盖：

```bash
export GSB_CLI_SESSION="/path/to/sessions.json"
```

## 平台 workspace 映射

这些路径存在于 GSB 平台服务器侧，仅用于排障和理解 CLI 副作用。正常使用时不要绕过 CLI 直接修改。

| CLI 操作 | 平台 workspace 结果 |
| --- | --- |
| `dataset upload` | 复制 JSON 到 `workspace/uploads/<username>/<dataset-name>/`，并更新 `workspace/uploads/_meta.json` |
| `task create-gsb` | 依次执行创建任务、绑定数据快照、保存分配策略、保存 visibility，并运行发布前检查 |
| `task create` | 创建 `workspace/tasks/<task-id>/`，并更新任务注册表 |
| `task bind` | 写入 `workspace/tasks/<task-id>/data_a/`、`data_b/` 和版本映射 |
| `task setup` | 写入 `workspace/tasks/<task-id>/_config.json`，包含分配策略、锚点题、评估维度和 visibility |
| `task config` | 更新同一个 `_config.json` 中的 `visibility` |
| `task configure` | 按参数组合更新 `_config.json` 中的分配策略和 visibility，并运行发布前检查 |
| `task renderer upload` | 写入 `workspace/tasks/<task-id>/renderer.js` |
| `results export` | 在 `workspace/tasks/<task-id>/exports/` 生成导出文件 |
| `report upload` | 写入 `workspace/tasks/<task-id>/report/` |
| 评估者提交 | 写入 `workspace/tasks/<task-id>/rating_result/eval_<user>.json` |

## 结构化错误

CLI 失败时会尽量返回可修复的问题，而不是只给 HTTP 错误。

典型输出字段：

```json
{
  "ok": false,
  "issues": [
    {
      "code": "ZERO_COMMON_ITEMS",
      "problem": "A/B 版本没有同名 JSON 文件，评估任务会是 0 条",
      "evidence": {
        "count_a": 10,
        "count_b": 10,
        "common_count": 0
      },
      "next_step": "把同一条 case 在两个版本目录内保存为完全相同的文件名，例如 item_0001.json。"
    }
  ]
}
```

Agent 应优先读取 `issues[].next_step` 修复问题，再继续原流程。

## 常见问题

### `gsb-cli: command not found`

重新安装：

```bash
npm install -g https://github.com/GasonW/gsb-cli/archive/refs/heads/main.tar.gz
```

如果仍然不可用，检查 npm 全局 bin 目录是否在 `PATH` 里。

### `doctor` 提示平台不可访问

先确认平台 URL：

```bash
gsb-cli doctor --base-url https://<gsb-platform-url>
```

如果平台需要 VPN 或办公网络，先连接对应网络。

### 远端平台绑定本地路径失败

这是预期行为。远端服务器不能读取你电脑上的路径。

正确流程：

```bash
gsb-cli dataset upload --a ./baseline --b ./candidate --json
gsb-cli task bind <task-id> --a <dataset-a-id> --b <dataset-b-id> --json
```

只有当平台服务也运行在同一台机器上，并且能读到同一路径时，才适合直接绑定本地路径。

## 开发

只有在开发 CLI 本身时才需要 clone 仓库：

```bash
git clone https://github.com/GasonW/gsb-cli.git
cd gsb-cli
npm install
npm test
```

本地运行：

```bash
npm run build
node dist/src/index.js --help
```

项目运行时依赖为零，开发依赖主要是 TypeScript 和 Node 类型定义。测试使用 Node 内置 test runner。
