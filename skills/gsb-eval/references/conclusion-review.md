# GSB 结论 Review 工作流

> protocol_version: `gsb-decision-v2`
> canonical spec: `chatbuy_gsb_eval_framework/docs/analysis-specs/gsb-decision-analysis-template-spec.md`

本文件定义评估结论 Review 如何启动、保存后的数据语义，以及终判如何进入正式算法与 CQC 报告。它适用于 `review_report.html` 的题目级结论复核，不是三模型打分任务的 Review 模式。

## 何时启动

评估结果已回收、canonical analysis run 已生成，但算法结论尚未正式定稿时启动结论 Review。先在 platform repository 根目录生成不可覆盖的四件套：

```bash
python3 scripts/build_gsb_decision_report.py \
  --task <task-id> \
  --config <analysis-config.json> \
  --no-publish
```

从命令 JSON 输出读取 `review_report`、`report`、`cqc_report`、`summary`，以及存在时的 `case_review_draft`，再归档到平台：

```bash
gsb-cli report upload \
  <task-id> \
  <review-report-path> \
  <report-path> \
  <cqc-report-path> \
  <summary-path> \
  [case-review-draft.jsonl] \
  --json

gsb-cli report status <task-id> --json
```

打开 `report status` 返回的 `urls.review` 开始复核。Review 页面依赖任务 API 保存结果；不要用本地 `file://` 页面代替平台入口。重新上传报告不会删除已保存的题目 Review，因为 Review 覆盖层独立于报告文件保存。

## 页面与保存语义

`review_report.html` 是后续 GSB 分析固定复用的结论 Review 模板：候选模型在前、基线模型在后；证据区展示用户画像、双回答与商品卡、模型内折叠 Trace、逐人评分评论，末尾才是题目终判。

每道题可独立处理：

- Pointwise：分别确认候选与基线的 `0/1/2/3` 最终分。
- Pairwise：只确认 Overall GSB，顺序为候选显著好、候选略好、Same、基线略好、基线显著好。
- 评论：选择采纳、修正或不采纳；修正与不采纳必须填写说明。
- 问题成因：直接编辑候选 Response、Baseline Response 和相对比较三组问题的标签、主次和总结；主因数量不受限制，可以为 0、1 或多个。关联人工评论为选填，回答证据由 AI 草稿保留但不要求人工 Review；页面不再编辑问题优先级、证据状态和事实核验备注。
- 题目备注：可记录给后续 AI 的关注点或 Reviewer 自用说明；备注随题保存，可由页面搜索命中，并进入最终 Case 分析物化结果。
- 未修改分数表示认可当前统计来源分；未操作评论在保存时默认采纳。历史上只审过分数和评论的记录显示为 `in_progress`，必须补完问题成因 Review 才能完成。
- 同一个保存入口一次提交分数、评论、问题成因和题目备注，并直接写入 `completed`。页面实时更新 `Review / 筛选 / All` 数量和按 Review 状态筛选的结果；`in_progress` 仅用于兼容历史记录和旧客户端。

Review 数据写入任务级覆盖层，不改写原始标注、质检结果或原始跑测数据。

## 最终结果口径

每个评分项独立采用以下优先级：

1. Reviewer 题目终判；
2. 独立 adjudication/QC 结果；
3. 有效作业人员加权平均。

Pointwise 与 Overall GSB 分别终判，不因一侧改分自动推导另一侧。原始作业人员一致性仍以其原始结果对最终题目结果计算，Reviewer 不作为额外一票。

评论按以下规则进入后续分析：

- 采纳：作为算法与 CQC 报告的有效证据；
- 修正：评论仍作为有效证据，修正说明同时进入 CQC 反馈；
- 不采纳：不进入算法分析，不采纳原因进入 CQC 反馈；
- Reviewer 的打分依据：作为独立 review evidence 进入算法与 CQC 分析。

## Review 完成后的正式生成

Review 页面保存后会即时重算页面中的单题结果与筛选状态，但不会自动改写已经归档的 `decision_report.html` 和 `cqc_report.html`。正式使用 Review 结论时，必须在持有该 task workspace 的 platform repository 中重新执行 canonical 生成入口，创建一个新的 analysis run：

```bash
python3 scripts/build_gsb_decision_report.py \
  --task <task-id> \
  --config <analysis-config.json> \
  --no-publish
```

生成器先按原始作业结果完成 QC/Worker 聚合，再读取任务级 Review 覆盖层并应用 Reviewer 终判。确认新 run 后，再次上传新的四件套并回读状态：

```bash
gsb-cli report upload \
  <task-id> \
  <new-review-report-path> \
  <new-report-path> \
  <new-cqc-report-path> \
  <new-summary-path> \
  --json

gsb-cli report status <task-id> --json
```

此后：

- `urls.algorithm` 是采用最终有效分和有效评论证据的算法报告；
- `urls.cqc` 是采用评论决策、修正说明、不采纳原因和 Reviewer 依据的 CQC 报告；
- `urls.review` 保留为题目级终判与复核入口；
- `decision_summary.json` 与新 run 保持同一 `source_analysis_run_id`。

## 导出与核验

需要留存 Review 审计快照时运行：

```bash
gsb-cli report review \
  <task-id> \
  --output ./review-feedback.json \
  --json
```

该命令只读取并导出已保存的题目终判、评论状态、候选/Baseline/相对问题列表以及按题目和 Reviewer 汇总的统计；它不启动 Review 页面、不写入 Review 结果，也不触发算法/CQC 报告重算。

归档前至少核验：

1. `query_review_summary.completed_question_count` 达到本次计划复核题数；
2. 新 analysis run 的生成时间晚于最后一次 Review 保存时间；
3. 新四件套来自同一个 run，且 `report upload` 与 `report status` 均成功；
4. 算法报告中的最终分和 CQC 报告中的评论处理与抽样 Review 题一致。
