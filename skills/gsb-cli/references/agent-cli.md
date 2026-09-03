# gsb-cli 命令参考手册

本手册面向 Agent，覆盖 `gsb-cli` 所有命令的完整签名字段、JSON 输出约定和错误恢复模式。

## 全局约定

### 通用参数

| 参数 | 说明 |
|------|------|
| `--base-url <url>` | GSB 平台地址，默认 `https://chatbuy-eval-boe.bytedance.net`（可由 `GSB_BASE_URL` 覆盖） |
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

Session 保存在 `~/.chatbuy_gsb_eval_cli/sessions.json`，文件权限为 `0600`，只包含 session/CSRF cookie 和非秘密账号元数据，不包含密码。JS 后端的 Suda double-submit CSRF 由 CLI 自动处理；不要把 token 复制到命令行。旧 session 遇到明确的 CSRF 403 会自动获取新 token 并重试一次。平台 session 失效返回 401 时再重新 `auth login`。

环境变量方式（CI/自动化）：
```bash
export GSB_BASE_URL="https://chatbuy-eval-boe.bytedance.net"
export GSB_USERNAME="<user>"
export GSB_PASSWORD="<password>"
```

---

## 命令详解

### 1. 诊断与版本

```bash
gsb-cli doctor --json
```
检查平台可达性和当前 session 状态。返回 `reachable`、`auth`、`auth_protocol` 和当前用户信息；当前 JS 部署应报告 `suda-double-submit-csrf`。

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
gsb-cli dataset check --input ./input.jsonl --json
```

输入支持 `.json`、`.jsonl` 和 `.ndjson`。JSON 可使用顶层数组或 `records/items` 包装；返回 `row_count`、A/B 版本名和逐条 contract 问题。可选 `traceA/traceB` 会被校验并保留。

常见错误码：
- `INPUT_FILE_NOT_FOUND` — 文件不存在
- `INPUT_SUFFIX_REQUIRED` — 文件后缀不受支持
- `INPUT_PARSE_ERROR` — JSON 或 JSONL 解析失败
- `INPUT_REQUIRED_FIELD_INVALID` — 必填字段缺失或为空
- `INPUT_DUPLICATE_QUERY_ID` — queryId 重复
- `INPUT_HEADER_INCONSISTENT` — 任务名或版本名不一致
- `INPUT_TRACE_INVALID` — Trace 不是 JSON object 字符串数组

#### 上传数据集

```bash
gsb-cli dataset upload --input ./input.jsonl --name candidate-vs-baseline --json
```

返回 `uploaded[]` 数组，每个元素含 `id`、`name`、`format: "aidp-jsonl"`、`row_count` 和版本名。

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
  --input <jsonl-dataset-id-or-name> \
  --description-file ./task_description.md \
  --json
```

- `--name`：任务名称（给管理员看）
- `--purpose`：任务目的或备注（给创建者和管理员看，不是给评估者看的任务说明）
- `--input`：统一 JSONL 数据集 id 或名称
- 返回 `task.id` 和 `agent_summary`，后续命令均需此 ID
- 默认 `min_per_person` 为共同题数的 15%，最小 10；默认锚点题数量为 `min_per_person` 的 10%，最小 3；默认 `show_trace=false` 只控制评估作业页，不删除输入中的 Trace，也不控制 Review HTML

#### 创建三模型 Review 任务

```bash
gsb-cli task create \
  --name "model1 / model2 / model3 review" \
  --mode review \
  --purpose "并排检查三组回答的质量分" \
  --json
```

Review 输入是平台专用的 A/B/C JSONL（包含 `responseA`、`responseB`、`responseC`）。当前 CLI 可以创建、查询、预检和发布 Review 任务，但 `dataset upload` / `task bind` 仍是 A/B 合约；三模型文件请通过返回的 `urls.manage` 管理页上传，再执行 `gsb-cli task preflight <task-id> --json`。

Review 页面分别记录 A/B/C 的 `0/1/2/3` 绝对质量分和可选全局评论，不出现 GSB 胜负模块。

