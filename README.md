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

从 GitHub 安装最新版：

```bash
npm install -g https://github.com/GasonW/gsb-cli/archive/refs/heads/main.tar.gz
```

验证：

```bash
gsb-cli --version
gsb-cli --help
```

一次性运行，不全局安装：

```bash
npx --yes https://github.com/GasonW/gsb-cli/archive/refs/heads/main.tar.gz --help
```

更新：

```bash
npm uninstall -g gsb-cli
npm install -g https://github.com/GasonW/gsb-cli/archive/refs/heads/main.tar.gz
```

卸载：

```bash
npm uninstall -g gsb-cli
```

> 说明：当前推荐使用 GitHub archive tarball 安装。这个方式已经验证可用，且不要求使用者本机安装 TypeScript 编译工具。

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

创建任务：

```bash
gsb-cli task create --name "candidate vs baseline" --json
```

把上一步返回的 `<task-id>`、`<dataset-a-id>`、`<dataset-b-id>` 填进去：

```bash
gsb-cli task bind <task-id> --a <dataset-a-id> --b <dataset-b-id> --json
gsb-cli task setup <task-id> --min-per-person 0 --json
gsb-cli task preflight <task-id> --json
gsb-cli task publish <task-id> --json
```

导出结果：

```bash
gsb-cli results summary <task-id> --all --json
gsb-cli results export <task-id> --format json --output ./exports --json
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
| 登录 | `gsb-cli auth login --username <user> --password <password>` |
| 查看当前用户 | `gsb-cli auth whoami` |
| 退出登录 | `gsb-cli auth logout` |
| 检查数据 | `gsb-cli dataset check --a ./baseline --b ./candidate` |
| 上传数据 | `gsb-cli dataset upload --a ./baseline --b ./candidate` |
| 查看数据集 | `gsb-cli dataset list` |
| 创建任务 | `gsb-cli task create --name "candidate vs baseline"` |
| 绑定数据 | `gsb-cli task bind <task-id> --a <dataset-a-id> --b <dataset-b-id>` |
| 配置任务 | `gsb-cli task setup <task-id> --min-per-person 0` |
| 发布前检查 | `gsb-cli task preflight <task-id>` |
| 发布任务 | `gsb-cli task publish <task-id>` |
| 上传 renderer | `gsb-cli task renderer upload <task-id> ./renderer.js` |
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
