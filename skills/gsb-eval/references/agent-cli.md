# gsb-cli 命令参考手册

本手册面向 Agent，覆盖 `gsb-cli` 所有命令的完整签名字段、JSON 输出约定和错误恢复模式。

## 全局约定

### 通用参数

| 参数 | 说明 |
|------|------|
| `--base-url <url>` | GSB 平台地址，默认 `GSB_BASE_URL` 或 `http://localhost:8888` |
| `--profile <name>` | Session 配置文件，默认 `default` |
| `--username <user>` | 自动登录用户名（自动化场景） |
| `--password <pass>` | 自动登录密码，优先用 `GSB_PASSWORD` 环境变量 |
| `--json` | 输出机器可读 JSON，**Agent 场景必须加** |
| `--help` | 显示帮助 |
| `--version` | 显示版本 |

### JSON 输出格式

所有 `--json` 输出均为顶层 object，包含：

```json
{
  "ok": true,
  "message": "操作结果简述",
  "issues": [
    {
      "code": "ERROR_CODE",
      "severity": "error | warning | info",
      "status": "fail | warn | info",
      "problem": "问题简述",
      "evidence": {},
      "why": "为什么发生",
      "next_step": "如何修复",
      "continue_after_fix": {
        "command": "修复后继续执行的命令",
        "intent": "此命令的目的",
        "precondition": "执行此命令前需满足的条件"
      }
    }
  ]
}
```

**关键原则**：
- `ok: false` 时必含 `issues[]`，按 `next_step` 修复后用 `continue_after_fix.command` 继续。
- 不要跳过 `issues[]` 直接重试，先读问题、再修复、再继续。
- `severity: "error"` 是阻塞性的，必须修复；`severity: "warning"` 可以判断后继续。

### Session 管理

Session 保存在 `~/.chatbuy_gsb_eval_cli/sessions.json`。平台重启后 token 失效会返回 401，重新 `auth login` 即可。

环境变量方式（CI/自动化）：
```bash
export GSB_BASE_URL="https://<platform-url>"
export GSB_USERNAME="<user>"
export GSB_PASSWORD="<password>"
```

---

## 命令详解

### 1. 诊断与版本

```bash
gsb-cli doctor --json
```
检查平台可达性和当前 session 状态。返回 `reachable`、`auth` 状态和当前用户信息。

```bash
gsb-cli version --check --json
```
检查 CLI 是否有新版本。返回 `update.available` 和 `update.update_command`。

---

### 2. 认证

```bash
gsb-cli auth login --username <user> --password <pass> --json
gsb-cli auth register --username <user> --password <pass> --json
gsb-cli auth whoami --json
gsb-cli auth logout --json
```

优先使用 `auth login`。只有用户明确表示没有账号或要求创建账号时，才运行 `auth register`；不要在登录失败后自动注册新账号。

`whoami` 返回当前登录用户信息，可用于验证 session 有效性。常见错误码：`AUTH_CREDENTIALS_REQUIRED_OR_INVALID`、`AUTH_REGISTER_FAILED`、`PASSWORD_CHANGE_REQUIRED`。

---

### 3. 数据集

#### 检查数据

```bash
# 方式1：单目录（需包含两个版本子目录）
gsb-cli dataset check <dir> --json

# 方式2：分别指定 A/B 目录
gsb-cli dataset check --a ./data/baseline --b ./data/candidate --json

# 方式3：指定根目录和子目录名
gsb-cli dataset check --root ./data --version-a baseline --version-b candidate --json
```

默认返回每侧 summary 和 pair 的 `common_count`；需要逐文件列表时加 `--verbose`。

常见错误码：
- `DATASET_DIR_NOT_FOUND` — 目录不存在
- `NO_JSON_FILES` — 目录中没有 JSON 文件
- `JSON_PARSE_ERROR` — JSON 解析失败
- `JSON_ROOT_NOT_OBJECT` — JSON 顶层不是 object
- `ZERO_COMMON_ITEMS` — A/B 两侧没有同名文件

#### 上传数据集

```bash
# 单版本上传
gsb-cli dataset upload ./data/baseline --name baseline --json

# 双版本上传
gsb-cli dataset upload --a ./data/baseline --b ./data/candidate --name-a baseline --name-b candidate --json
```

返回 `uploaded[]` 数组，每个元素含 `id`、`name`、`json_count`。

同名上传语义：

