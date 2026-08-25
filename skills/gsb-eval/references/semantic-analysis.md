# GSB LLM 语义分析协议

> protocol_version: `gsb-semantic-analysis-v1`
> source: `chatbuy_gsb_eval_framework/docs/analysis-specs/reusable-gsb-case-deep-dive-spec.md`
> status: normative；用于原因、Case、噪声和 Regression 结论

## 1. 执行边界

本协议锁定 LLM 语义分析的方法。Agent 必须按本文件执行，不得根据任务结果临时改变 Prompt 阶段、输入证据、标签、置信度门槛或覆盖范围。

以下需求必须运行本协议：

- 为什么赢或输；
- 问题簇、能力簇或根因；
- good case / bad case / Same case 深挖；
- 疑似标注噪声；
- Regression 或 Positive Regression 集合。

只做分数汇总、显著性和数据质量时，可以只运行 `gsb-decision-v2` 的确定性统计。但没有本协议产物时，报告不得展示根因、语义置信度、标注噪声或 Regression 标签。

LLM 负责回答质量、评论可信度和最终 case 语义判断。确定性代码只负责提取、关联、匿名化、A/B 换位、结构校验、批次调度、持久化、汇总和渲染。评分与人工评论是证据，不是默认正确答案。

## 2. 输入与覆盖范围

### 2.1 必需输入

- task `input.jsonl` 中的 query、双版本完整回答、商品卡和 `traceA/traceB`；
- 规范化后的所有标注、质检和裁决记录，包括双 Pointwise、Overall + 五维 Pairwise、评论和评论审核；
- task manifest、真实模型映射、结果来源和稳定 `query_id`。

### 2.2 固定覆盖规则

- 覆盖全部已有评估结果的题目，包括 Good、Same、Bad；不得只分析 Bad 或抽样代表题。
- 每个 `query_id` 是一个样本，权重为 1；不得把多名标注人员和质检拆成独立题目。
- 只分析已有评估结果的题；`input.jsonl` 中未评题不进入分母。
- 双版本回答、trace 或评分缺失时保留该题并记录可用性，不补造内容。
- Pointwise 只接受 0–3；Pairwise 只接受 -2、-1、0、1、2。聚合后的小数保留原值。

### 2.3 运行一致性

同一任务的所有题使用相同的 LLM 版本、Prompt 版本和生成参数。每次运行记录：

- LLM 供应方和模型版本；
- Prompt 版本、完整 Prompt 哈希；
- 输入哈希；
- A/B 顺序；
- 运行时间和生成参数；
- 原始结构化输出、校验状态和重试记录。

不得根据第一批结论临时修改 Prompt 再继续剩余题目。确需变更时创建新 run，并对全部题重新执行。

## 3. 第一层：双回答换位盲审

第一层隔离人工标签锚定。每题必须运行两次。

### 3.1 盲审输入

只提供：

- query；
- 匿名回答 A/B 和对应商品卡；
- 验证回答事实或行为所必需的同题工具返回和完成态 trace。

不得提供：

- 真实模型版本名；
- 标注/质检人员身份；
- Pointwise、Pairwise、评论、评论审核；
- 人工最终结论或已有根因标签。

### 3.2 两次顺序

- Pass 1：原匿名顺序 A/B；
- Pass 2：交换输入顺序 B/A；
- 两次使用同一 Prompt、模型和生成参数；
- 汇总时必须映射回稳定模型身份，不能按匿名字母直接比较。

### 3.3 盲审任务

分别判断：

1. 需求满足；
2. 事实与推理；
3. 语言表达；
4. 信息呈现；
5. 专业性；
6. 整体决策价值。

同时分离：

- A 独有问题和优势；
- B 独有问题和优势；
- 两版共同问题；
- 只能由现有证据支持的事实；
- 无法验证、需要外部核验的事实 `requires_fact_check`。

每个关键判断必须给出证据引用，引用指向回答片段、商品卡或 trace step。禁止只输出抽象形容词。

### 3.4 盲审输出

每次输出一条 JSONL，必须满足 `schemas/agent-blind-review-v1.schema.json`。至少包含：

- query_id、pass、匿名顺序和输入哈希；
- 匿名 Pairwise Overall + 五维；
- 两个匿名回答的 Pointwise；
- 双方优势、独有问题和共同问题；
- 证据引用与待核事实；
- Prompt、模型和运行元数据。

两条盲审输出完成后再计算换位一致性。不得让第二次看到第一次输出。

## 4. 第二层：人工证据审核与最终裁决

第二层输入两次盲审完整输出、原始双版本材料，以及全部标注/质检/裁决的评分、评论、评论审核和结果来源。

### 4.1 评论逐条审核

每条人工评论只能归入以下一种状态：

| 状态 | 含义 |
|---|---|
| `supported` | 双回答、商品卡或 trace 直接支持。 |
| `partially_supported` | 核心方向成立，但范围、程度或归因过强。 |
| `unsupported` | 现有证据不支持。 |
| `misattributed` | 问题或优点被归给了错误模型/对象。 |
| `subjective` | 属于合理主观偏好，不能作为事实性缺陷。 |
| `requires_fact_check` | 必须外部核验，当前材料无法判断。 |

每条审核必须保留 comment_id、来源、目标模型、结论、说明和支持/反驳证据。空的 `commentReviews.decision/note` 不得被推断为质检意见。

### 4.2 冲突检查

必须显式检查：