#### 绑定数据源

```bash
gsb-cli task bind <task-id> --input <jsonl-dataset-id-or-name> --json
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

三模型 Review 的 `datasets.versions` 和 `datasets.counts` 同时包含 `a/b/c`。
可选 `reviewPriority` 只在评估页作为重点 case 高亮与证据提示，不会影响
`task get` 的题数或评分结果。

### 4.1 平台持久化映射

当前 JS 后端把运行时状态持久化到 PostgreSQL。以下映射仅用于调试和排障，Agent 不应绕过 CLI 直接修改。

| CLI 操作 | PostgreSQL / 运行时结果 |
| --- | --- |
| `dataset upload` | 写入 dataset 与 dataset-file 表，返回稳定 dataset ID |
| `task create-gsb` | 创建 task、固化 task items、保存分配策略和 visibility，并运行 preflight |
| `task create` | 创建 task 记录；不创建服务器 JSON task 目录 |
| `task bind` | 固化 dataset 内容到 task items，并保存 dataset/版本映射 |
| `task setup/configure` | 更新 task 配置 JSONB、分配题目和 visibility |
| `task renderer upload` | 写入 task renderer 表 |
| `results export` | 从数据库即时生成导出文件并记录审计事件 |
| `report upload` | 写入 task report 表；`report status` 返回 `source: "database"` |
| 评估者提交 | 写入 evaluation、comment 和 review 相关表 |

完整 analysis run 仍保存在本地 canonical task 的 `report/runs/`，但线上报告发现以 PostgreSQL task report 记录为唯一来源；不要创建 workspace 级聚合页、report index 或 report archive。
同一业务评估也不得按 `aidp` / `chatbuy-eval` 建两个 task；平台差异只记录为同一 task 的执行元数据。

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

分析文件由 platform repository 的
`docs/analysis-specs/human-eval-case-review-workflow-spec.md` 所列脚本生成。本节只说明 CLI 的归档操作。

```bash
# 查看报告状态
gsb-cli report status <task-id> --json

# 获取报告 URL
gsb-cli report url <task-id> --json

# Review 页面生成后先归档，然后停止等待人工 Review
gsb-cli report upload <task-id> <review-report-path> <case-review-draft-path> --json

# 用户在后续对话中触发正式分析后归档最终产物，CQC 路径可选
gsb-cli report upload <task-id> <review-report-path> <report-path> <summary-path> [cqc-report-path] --json

# 下载报告
gsb-cli report download <task-id> --type html --output ./report.html --json

# 导出题目终判、评论采纳状态、作业反馈与按题目/Reviewer 的 Review 统计；只读，不启动页面或重算报告
gsb-cli report review <task-id> --output ./review-feedback.json --json
```

Review 从 `report status` 返回的 `urls.review` 启动。只有用户在后续对话中明确触发，才按 platform 主工作流生成最终分析报告，并按实际产物再次上传。

---

## 标准工作流

### 完整 GSB 评估流程

```bash
# 1. 检查环境
gsb-cli doctor --json
gsb-cli auth whoami --json

# 2. 检查并上传数据
gsb-cli dataset check --input ./input.jsonl --json
gsb-cli dataset upload --input ./input.jsonl --name candidate-vs-baseline --json

# 3. 创建并配置任务
gsb-cli task create-gsb --name "candidate vs baseline" --purpose "..." --input <jsonl-dataset-id> --description-file ./task_description.md --json
gsb-cli task get <task-id> --json

# 4. 发布
gsb-cli task publish <task-id> --json
# → 将返回的 urls.eval 发给评估者

# 5. 等待评估完成后回收结果
gsb-cli results export <task-id> --format json --output ./exports --json

# 6. 在 platform repository 按主工作流生成 Review 页面并单独上传，然后停止自动执行

# 7. 用户后续明确触发后生成并归档最终报告，CQC 需用户单独要求
gsb-cli report upload <task-id> <review-report-path> <report-path> <summary-path> [cqc-report-path] --json
gsb-cli report status <task-id> --json
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