- 100% 重复：直接复用已有 dataset id，返回 `reused: true`。
- 同名但内容不同：默认失败，返回 `DATASET_NAME_CONFLICT` 或 `DATASET_REUSE_NOT_EXACT_MATCH`。
- 用户明确目的后，使用 `--reuse`、`--replace`、`--new-name <name>` 或 `--force-new`。

#### 列出数据集

```bash
gsb-cli dataset list --json
```
返回 `datasets.my`（本人上传）和 `datasets.others`（他人上传）。

#### 格式指引

```bash
gsb-cli dataset guide --json
```
返回 `format_guidance`，说明平台期望的 JSON 数据结构。

---

### 4. 任务管理

#### 创建任务

```bash
gsb-cli task create-gsb \
  --name "candidate vs baseline" \
  --purpose "评估 candidate 相比 baseline 的质量和上线风险" \
  --a <dataset-a-id-or-name> \
  --b <dataset-b-id-or-name> \
  --description-file ./task_description.md \
  --json
```

- `--name`：任务名称（给管理员看）
- `--purpose`：任务目的或备注（给创建者和管理员看，不是给评估者看的任务说明）
- `--a` / `--b`：数据集 id 或名称
- 返回 `task.id` 和 `agent_summary`，后续命令均需此 ID
- 默认 `min_per_person` 为共同题数的 15%，最小 10；默认锚点题数量为 `min_per_person` 的 10%，最小 3；默认 `show_trace=false`

#### 绑定数据源

```bash
gsb-cli task bind <task-id> --a <dataset-a-id-or-name> --b <dataset-b-id-or-name> --json
```

可用数据集 ID 或名称引用。常见错误：`DATASET_REF_NOT_FOUND`、`ZERO_COMMON_ITEMS_AFTER_BIND`。

#### 配置任务

```bash
gsb-cli task configure <task-id> \
  --min-per-person auto \
  --require-comments false \
  --transparent-mode admin_only \
  --stats admin_only \
  --show-trace false \
  --json
```

- `--min-per-person auto`：共同题数的 15%，最小 10，不能超过共同题数；传 `0` 表示全量
- `--anchor-count auto`：`min_per_person` 的 10%，最小 3，不能超过可用题数
- `--description-file`：评估说明 markdown 文件
- `--show-trace`：默认 `false`

`task configure` 会按参数组合保存分配策略和 visibility，并运行 preflight。底层 `task setup` / `task config` 只在需要精细拆步时使用。

```bash
gsb-cli task config <task-id> \
  --transparent-mode admin_only \
  --stats admin_only \
  --show-trace false \
  --require-comments false \
  --json
```

配置项说明：
- `--transparent-mode`：版本名可见性，常用 `admin_only`
- `--stats`：统计面板权限
- `--show-trace`：是否展示 trace 信息
- `--require-comments`：是否强制要求评论

`task get <task-id> --json` 返回 Agent 状态视图，重点读取 `agent_summary.state`、`agent_summary.next_command`、`datasets.counts`、`setup`、`visibility` 和 `readiness`。

### 4.1 Workspace 映射

这些是平台侧结果位置，仅用于调试和排障。Agent 不应绕过 CLI 直接修改。

| CLI 操作 | 平台 workspace 结果 |
| --- | --- |
| `dataset upload` | `workspace/uploads/<username>/<dataset-name>/` + `workspace/uploads/_meta.json` |
| `task create-gsb` | 创建任务、绑定数据快照、写入分配策略和 visibility，并运行 preflight |
| `task create` | `workspace/tasks/<task-id>/` + 任务注册表 |
| `task bind` | `workspace/tasks/<task-id>/data_a/`、`data_b/` 和版本映射 |
| `task setup` | `workspace/tasks/<task-id>/_config.json` |
| `task configure` | 更新 `workspace/tasks/<task-id>/_config.json` 中的分配策略和 visibility |
| `task renderer upload` | `workspace/tasks/<task-id>/renderer.js` |
| `results export` | `workspace/tasks/<task-id>/exports/` |
| `report upload` | `workspace/tasks/<task-id>/report/` |
| 评估者提交 | `workspace/tasks/<task-id>/rating_result/eval_<user>.json` |

#### 发布前检查

```bash
gsb-cli task preflight <task-id> --json
```

返回 `preflight.checks[]` 和 `preflight.failures[]`。阻塞性 failure 必须先修复再发布。

#### 发布任务

```bash
gsb-cli task publish <task-id> --json
```

自动先跑 preflight。发布成功后返回 `urls.eval`（评估页面地址），直接发给评估者。

#### 归档任务

```bash
gsb-cli task archive <task-id> --json
```

#### 查看任务

