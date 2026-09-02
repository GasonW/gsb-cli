---
name: gsb-cli
description: 使用 gsb-cli 操作 ChatBuy GSB 评估平台。用于登录、检查和上传数据集、创建配置发布任务、管理 Renderer、导出评估结果，以及上传查询报告归档。评估结果分析、Case Review 和报告生成由 chatbuy_gsb_eval_framework 的 gsb-analysis skill 负责。
---

# GSB CLI

## 负责范围

本 Skill 只负责通过 `gsb-cli` 操作评估平台：

- 认证与会话；
- 数据集检查和上传；
- task 创建、配置、绑定、预检、发布和归档；
- task Renderer；
- 结果汇总和导出；
- 已确认报告的上传、状态查询和下载。

需要分析评估结果、生成 AI 初步归因、完成人工 Review 或生成评估报告时，进入 `chatbuy_gsb_eval_framework` 仓库并使用项目级 `gsb-analysis` skill。本 Skill 不保存分析方法、Prompt、Schema 或报告模板。

## 默认路径

```bash
gsb-cli auth whoami --json
gsb-cli dataset check --input ./input.jsonl --json
gsb-cli dataset upload --input ./input.jsonl --name <dataset-name> --json
gsb-cli task create-gsb --name <task-name> --purpose <purpose> --input <dataset-id> --description-file ./task_description.md --json
gsb-cli task publish <task-id> --json
gsb-cli results export <task-id> --format json --output ./exports --json
```

分析完成且报告已经确认后再归档：

```bash
gsb-cli report upload \
  <task-id> \
  <review-report-path> \
  <decision-report-path> \
  <cqc-report-path> \
  <decision-summary-path> \
  --json
gsb-cli report status <task-id> --json
```

优先读取每次 JSON 返回的 `next_commands`。失败时按 `issues[].next_step` 修复，再执行 `continue_after_fix.command`。

## 操作规则

1. 优先复用现有登录；只有确认未登录或失效时才执行 `auth login`。Session 和 CSRF 由 CLI 管理，不复制 cookie 或 token。
2. 新 A/B 评估使用一份 AIDP-compatible `input.jsonl`。先 `dataset check`，通过后再上传。
3. 一个业务评估只创建一个 task，不按 AIDP / ChatBuy Eval 拆 task。
4. `task publish` 会先执行 preflight；按失败项修复，不绕过发布门禁。
5. 平台返回的 dataset ID、task ID 和 URL 是后续步骤的事实来源，不根据名称猜测。
6. 核心命令使用 `--json`，不解析面向人的终端文案。
7. 报告归档必须上传同一 final run 的四件套，并在上传后用 `report status` 回读。
8. 三模型 Review 使用 `task create --mode review`；不要把它解释成 A/B GSB。

## 精确命令

需要参数、返回字段、错误码或兼容行为时，按需读取：

- `references/agent-cli.md`：命令、参数、状态和错误恢复；
- `references/data-format.md`：输入格式和目录约束。

也可以直接运行目标命令的 `--help`。不要在 Skill 正文重复完整 CLI 手册。

## Skill 安装

```bash
gsb-cli skill install --target codex --mode symlink
gsb-cli skill status --target all
```

npm 安装会自动以 copy 模式刷新 Skill；`GSB_CLI_SKIP_SKILL_INSTALL=1` 可跳过。
