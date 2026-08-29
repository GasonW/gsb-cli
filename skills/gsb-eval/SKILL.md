---
name: gsb-eval
description: GSB A/B 评估平台操作手册。创建评估任务、上传数据集、回收标注结果、分析评估数据、生成决策报告和 case 分析。通过 gsb-cli 命令行工具操作平台 HTTP API。
---

# GSB Eval Platform

## 最简路径

```bash
gsb-cli auth login --username <user> --password <pass> --json
gsb-cli dataset check --input ./input.jsonl --json
gsb-cli dataset upload --input ./input.jsonl --name candidate-vs-baseline --json
gsb-cli task create-gsb --name "candidate vs baseline" --purpose "评估目的" --input <jsonl-dataset-id> --description-file ./task_description.md --json
gsb-cli task publish <task-id> --json
# → 将返回的 urls.eval 发给评估者
# → 评估完成后：
gsb-cli results export <task-id> --format json --output ./exports --json
# → 生成不可覆盖的分析 run；从 JSON 输出读取 report 和 summary 路径
python3 scripts/build_gsb_decision_report.py --task <task-id> --config ./analysis_config.json --no-publish
# → 确认分析结果后再归档
gsb-cli report upload <task-id> <report-path> <summary-path> --json
```

每步优先读取返回中的 `next_commands`。出错的按 `issues[].next_step` 修复后用 `continue_after_fix.command` 继续。

## Skill 安装

如果 skill 尚未安装，在仓库根目录运行：

```bash
gsb-cli skill install --target codex --mode symlink
```

npm 安装 `gsb-cli` 时会在 `postinstall` 阶段自动安装。环境变量 `GSB_CLI_SKIP_SKILL_INSTALL=1` 可跳过。详见 `gsb-cli skill install --help`。

## 触发后的快速决策

- 用户要"创建/发布 GSB 任务"：走任务工作流。
- 用户要"三模型 Review"：用 `task create --mode review` 创建；从返回的 `urls.manage` 上传 A/B/C Review JSONL，再执行 preflight/publish。当前 CLI dataset/bind 仍只支持 A/B AIDP 输入，不要误称已支持 Review 文件上传。
- 三模型 Review 对每组 response 记录 `0/1/2/3` 绝对质量分和可选全局评论；不要要求或推断 GSB 胜负。
- 需要高亮重点 case 时，在 Review JSONL 行中使用 `reviewPriority.isPriority=true` 和非空 `comparisons`；这些历史评分只用于目录/证据提示，不当作当前 Review 结果。
- 用户给了符合 AIDP contract 的 JSONL：直接检查并上传；CSV/XLSX 或其他 JSONL 才需要先转换。
- 用户要"分析结果/生成报告"：先回收结果，完整读取[分析协议](references/analysis.md)和[决策报告模板](references/decision-report.md)，生成分析文件；用户确认或任务要求归档时，再单独上传。
- 用户要"为什么赢/输、根因、bad case/good case、标注噪声、Regression"：生成统计 run 后，必须完整读取并执行[语义分析协议](references/semantic-analysis.md)，通过结构化审核产物生成语义结论；不得凭评分、评论关键词或 Agent 直觉直接写原因。

## 认证

优先使用已有账号登录，不要默认替用户注册：

```bash
gsb-cli auth login --base-url <platform-url> --username <user> --password <password> --json
gsb-cli auth whoami --json
```

只有用户明确表示没有账号时才注册：

```bash
gsb-cli auth register --base-url <platform-url> --username <user> --password <password> --json
```

平台地址默认 `https://chatbuy-eval-boe.bytedance.net`，可通过 `GSB_BASE_URL` 环境变量或 `--base-url` 指定。Session 保存在 `~/.chatbuy_gsb_eval_cli/sessions.json`。JS 后端的 Suda double-submit CSRF 由 CLI 自动预取、保存和携带；不要手工复制 cookie/token。旧 session 遇到明确的 CSRF 403 会自动补取 token 并重试一次。

## 数据格式与上传

平台标准输入与 AIDP 一致：一个 JSONL，一行同时包含一道题的 A/B 数据：

```text
input.jsonl
```

每行必填 `taskName`、`queryId`、`query`、`versionAName`、`versionBName`、
`responseA`、`responseB`、`productCardsA`、`productCardsB`。`queryId` 唯一；任务名和版本名在文件内一致。

```bash
gsb-cli dataset check --input ./input.jsonl --json
gsb-cli dataset upload --input ./input.jsonl --name candidate-vs-baseline --json
gsb-cli dataset list --json
gsb-cli dataset guide --json
```

先跑 `dataset check`。如果返回 `JSONL_*` 错误，按 `next_step` 修数据后再上传。旧双目录命令只用于历史兼容。

一个业务评估只能创建一个 task。task ID 和目录不得按执行平台拆成 `-aidp` / `-chatbuy-eval`
两份，也不得创建 `aidp/`、`input/`、`data_a/`、`data_b/` 适配目录。本地 canonical task
只保留一个 `input.jsonl`；线上 JS 后端把它绑定为同一 task 的 PostgreSQL item 快照。AIDP 与
ChatBuy Eval 的执行信息属于同一 task 的元数据。

