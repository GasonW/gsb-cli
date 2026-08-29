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

NestJS/PostgreSQL 部署会对 API 启用 double-submit CSRF。CLI 会在登录前自动访问
`/login` 获取 `suda-csrf-token`，并在后续请求中同时携带同值 Cookie 和
`X-Suda-Csrf-Token` 请求头；不需要手工复制 token。旧 session 遇到 CSRF 403 时会自动
补取 token 并重试一次，未启用 CSRF 的旧 Python 部署仍可继续使用。

准备一份与 AIDP 相同格式的 A/B JSONL。一行就是一道题，至少包含
`taskName/queryId/query/versionAName/versionBName/responseA/responseB/productCardsA/productCardsB`。

```text
input.jsonl
```

检查并上传：

```bash
gsb-cli dataset check --input ./input.jsonl --json
gsb-cli dataset upload --input ./input.jsonl --name candidate-vs-baseline --json
```

历史任务仍可使用 `dataset check/upload --a <dir-a> --b <dir-b>` 和
`task bind --a <dataset-a> --b <dataset-b>`；新任务应使用单 JSONL，避免维护两种输入变体。

同名数据集上传规则：

- 文件名和内容完全一致时，平台直接复用已有 dataset id，返回 `reused: true`。
- 同名但内容不同或只有部分文件重名时，默认停止上传，要求明确本次目的。
- 明确复用、覆盖、改名或强制新增时，使用 `--reuse`、`--replace`、`--new-name <name>` 或 `--force-new`。

一站式创建 GSB 任务：

