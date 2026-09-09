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

生成 Review 页面后先单独归档 Review 阶段：

```bash
gsb-cli report upload \
  <task-id> \
  <review-report-path> \
  <case-review-draft-path> \
  --json
gsb-cli report status <task-id> --json
```

用户在后续对话中明确触发正式分析报告后，再归档最终产物；CQC 路径只在用户单独要求且实际生成时传入。

优先读取每次 JSON 返回的 `next_commands`。失败时按 `issues[].next_step` 修复，再执行 `continue_after_fix.command`。

## 操作规则

1. 优先复用现有登录；只有确认未登录或失效时才执行 `auth login`。Session 和 CSRF 由 CLI 管理，不复制 cookie 或 token。
2. 新 A/B 评估使用一份 AIDP-compatible `input.jsonl`。先 `dataset check`，通过后再上传。
3. 准备或接收 `input.jsonl` 时逐侧检查源 Trace；源跑测存在且可按题目和模型可靠对齐时必须保留为 `traceA/traceB`。Trace 只包含完成态 `kind=message`，流式事件需在源 model run 与任务输入写入前清除。精确格式见 `references/data-format.md`。
4. 一个业务评估只创建一个 task，不按 AIDP / ChatBuy Eval 拆 task。
5. `task publish` 会先执行 preflight；按失败项修复，不绕过发布门禁。
6. 平台返回的 dataset ID、task ID 和 URL 是后续步骤的事实来源，不根据名称猜测。
7. 核心命令使用 `--json`，不解析面向人的终端文案。
8. Review 阶段只上传 `review_report.html` 和 Review 草稿，随后停止并等待用户在后续对话中触发正式分析；上传只调整归档 HTML 的附件链接与下载处理器，本地原 HTML 保持不变，Review 页面应由 `gsb-analysis` 的共享模板默认展示输入中已有的 Trace，并以共享商品卡组件呈现有效卡、错误卡片和可展开的 response 原始 XML；上传后的 Review 与报告 HTML 默认使用公开 URL。最终阶段只上传已确认且实际存在的产物。每次上传后都用 `report status` 回读。
9. 三模型 Review 使用 `task create --mode review`；不要把它解释成 A/B GSB。

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

归档含下载链接的报告时，必须使用附件归档能力；源文件不在 workspace 目录下时传 `--workspace-root`。上传前检查附件来源，上传后回读附件字节。历史 HTML 可由此路径修复，先保存原 HTML 与 SHA-256 作为回滚证据。
