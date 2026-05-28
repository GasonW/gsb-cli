# LLM Eval Case 分析行业做法整理

本文整理 OpenAI、LangSmith、Braintrust、Humanloop 四家官方文档中与 LLM 评估、case 分析、错误归因、人审流转相关的做法，并提炼为适合 GSB / A-B 评估任务的可落地流程。

参考来源：

- [OpenAI: Evaluation best practices](https://platform.openai.com/docs/guides/evaluation-best-practices)
- [LangSmith: Evaluation](https://docs.langchain.com/langsmith/evaluation)
- [LangSmith: Analyze an experiment](https://docs.langchain.com/langsmith/analyze-an-experiment)
- [LangSmith: Compare experiment results](https://docs.langchain.com/langsmith/compare-experiment-results)
- [LangSmith: Use annotation queues](https://docs.langchain.com/langsmith/annotation-queues)
- [Braintrust: Evaluation quickstart](https://www.braintrust.dev/docs/evaluation)
- [Braintrust: Interpret evaluation results](https://www.braintrust.dev/docs/evaluate/interpret-results)
- [Braintrust: Add human feedback](https://www.braintrust.dev/docs/annotate/human-review)
- [Braintrust: Build datasets](https://www.braintrust.dev/docs/annotate/datasets)
- [Humanloop: Datasets](https://humanloop.com/docs/v5/explanation/datasets)
- [Humanloop: Run a Human Evaluation](https://humanloop.com/docs/guides/evals/run-human-evaluation)
- [Humanloop: Manage multiple reviewers](https://humanloop.com/docs/guides/evals/manage-multiple-reviewers)
- [Humanloop: Compare and Debug Prompts](https://humanloop.com/docs/guides/evals/comparing-prompts)
- [Humanloop: Set up LLM as a Judge](https://humanloop.com/docs/guides/evals/llm-as-a-judge)

> 注：Humanloop 文档页提示其平台将于 2025-09-08 sunset。这里仅参考其公开方法论和产品流程，不代表推荐采用该平台。

---

## 1. 总体结论

四家的共同点不是把评估结果做成一次性汇总，而是把 eval 建成一个闭环：

```text
数据集 / 线上日志
  -> 运行评估实验
  -> 自动评分 + 人工判断
  -> 按 metadata / score / trace 切片分析
  -> 抽取 bad case / good case / regression case
  -> 定位 root cause
  -> 修 prompt / 模型 / 工具 / 检索 / 数据
  -> 重新跑同一批 case 验证
```

对 `0403-baseline` 这类 GSB 任务，case 分析报告不应只列举 bad case，而应回答三个问题：

1. 当前有哪些问题，分布如何。
2. 每类问题的原始 model response 是什么样。
3. 这些问题应由谁负责，如何修，如何回归验证。

---

## 2. 各家做法

### 2.1 OpenAI：eval-driven development

OpenAI 的评估建议偏方法论，核心观点是：

- eval 是生产系统的一部分，不是上线前一次性的人工检查。
- 需要先定义目标，再收集数据、定义指标、运行对比、持续评估。
- 不能只看总分，需要结合人工判断校准自动评估。
- LLM-as-judge 更适合做 pairwise comparison、pass/fail、classification 或 rubric scoring，而不是完全开放式判断。
- 日志要完整保留，因为生产日志可以持续补充 eval dataset。
- edge cases 必须进入评估，包括多语言、短 query、长上下文、多意图、格式要求、prompt 冲突、工具调用异常等。

对应到 case 分析：

- 先明确 case 分类 taxonomy。
- 不只统计 good / bad，还要看 bad case 属于哪种 failure mode。
- 把高价值 bad case 纳入 regression set。
- 用人审结果校准 judge prompt 或自动评分规则。

### 2.2 LangSmith：dataset / experiment / trace / annotation queue

LangSmith 的做法更产品化，围绕四个对象：

| 对象 | 含义 | 对 case 分析的价值 |
|---|---|---|
| Dataset | 固定测试集，可来自人工构造、历史 trace、生产日志、合成数据 | 保证不同版本可复现对比 |
| Experiment | 某个版本在 dataset 上的一次运行 | 记录 input、output、reference、score、latency、cost |
| Trace / Run | 单条请求或步骤级调用链 | 用来定位工具调用、检索、模型输出在哪一步出错 |
| Annotation Queue | 人工标注队列 | 对低分、回归、线上异常样本进行定向人审 |

LangSmith 强调的分析动作：

- 实验结果表默认展示 input、output、reference output、feedback scores、cost、token、latency、status。
- 支持按 score、metadata、tag、status 过滤。
- 支持 group by metadata，看不同类目、意图、模型、prompt、工具下的平均表现。
- 对比实验时可直接查看 regressions 和 improvements。
- 支持 side-by-side diff，尤其适合比较两个实验输出差异。
- 支持 pairwise annotation queue，让人审在 baseline 和 candidate 之间判断谁更好或是否相当。
- 失败 production traces 可以加入 dataset，形成反馈闭环。

对应到 GSB：

- `0403-baseline` 可以视为一个 Experiment。
- 每条 case 应保留 `query`、`baseline_response`、`candidate_response`、`winner`、`magnitude`、`quality_rating`、`comments`。
- bad case 应通过 metadata 分组，例如 `intent`、`category`、`issue_type`、`root_cause`。
- 报告里应同时给整体分布和每类代表 case 原文。

### 2.3 Braintrust：Data / Task / Scores + review + dataset flywheel

Braintrust 把 eval 明确拆成三个组件：

| 组件 | 含义 |
|---|---|
| Data | test cases，包含 input、expected、metadata、tags |
| Task | 被测 AI 函数或 prompt / model / agent |
| Scores | scoring functions，可为代码规则、模型评分、人审分 |

Braintrust 的关键做法：

- 每次 evaluation 会生成 experiment，永久记录 inputs、outputs、scores、metadata。
- 分析实验时，重点看 score distributions、individual test cases、traces。
- 可用默认视图过滤 errors、scorer errors、unreviewed、assigned to me。
- 可把 experiment rows 分配给团队成员做 review、analysis 或 follow-up。
- Human review 既用于评估实验，也用于校准自动评分、从生产日志中沉淀 dataset、做分类标签和修正。
- 支持把实验结果转换成 dataset，用于下一轮 targeted evaluation。
- Dataset 是 versioned test case collection，字段建议包括 `input`、`expected`、`metadata`、`tags`。
- 对单条 dataset row 可以看它跨实验的表现：持续低分可能是 ambiguous expectation，持续失败可能是 edge case，高方差可能是系统不稳定。

对应到 case 分析：

- bad case 不只是“负例展示”，还要进入结构化 review。
- 每条 bad case 应有 `issue_type`、`severity`、`root_cause`、`owner`、`action`。
- 代表性 bad case 应沉淀为 regression dataset。
- 对反复失败或高方差 case，需要单独标记，避免被总体平均分掩盖。

### 2.4 Humanloop：Prompt / Dataset / Evaluation / Log / SME review

Humanloop 的流程围绕 prompt 迭代和 SME 人审：

- Dataset 由 Datapoints 组成，每个 datapoint 包含 inputs、messages、target。
- Dataset 有 version；每次 Evaluation 绑定特定 Dataset Version，保证结果可追溯。
- 运行 Evaluation 时，对 prompt 的某个版本和 dataset 生成 logs。
- SME 在 Review tab 中对 logs 给 judgment。
- 完成人审后，在 Stats 中看 evaluator 维度的整体表现。
- 对 negative judgments，打开原始 log，进入 Prompt Editor 修改 prompt，保存新版本，再跑新 evaluation 对比。
- 多 SME 场景下，可以给 datapoint 加 chunk 字段，把 dataset 分片，按 URL / filter 分发给不同 SME。
- 支持 side-by-side prompt version comparison 和 prompt diff，用于理解某次 prompt 改动如何影响输出。
- LLM-as-judge 被建模为一种 Evaluator：读取 log 和 testcase，输出 boolean 或 numeric judgment。

对应到 GSB：

- 负责业务的人可以作为 SME，重点标注“为什么 bad”而不是只选胜负。
- 如果 case 很多，建议按 `chunk`、`intent` 或 `issue_candidate` 分发。
- 每个 negative judgment 都应该能追溯到原始 response，并能进入 prompt / 策略修复流程。
- prompt 改动后必须用同一批 bad case 重跑，确认是否解决。

---

## 3. 四家共性抽象

### 3.1 成熟 eval case 分析的基本对象

| 对象 | 最低要求 |
|---|---|
| Case | 原始输入、上下文、两侧 response、版本信息 |
| Score | 自动评分、人审评分、GSB 结果、判断理由 |
| Metadata | 意图、类目、来源、难度、是否线上、是否 edge case |
| Trace | 检索、工具调用、模型调用、耗时、token、错误 |
| Annotation | issue type、severity、root cause、owner、action |
| Dataset version | case 集合版本，保证复现 |
| Experiment version | 模型、prompt、工具、配置版本 |
| Regression set | 高价值 bad case / edge case 的固定回归集 |

### 3.2 成熟 case 分析的基本动作

| 动作 | 目的 |
|---|---|
| Filter | 找出 bad、low score、regression、scorer error |
| Group by metadata | 看问题在哪些场景集中 |
| Side-by-side compare | 理解 baseline 与 candidate 的具体差异 |
| Human review | 给失败样本做语义归因和可行动标签 |
| Trace inspection | 判断问题发生在模型、检索、工具、数据还是 prompt |
| Export / convert to dataset | 把问题样本沉淀为后续回归集 |
| Re-run evaluation | 验证修复是否真实有效 |

---

## 4. 推荐的 `0403-baseline` case 分析报告结构

### 4.1 首页结论

```text
Task: 0403-baseline
评估对象: baseline vs candidate
样本量:
评估人数:
有效评估数:
总体 G / S / B 分布:
Top bad issue:
Top good pattern:
最高优先级 action:
```

### 4.2 数据与评估口径

- 数据来源。
- baseline / candidate 版本。
- G / S / B 判定定义。
- 是否盲评。
- 是否有多评估者。
- 是否只使用 accepted review。
- 是否存在锚点题或评估者质量过滤。

### 4.3 总体分布

建议至少给这些表：

| 维度 | 指标 |
|---|---|
| 总体 | good / same / bad 数量和占比 |
| 量级 | much better / slightly better / similar |
| 绝对质量 | exceeds / meets / below |
| 意图 | 各 user intent 的 GSB 分布 |
| 商品类目 | 各 category 的 GSB 分布 |
| 问题类型 | bad case issue_type 分布 |
| 负责人 | owner 维度的问题量 |

### 4.4 Good Case 分析

每类 good case 应包含：

```text
类别名称:
数量 / 占比:
表现特征:
为什么赢:
可复用经验:
代表 case:
  case_id:
  user_query:
  context 摘要:
  baseline_response 原文:
  candidate_response 原文:
  judge / human reason:
```

Good case 不只是表扬模型，而是为了总结可复用模式，例如：

- 回答更准确使用商品属性。
- 能主动追问缺失需求。
- 能避免不确定信息幻觉。
- 能把多个商品差异讲清楚。
- 语气更适合导购场景。

### 4.5 Bad Case 分类

每类 bad case 应包含：

```text
问题类型:
数量 / 占比:
严重程度:
影响场景:
现象定义:
代表 case:
  case_id:
  user_query:
  context 摘要:
  baseline_response 原文:
  candidate_response 原文:
  为什么 candidate 输:
可能 root cause:
建议 action:
owner:
是否进入 regression set:
```

推荐初始 taxonomy：

| Issue type | 定义 | 可能 owner |
|---|---|---|
| intent_misunderstanding | 用户需求理解错误 | prompt / model |
| irrelevant_recommendation | 推荐商品或回答与需求不相关 | retrieval / ranking / model |
| factual_error | 商品属性、规格、价格、库存等事实错误 | data / retrieval / model |
| hallucination | 编造商品信息、政策、能力 | model / prompt |
| missing_context_use | 已给上下文未使用或使用不充分 | prompt / context builder |
| insufficient_clarification | 信息不足时没有追问 | prompt / policy |
| over_refusal | 不必要拒答或回避 | safety / prompt |
| verbosity_or_style | 过长、啰嗦、不像导购 | prompt |
| unsafe_or_policy | 合规、安全、敏感问题 | safety |
| tool_or_trace_error | 工具调用、检索、链路异常 | engineering |
| evaluation_ambiguity | 评估标准或 case 本身不清 | eval owner |

### 4.6 Same Case 分析

Same case 建议拆成两类：

| 类型 | 含义 | 后续动作 |
|---|---|---|
| both_good | 两边都满足需求 | 可作为稳定通过样本 |
| both_bad | 两边都不满足需求 | 高优先级进入修复池 |

报告中不要把 same 全部当作“无问题”。`both_bad` 往往比单侧 bad 更能暴露系统性能力短板。

### 4.7 Root Cause 总结

建议按责任链归因：

| Root cause | 典型现象 |
|---|---|
| 数据问题 | 商品属性缺失、价格/库存过期、类目错误 |
| 检索问题 | 召回不到正确商品、召回噪声过多 |
| 排序问题 | 有正确商品但排在后面，模型选错 |
| 上下文构造问题 | 传入模型的信息太少、太乱或字段含义不清 |
| Prompt / policy 问题 | 未要求追问、未约束事实来源、风格指令不清 |
| 模型能力问题 | 多条件推理、比较、归纳能力不足 |
| 工具链问题 | tool 参数错误、返回解析错误、trace 缺失 |
| 评估问题 | rubric 不清、case 无法判断、人审分歧大 |

### 4.8 Action Plan

每个 action 建议用这个格式：

| Priority | Issue | Owner | Action | Expected impact | Regression cases |
|---|---|---|---|---|---|
| P0 | factual_error | data / retrieval | 修正商品属性源和上下文字段 | 降低事实错误 bad case | Q_001, Q_017 |
| P1 | insufficient_clarification | prompt | 缺少关键槽位时先追问 | 提升导购准确性 | Q_023, Q_045 |

---

## 5. 推荐数据流转

### 5.1 离线 GSB case 分析流

```text
workspace/tasks/0403-baseline 原始数据
  -> GSB 评估结果 eval_*.json
  -> 归一化 case table
  -> 聚合 G/S/B 分布
  -> bad / good / same 抽样池
  -> 人工标注 issue_type / severity / root_cause / owner
  -> 生成 case analysis report
  -> regression_cases.jsonl
  -> 修复后重跑同一批 regression cases
```

### 5.2 推荐 case table 字段

```text
case_id
task_id
query_id
user_query
context
baseline_version
candidate_version
baseline_response
candidate_response
winner
magnitude
quality_rating
judge_reason
human_reason
issue_type
severity
root_cause
owner
action
metadata.intent
metadata.category
metadata.source
metadata.difficulty
trace_id
is_regression_case
review_status
reviewer
created_at
```

### 5.3 推荐流转状态

```text
new
  -> auto_scored
  -> needs_review
  -> reviewed
  -> assigned
  -> fixed_candidate_ready
  -> regression_passed / regression_failed
  -> closed
```

---

## 6. 和当前 GSB 框架的对应关系

当前框架已有能力：

- 双栏 A/B 对比。
- 盲评。
- 多用户评估。
- `winner`、`magnitude`、`quality_rating`、`comments`。
- 决策报告。
- 评估者质量分析和锚点题建议。

建议补齐的 case 分析能力：

1. 从 `rating_result/eval_*.json` 生成一张 task 级 case table。
2. 在 case table 中补充人工归因字段：`issue_type`、`severity`、`root_cause`、`owner`、`action`。
3. 报告中每个 issue type 自动抽取代表 case，并展示两侧 response 原文。
4. 把 P0 / P1 bad case 导出为 `regression_cases.jsonl`。
5. 下一版模型或 prompt 评估时，优先跑 regression set，并报告旧问题是否消失、新问题是否出现。

---

## 7. 一句话总结

成熟做法的核心不是“评估完写总结”，而是把每条失败样本变成可追溯、可分配、可修复、可回归的工程资产。对 `0403-baseline`，case 分析报告应同时服务三类人：业务 owner 看问题分布，模型 / prompt / 检索 owner 看原始失败表现，项目 owner 看 action 和回归验证。