同名数据集上传规则：100% 重复直接复用（`reused: true`）。同名但内容不同时默认失败，按提示使用 `--reuse`、`--replace`、`--new-name <name>` 或 `--force-new`。

详细数据格式约束见 `references/data-format.md`。

## 创建、配置和发布任务

```bash
gsb-cli task create-gsb \
  --name "candidate vs baseline" \
  --purpose "评估 candidate 相比 baseline 的质量和上线风险" \
  --input <jsonl-dataset-id-or-name> \
  --description-file ./task_description.md \
  --json

gsb-cli task get <task-id> --json
gsb-cli task publish <task-id> --json
```

关键配置项：`--min-per-person`（默认共同题数的 15%，最小 10）、`--require-comments`、`--transparent-mode`、`--stats`、`--show-trace`。详见 `references/agent-cli.md`。

- `task get` 返回的 `agent_summary` 是面向 Agent 的状态视图，重点读取 `state`、`next_command`、`datasets.counts`、`readiness`。
- `task create --purpose` 是给创建者的备注；`task configure --description-file` 是给评估者看的说明，不要混用。
- `task publish` 自动先跑 preflight。失败按返回的 failures 修复后再发布。
- 发布成功后 CLI 返回 `urls.eval`，直接发给评估者。

## 自定义 Renderer

当默认 renderer 展示为空或需要自定义渲染时：

```bash
gsb-cli task renderer status <task-id> --json
gsb-cli task renderer upload <task-id> ./renderer.js --json
gsb-cli task renderer clear <task-id> --json
```

`renderer.js` 应定义全局 `renderPanel(data, ...)`。上传后重新跑 `task preflight`。

## 回收结果

```bash
gsb-cli results summary <task-id> --all --json
gsb-cli results export <task-id> --format json --output ./exports --json
gsb-cli results export <task-id> --format csv --output ./exports/results.csv --json
```

启用了管理员审核时，分析优先使用已接受结果。

## 分析方法

- [分析协议](references/analysis.md)定义取数、清洗、聚合、统计、置信度和证据边界。
- [决策报告模板](references/decision-report.md)定义报告结构、字段、交互和展示规则。
- [语义分析协议](references/semantic-analysis.md)定义根因、Case、标注噪声和 Regression 的 LLM 审核方法，仅在需要这些结论时读取。

以上 reference 是分析逻辑的唯一来源。Agent 不得在 SKILL、临时代码或写报告时另定分析单位、纳排规则、人员权重、冲突等级、Pairwise 编码、Bootstrap 单位、语义证据门槛或报告模块。只有用户明确要求修改方法时，才能按[分析协议](references/analysis.md)的覆盖规则创建新 run 并记录 `method_overrides`。

## 生成分析文件

`scripts/build_gsb_decision_report.py` 是 Agent 唯一可直接调用的统计分析入口。它内部加载平台分析实现包；不得直接调用或按单次任务改写内部包。

```bash
python3 scripts/build_gsb_decision_report.py \
  --task <task-id> \
  --config <analysis-config.json> \
  --no-publish
```

命令输出 JSON，包含 `run_id`、`run_dir`、`report` 和 `summary`。分析文件只写入新的 `report/runs/<analysis-run-id>/`，不会更新 task `report/` 根目录。

### 需要语义分析时

1. 完整读取[语义分析协议](references/semantic-analysis.md)。
2. 使用统计 run 中的完整题目证据执行全量双回答换位盲审和人工证据审核；产物必须满足对应 schema 的 `N / 2N / N` 覆盖要求。
3. 将 `agent-blind-review.jsonl`、`agent-semantic-audit.jsonl` 和专项分析文件保存到同一 analysis run。只有这些结构化产物通过校验后，才能输出根因、能力簇、标注噪声或 Regression 结论；否则只保留统计报告和原始证据。

## 归档分析文件

用户确认归档后，使用生成命令返回的 `report` 和 `summary` 路径上传：

```bash
gsb-cli report upload <task-id> <report-path> <summary-path> --json
gsb-cli report status <task-id> --json
```

上传接口只接受 `decision_report.html` 和 `decision_summary.json`。上传前校验 summary 与 HTML 中的 `../review/?q=` 相对链接；上传后必须执行 `report status` 回读。成功返回的 `urls.report` 是平台内报告地址。

## 参考文件

按需读取，不要一次性加载全部：

- `references/agent-cli.md`：`gsb-cli` 完整命令说明和错误码速查。
- `references/analysis.md`：Pointwise + Pairwise、多标注人员/质检、冲突、统计与置信度。
- `references/decision-report.md`：默认决策报告结构、全量明细和交互协议。
- `references/semantic-analysis.md`：需要原因、Case、噪声或 Regression 结论时强制执行的双回答换位盲审、评论证据审核、最终裁决和产物协议。
- `references/schemas/agent-blind-review-v1.schema.json`、`references/schemas/agent-semantic-audit-v1.schema.json`：LLM 语义分析逐题 JSONL 的固定输出契约。
- `references/data-format.md`：输入数据格式和目录约束。
- `references/anchor-design.md`：锚点题设计与一致性诊断。
