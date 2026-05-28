---
name: gsb-eval
description: GSB A/B 评估平台操作手册。创建评估任务、上传数据集、回收标注结果、分析评估数据、生成决策报告和 case 分析。通过 gsb-cli 命令行工具操作平台 HTTP API。
version: 0.1.5
---

# GSB Eval Platform

## 最简路径

```bash
gsb-cli auth login --username <user> --password <pass> --json
gsb-cli dataset check --a ./baseline --b ./candidate --json
gsb-cli dataset upload --a ./baseline --b ./candidate --name-a baseline --name-b candidate --json
gsb-cli task create-gsb --name "candidate vs baseline" --purpose "评估目的" --a baseline --b candidate --description-file ./task_description.md --json
gsb-cli task publish <task-id> --json
# → 将返回的 urls.eval 发给评估者
# → 评估完成后：
gsb-cli results export <task-id> --format json --output ./exports --json
# → 分析结果（按 L0→L4 框架）并生成报告
gsb-cli report upload <task-id> ./decision_report.html ./decision_summary.json --json
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
- 用户给了 CSV/XLSX/JSONL：先转换成平台数据目录格式再上传。
- 用户要"分析结果/生成报告/上线建议"：先回收结果，再按分析框架生成报告，最后上传归档。
- 用户要"bad case/good case 分析"：优先做问题簇/能力簇归纳，不要只罗列 case。

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

平台地址默认 `http://localhost:8888`，可通过 `GSB_BASE_URL` 环境变量或 `--base-url` 指定。Session 保存在 `~/.chatbuy_gsb_eval_cli/sessions.json`。平台重启后 401 需重新登录。

## 数据格式与上传

平台标准输入是两个版本目录，每个 `.json` 文件代表一条 case：

```text
data/
├── baseline/
│   ├── Q_0001.json
│   └── Q_0002.json
└── candidate/
    ├── Q_0001.json
    └── Q_0002.json
```

约束：JSON 顶层必须是 object。A/B 两个目录用同名文件对齐 query id。非 JSON 文件和只在单侧存在的文件会被忽略。

```bash
gsb-cli dataset check --a ./data/baseline --b ./data/candidate --json
gsb-cli dataset upload --a ./data/baseline --b ./data/candidate --name-a baseline --name-b candidate --json
gsb-cli dataset list --json
gsb-cli dataset guide --json
```

先跑 `dataset check`。如果返回 `ZERO_COMMON_ITEMS`、`NO_JSON_FILES` 等错误，按 `next_step` 修数据后再上传。

同名数据集上传规则：100% 重复直接复用（`reused: true`）。同名但内容不同时默认失败，按提示使用 `--reuse`、`--replace`、`--new-name <name>` 或 `--force-new`。

详细数据格式约束见 `references/data-format.md`。

## 创建、配置和发布任务

```bash
gsb-cli task create-gsb \
  --name "candidate vs baseline" \
  --purpose "评估 candidate 相比 baseline 的质量和上线风险" \
  --a <dataset-a-id-or-name> \
  --b <dataset-b-id-or-name> \
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

## 生成并归档 Report

生成 GSB Decision Report v1 并上传归档：

```bash
gsb-cli report upload <task-id> ./decision_report.html ./decision_summary.json --json
gsb-cli report status <task-id> --json
```

上传接口只接受 `.html` 和 `.json`。成功返回的 `urls.report` 是平台内可访问的报告地址。

## 分析框架

从"数据是否可信"到"是否值得上线"逐层推进：

| 层次 | 内容 | 核心问题 |
| --- | --- | --- |
| L0 数据质量 | 锚点题、快答、位置偏好、样本量分层、审核状态 | 数据可信吗？噪声是否影响结论？ |
| L1 总体胜负 | `winner`、`magnitude`、`quality_rating` 统计 | 候选版本整体赢了吗？赢多少？ |
| L2 显著性 | 二项检验、Bootstrap CI、敏感性分析 | 提升是否稳健，还是随机波动？ |
| L3 细粒度拆分 | 题型、评估者、query/case、结构指标 | 哪些场景提升，哪些场景退步？ |
| L4 根因归纳 | 评论分类、双版本回复对照、问题簇/能力簇 | 为什么赢/输，下一步怎么改？ |

关键原则：

- v2 结果中 `winner` 已是实际版本名或 `"similar"`，不要再做 left/right 映射。
- `magnitude` 表示显著/略好/相似；`quality_rating` 表示绝对质量。
- `similar + below` 是两版共同低质，不等于 baseline 胜出。
- 主结论按题目聚合而非只按评次聚合；用 `much_better=2`、`slightly_better=1`、`similar=0` 做方向分数。
- 评论按版本名读取（`comments["candidate"].pros`），不要按左右面板读取。
- 结构指标只能解释回答形态，不能单独证明质量好坏。
- 样本少的评估者不自动视为低质；只有快答、锚点不一致、极端位置偏好等多信号叠加时才降权或标注风险。
- 锚点题只用于评估者一致性和分群诊断，不作为模型胜负的直接证据。

推荐报告结构：

```text
1. 一句话结论与上线建议
2. 数据清洗与样本范围
3. 核心结果 + 题型拆分
4. 胜负原因总览
5. 候选版本高共识胜出 case
6. 候选版本高共识失利 case
7. 两版都不好 / 低于预期 case
8. 结构指标拆分
9. 锚点题一致性检查（如有）
10. 评估者画像
```

## Case 分析写法

- 先归并问题簇或能力簇，再展开代表性 case。
- 每个 case 至少包含评论、候选版本片段、baseline 片段、具体问题定位和改进动作。
- 不只看输赢，也看是否能 drive 优化。
- 多个题型指向同一根因时合并讲。
- good case 要分析可迁移能力；bad case 要给可执行修复建议和 regression 覆盖建议。

## 参考文件

按需读取，不要一次性加载全部：

- `references/agent-cli.md`：`gsb-cli` 完整命令说明和错误码速查。
- `references/analysis.md`：L0-L4 统计分析方法论（含 Python 代码）。
- `references/decision-report-v1.md`：默认决策报告协议。
- `references/case-analysis-report.md`：case 分析报告写作规范。
- `references/data-format.md`：输入数据格式和目录约束。
- `references/anchor-design.md`：锚点题设计与一致性诊断。