- 两次换位盲审是否同向；
- 人工评论是否与实际目标模型对应；
- 评论与 Pointwise/Pairwise 是否一致；
- Pointwise 与 Pairwise 是否存在严重或轻度冲突；
- 不同标注人员、质检/裁决与盲审是否冲突；
- 两版是否都有同类问题，导致相对结论证据不足。

### 4.3 最终标签

每题只能输出以下一种最终结论：

| 标签 | 中文含义 | 判定边界 |
|---|---|---|
| `real_regression` | 真实回退 | 人工 Bad 得到双回答相对缺陷和证据链支持。 |
| `insufficient` | 证据不足 | 最终方向存在，但复现弱、两版共同问题严重或关键事实无法验证。 |
| `suspected_annotation_noise` | 疑似标注噪声 | 人工方向与盲审、评论归属或可见证据直接冲突；等待人工复核。 |
| `improvement` | 评估向好 | 候选版本有可定位的相对优势；不自动等于稳定总体提升。 |
| `stable` | 评估持平 | 两版表现接近，或共同能力/共同问题主导。 |

`suspected_annotation_noise` 不是“标注人员判断错误”的自动结论，必须设置 `needs_human_review=true`。

### 4.4 置信度门槛

- **高**：两次换位盲审映射回真实模型后同向；差异有可定位证据；对照版本确实避免该问题；第二层无关键冲突。
- **中**：主要差异成立，但换位、人工信号、共同问题或待核事实存在一项争议。
- **低**：盲审方向不稳定、两版同类问题严重、关键事实不可验证或冲突未解决。

LLM 自报概率不能改变上述等级。高置信必须满足全部证据门槛。

### 4.5 原因与 Regression

每题最多一个主因、两个次因。默认根因标签：

- `decision_coverage`
- `constraint_mismatch`
- `product_card_binding`
- `fact_reasoning`
- `comparison_decision`
- `presentation_language`
- `profile_misuse`
- `common_failure`
- `evaluation_noise`

只有 `real_regression` 且置信度为高/中、证据链完整、`needs_human_review=false` 的题可以进入正式 Regression 候选。`suspected_annotation_noise` 在人工复核完成前不得进入；`insufficient` 不进入。

Good/Same 在完成两层审核后才能归纳可迁移能力或共同问题；未完成时只允许显示 `positive_signal` / `stable_signal`。

第二层每题输出一条 JSONL，必须满足 `schemas/agent-semantic-audit-v1.schema.json`。第二层就是最终裁决，不再增加自由形式的第三层。

## 5. Trace 证据边界

- 只读取完成态 message，忽略 system prompt、delta、token、partial、runtime snapshot、鉴权和凭证。
- 通过 `tool_call_id` 关联 Assistant 调用与 Tool 完整返回。
- trace 只证明模型做了什么，不能单独证明评分原因。
- 行为归因必须满足：`trace 行为 → 最终回答表现 → 评论/双版本差异 → 结论`。
- 工具次数、回答长度或关键词不能单独产生质量结论。
- `SearchProduct` 展示完整商品表；其他工具保留完整 raw。展示层截断不改变语义审核输入和原始产物。

## 6. 汇总与报告

逐题审核全部完成后，确定性代码才能做聚合：

1. 按 case 数统计最终标签和根因，不按评论条数统计；
2. 从题型/场景/维度定位差异，量化 n、效应和 CI；
3. 聚合主因/能力簇，并检查同题型反例、非 Bad case、不同评估者和不同合理口径；
4. 只有通过反例检查的簇进入主结论，其余标记探索性或待复核；
5. 正文用少量代表 case 解释结论，全量题目保留在可筛选证据卡片中。

报告必须分层展示“人工评估结果”“LLM 盲审”“评论证据审核”“最终语义裁决”，不得把它们合并成一个不可追溯结论。

## 7. 固定产物

任务目录内保存：

```text
report/runs/<analysis-run-id>/agent-blind-review.jsonl
report/runs/<analysis-run-id>/agent-semantic-audit.jsonl
```

需要专项 deep dive 时，可同时发布：

```text
report/<run>-case-deep-dive.md
report/<run>-case-deep-dive.html
report/<run>-case-deep-dive-summary.json
exports/<run>-case-audit.jsonl
exports/<run>-regression-set.jsonl
```

原始 input、trace 和评估结果不可修改。报告生成器只读取上述审核产物，不在代码中硬编码逐题裁决。

## 8. 失败与用户覆盖

- 任一题两次盲审缺失、schema 校验失败或输入映射不完整：该题语义结论为不可用并进入人工复核，不能由 Agent 手工补标签。
- 运行失败可以用同一输入、Prompt、模型和参数重试；不得为了得到可解析或更符合预期的结论改变方法。
- 用户明确要求改变覆盖范围、盲审次数、标签、置信度或输入证据时，记录到 `analysis_config.json.method_overrides` 和 `_analysis-audit.json`，创建新 run，并在报告方法区披露。
- 没有用户明确声明时，Agent 不得把时间、成本、样本量或“看起来足够”作为缩减协议的理由。

## 9. 验收

- 已评题数、两次盲审条数和最终审核条数满足 `N / 2N / N`，query_id 唯一。
- 每题两次盲审使用相反匿名顺序，Prompt/模型/参数一致。
- 所有关键语义判断都有证据引用；所有人工评论都有审核结果。
- 高置信题满足固定证据门槛；疑似噪声均进入人工复核。
- Regression 集合只包含符合本协议资格的真实回退。
- 两个 JSONL 通过对应 schema 校验，并可回溯模型、Prompt 和输入哈希。
- 无语义审核产物时，最终报告不出现根因、语义置信度、噪声或 Regression 断言。