```bash
gsb-cli task create-gsb \
  --name "candidate vs baseline" \
  --purpose "评估 candidate 相比 baseline 的回答质量和上线风险" \
  --input <jsonl-dataset-id> \
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
  --input <jsonl-dataset-id> \
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

三模型 Review 可用 `gsb-cli task create --mode review` 创建，并可继续使用 `task get`、
`task preflight`、`task publish` 和结果导出。Review 的 A/B/C JSONL 当前需在命令返回的
`urls.manage` 页面上传；`dataset upload` 与 `task bind --input` 仍只校验 A/B AIDP 契约。
评估页对 A/B/C 三组 response 分别记录 `0/1/2/3` 绝对质量分和可选全局评论，不采集 GSB 胜负。
Review JSONL 可用 `reviewPriority` 标记重点 case：必须设置 `isPriority=true`，并在
`comparisons` 中提供 `track/candidate/baseline/candidateScore/baselineScore/overall`；
该字段只控制目录高亮和证据横幅，不改变本次 Review 分数。

导出结果：

```bash
gsb-cli results summary <task-id> --all --json
gsb-cli results export <task-id> --format json --output ./exports --json
```

结果中的评论按实际版本名组织。版本级全局评论位于 `comments[版本名].items`，每项包含 `feedback_type`、`comment`、`images` 等字段；`comments[版本名].pros` 和 `cons` 保留为按方向拼接的兼容文本。划线、卡片和全局评论共享 `anchored_comments` 存储，读取划线定位时应排除 `target_type: "global"` 的项。

分析生成和归档是两个独立步骤。在平台仓库根目录先生成不可覆盖的 analysis run：

```bash
python3 scripts/build_gsb_decision_report.py --task <task-id> --config <analysis-config.json> --no-publish
```

从命令 JSON 输出读取 `report` 和 `summary` 路径；确认后再上传归档。也可以查看和下载平台侧已有报告：

```bash
gsb-cli report upload <task-id> <report-path> <summary-path> --json
gsb-cli report status <task-id> --json
gsb-cli report download <task-id> --type html --output ./decision_report.html --json
gsb-cli report download <task-id> --type json --output ./decision_summary.json --json
```

`report upload` 会把本地 `.html` 和 `.json` 文本写入线上任务的 PostgreSQL report 记录。`gsb-decision-v2` 先在本地校验固定文件名、`source_analysis_run_id` 和 `../review/?q=` 相对题目链接。完整分析 run 仍保存在平台仓库的 `report/runs/<analysis-run-id>/`，只把当前确认的 `decision_report.html` 与 `decision_summary.json` 上传到线上。上传需要当前账号有任务管理权限。

`gsb-decision-v2` 的可见报告直接展示真实模型版本、总体 G/S/B 与双方胜率（排除 Same）、题目级 Pointwise 平均分/0 分率/`≥2` 分率，并把差异稳定性与数据可信度分开判断；题目范围与标注记录处理分开说明，原始评分记录分布仅保存在审计产物。报告不展示协议、run id、checksum，也不输出上线建议。

全量明细使用题目证据卡片，同时提供两个模型各自的 Pointwise 分数筛选，并支持相对 Baseline 高低、GSB“维度 → 结果”、文本和工具筛选；当前命中题数 / 全部题数只在模块标题显示一次。每张卡片可展开双版本完整回答、逐人评分与评论和双栏完成态 Trace。报告附件只提供原始跑测 Trace、原始标注结果和 Benchmark；平台下载会校验任务权限和文件白名单。

如果任务已经完成，也可以把任务归档：

```bash
gsb-cli task archive <task-id> --json
```

## 数据格式

标准输入是一份 AIDP-compatible JSONL，每行同时包含同一道题的 A/B 数据。

```text
input.jsonl
```

规则：

- 每个非空行是 JSON object。
- `queryId` 在文件内唯一。
- `taskName`、`versionAName`、`versionBName` 在所有行中一致。
- `productCardsA/productCardsB` 是 JSON 字符串数组；无商品卡时为 `[]`。
- CSV、XLSX、非标准 JSONL、NDJSON、TSV 需要先转换成统一 JSONL contract。

最小 JSONL 行示例：

```json
{
  "taskName": "candidate vs baseline",
  "queryId": "q_0001",
  "query": "用户想买一台适合露营的便携咖啡机",
  "versionAName": "baseline",
  "versionBName": "candidate",
  "responseA": "版本 A 回复",
  "responseB": "版本 B 回复",
  "productCardsA": [],
  "productCardsB": []
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
| 检查数据 | `gsb-cli dataset check --input ./input.jsonl` |
| 上传数据 | `gsb-cli dataset upload --input ./input.jsonl` |
| 查看数据集 | `gsb-cli dataset list` |
| 一站式创建任务 | `gsb-cli task create-gsb --name "candidate vs baseline" --purpose "评估 candidate 相比 baseline 的回答质量和上线风险" --input <jsonl-dataset-id>` |
| 查看任务状态 | `gsb-cli task get <task-id>` |
| 修改任务配置 | `gsb-cli task configure <task-id> --min-per-person auto --require-comments false --show-trace false` |
| 底层创建任务 | `gsb-cli task create --name "candidate vs baseline" --purpose "评估 candidate 相比 baseline 的回答质量和上线风险"` |
| 绑定数据 | `gsb-cli task bind <task-id> --input <jsonl-dataset-id>` |
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
| `--base-url <url>` | GSB 平台地址。默认读取 `GSB_BASE_URL`，否则使用 `https://chatbuy-eval-boe.bytedance.net` |
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

每个 profile 保存平台地址、session cookie 和平台需要的 CSRF cookie；文件始终以 `0600`
权限原子更新，不保存密码。

可以通过环境变量覆盖：

```bash
export GSB_CLI_SESSION="/path/to/sessions.json"
```

## 平台持久化映射

当前 JS 后端将运行时状态持久化到 PostgreSQL。下表用于理解 CLI 的平台侧副作用；本地
`workspace/` 中的 benchmark、model run、annotation set 和 analysis run 仍是可复用数据与分析产物，
但不是线上 session、任务状态或标注结果的运行时数据库。

| CLI 操作 | PostgreSQL / 运行时结果 |
| --- | --- |
| `auth login` | 创建数据库 session；本机只保存 session/CSRF cookie，不保存密码 |
| `dataset upload` | 写入 dataset 与 dataset-file 表，返回稳定 dataset ID |
| `task create-gsb` | 创建 task，绑定 dataset 快照到 task items，保存分配/visibility 配置并执行 preflight |
| `task create` | 创建数据库 task 记录；不创建服务器 JSON task 目录 |
| `task bind` | 把 dataset 内容固化到 task items，并保存版本与 dataset 引用 |
| `task setup/config/configure` | 更新 task 配置 JSONB、分配题目和可见性设置 |
| `task renderer upload` | 写入 task renderer 表 |
| `results export` | 从数据库即时生成下载文件并记录审计事件 |
| `report upload` | 写入 task report 表；`report status` 返回 `source: "database"` |
| 评估者提交 | 写入 evaluation、comment 和 review 相关表 |

## 结构化错误

CLI 失败时会尽量返回可修复的问题，而不是只给 HTTP 错误。

典型输出字段：

```json
{
  "ok": false,
  "issues": [
    {
      "code": "JSONL_DUPLICATE_QUERY_ID",
      "problem": "queryId 重复：item_0001",
      "evidence": {
        "line": 11,
        "query_id": "item_0001"
      },
      "next_step": "保证 queryId 在文件内唯一。"
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
gsb-cli dataset upload --input ./input.jsonl --json
gsb-cli task bind <task-id> --input <jsonl-dataset-id> --json
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