```bash
gsb-cli task get <task-id> --json
```

---

### 5. Renderer 管理

```bash
gsb-cli task renderer status <task-id> --json
gsb-cli task renderer upload <task-id> ./renderer.js --json
gsb-cli task renderer clear <task-id> --json
```

当默认 renderer 展示为空或需要自定义渲染时使用。`renderer.js` 应定义 `renderPanel(data, ...)` 函数。

常见错误：`DEFAULT_RENDERER_IN_USE`（提示可能需要自定义 renderer）、`CUSTOM_RENDERER_LIKELY_REQUIRED`。

---

### 6. 结果回收

```bash
# 查看评估进度和汇总
gsb-cli results summary <task-id> --all --json

# 导出结果
gsb-cli results export <task-id> --format json --output ./exports --json
gsb-cli results export <task-id> --format csv --output ./exports/results.csv --json
gsb-cli results export <task-id> --format zip --output ./exports --json
```

---

### 7. 报告管理

```bash
# 查看报告状态
gsb-cli report status <task-id> --json

# 获取报告 URL
gsb-cli report url <task-id> --json

# 上传报告（必须成对传入 .html 和 .json）
gsb-cli report upload <task-id> ./decision_report.html ./decision_summary.json --json

# 下载报告
gsb-cli report download <task-id> --type html --output ./report.html --json
```

---

## 标准工作流

### 完整 GSB 评估流程

```bash
# 1. 检查环境
gsb-cli doctor --json
gsb-cli auth whoami --json

# 2. 检查并上传数据
gsb-cli dataset check --a ./data/baseline --b ./data/candidate --json
gsb-cli dataset upload --a ./data/baseline --b ./data/candidate --name-a baseline --name-b candidate --json

# 3. 创建并配置任务
gsb-cli task create-gsb --name "candidate vs baseline" --purpose "..." --a baseline --b candidate --description-file ./task_description.md --json
gsb-cli task get <task-id> --json

# 4. 发布
gsb-cli task publish <task-id> --json
# → 将返回的 urls.eval 发给评估者

# 5. 等待评估完成后回收结果
gsb-cli results export <task-id> --format json --output ./exports --json

# 6. 分析并生成报告（使用 analysis.md 方法论）
# → 生成 decision_report.html + decision_summary.json

# 7. 归档报告
gsb-cli report upload <task-id> ./decision_report.html ./decision_summary.json --json
```

---

## 常见错误码速查

| 错误码 | 含义 | 修复方向 |
|--------|------|---------|
| `AUTH_INVALID_CREDENTIALS` | 用户名或密码错误 | 核对凭据后重新 `auth login` |
| `PASSWORD_CHANGE_REQUIRED` | 需要修改密码 | 通过平台 Web 页面修改密码 |
| `PLATFORM_UNREACHABLE` | 平台不可达 | 检查网络和 `--base-url` |
| `PLATFORM_API_INCOMPATIBLE` | API 不兼容 | 检查平台版本和 CLI 版本是否匹配 |
| `DATASET_DIR_NOT_FOUND` | 数据目录不存在 | 确认路径正确 |
| `NO_JSON_FILES` | 目录中没有 JSON 文件 | 检查数据格式 |
| `JSON_PARSE_ERROR` | JSON 解析失败 | 修复 JSON 语法错误 |
| `JSON_ROOT_NOT_OBJECT` | JSON 顶层不是 object | 确保每个 JSON 文件的顶层是 `{}` |
| `ZERO_COMMON_ITEMS` | A/B 两侧没有同名文件 | 检查文件名是否对齐 |
| `UNMATCHED_JSON_IGNORED` | 部分文件只在单侧存在 | 确认是否需要补充缺失文件 |
| `DATASET_NAME_CONFLICT` | 同名数据集存在但内容不同 | 询问用户后选择复用、覆盖、改名或强制新增 |
| `DATASET_REUSE_NOT_EXACT_MATCH` | 请求复用但内容不是 100% 一致 | 不要复用，确认是否覆盖或改名上传 |
| `DATA_SOURCE_NOT_BOUND` | 任务未绑定数据源 | 执行 `task bind` |
| `SETUP_MISSING` | 任务未完成配置 | 执行 `task configure` |
| `DEFAULT_RENDERER_IN_USE` | 使用默认 renderer | 如展示为空，上传自定义 renderer |
| `EXPORT_TIMEOUT` | 导出超时 | 检查数据量，重试或分批导出 |

所有错误的修复命令均从 `continue_after_fix.command` 字段获取，不需要推测。
