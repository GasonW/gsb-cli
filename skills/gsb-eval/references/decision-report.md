# GSB 决策报告模板

> protocol_version: `gsb-decision-v2`
> canonical spec: `chatbuy_gsb_eval_framework/docs/analysis-specs/gsb-decision-analysis-template-spec.md`

本文件是 `gsb-decision-v2` 主协议中的报告模板契约，不是独立协议。生成报告时必须通过唯一入口 `scripts/build_gsb_decision_report.py` 使用 canonical renderer；不得直接调用内部 `gsb_analysis_v2` 包，不得按单次任务自行增删模块、改统计口径或另写 HTML 模板。用户明确要求的方法变化按 `SKILL.md` 的 `method_overrides` 规则创建新 run；普通文案和无口径影响的视觉适配不算方法变化。

## 固定报告顺序

1. 任务概览：任务、真实模型版本、数据集、实际评估题数、进入分析题数、标注人数、质检人数、每题标注人数、标注总次数、质检覆盖和报告生成时间。不要展示分析目标、协议、run id 或 checksum。
2. 结论表：总体胜负、绝对质量分、分维度表现、差异稳定性和数据可信度；后两项必须分开，不输出上线、灰度或暂缓建议。
3. 取数与口径：用两张表分别展示题目范围和标注记录处理。记录被排除不等于整题被排除；若该题仍有其他可用结果，进入分析的题数不减少。
4. 打分汇总：先 Pointwise，再 Pairwise Overall + 五维。
5. 全量打分明细：每题一张证据卡片，折叠态扫读分数/GSB/Trace 摘要，展开态查看双版本回答、逐人评分与评论、双栏 Trace；标题显示当前命中题数 / 全部题数。
6. 一致性与数据质量：标注-质检一致性、标注人员处理、质检改判、位置偏好、口径敏感性。
7. 统一下钻：Pointwise×Pairwise 象限 → 题型/场景 → 维度 → 原因证据 → Case → 动作。
8. 冲突与待复核：列出具体题、评次、评估者、等级、原因和处理状态。
9. 行动项与回归测试。
10. 附件下载：仅原始跑测 Trace、原始标注结果和 Benchmark。
11. 方法与局限。

## 展示语言

- 正文使用真实模型版本号，不使用 Candidate/Baseline 占位称呼。
- 正文使用“标注人员”“质检人员”“题目”，不使用 Worker、QC、Query 等实现术语；源字段和代码标识可保留英文。
- 先给自然语言结论，再给数字证据。95% CI 必须解释为“差异达到统计显著”或“区间跨 0，不能确认领先稳定存在”。
- “差异稳定性”只描述抽样波动和统计显著性；“数据可信度”只评价数据有效性、口径稳健性和证据完整性。未显著不等于数据不可信。
- Pointwise 结论按平均分、0 分率、`≥2` 分率的顺序展示。
- Pairwise 结论同时给出 G/S/B 题数和排除 Same 后双方胜率。

## 必须展示的分数

- 打分汇总先给本节结论，分点说明绝对分、整体 GSB 和主要负向维度。
- Pointwise：可见报告只展示题目级 `[0,1)`、`[1,2)`、`[2,3)`、`3`、均值、平均分估计范围（95%）、`≥2` 率、0 分率和配对分差；各分段同时展示题数和比例，表格前注明采用质检结果与有效标注聚合的题数。单模型估计范围不用于判断模型差异，显著性看同题配对分差。原始评分记录分布只保留在审计产物。
- Pairwise：Overall + 五维的前一真实模型显著好、略好、Same、后一真实模型略好、显著好；连续方向均值、95% CI，以及“胜率（排除 Same）”。在表下定义公式，主表不展示 Same 子类。
- 主统计始终以题目为重采样和汇总单位，每题权重为 1。可见报告统一使用“题目”，不混用 Query/Case。

## 全量明细与跳转

明细至少包含题目标签、数据状态、有效标注人数/质检状态、双 Pointwise、Overall + 五维、方向一致、冲突、逐人评论和 Trace 摘要。第一层同时提供两个模型各自的 Pointwise 分数选择框、前一模型分数高于/等于/低于后一模型，以及“GSB 维度 → 五档结果”二级筛选；文本搜索、工具等条件收进更多筛选。只在模块标题显示一次 `x / n 题`。所有摘要点击统一筛选卡片列表、回填可表达的筛选控件并显示当前下钻名称，不创建另一套分歧 case 页面。

筛选区在浏览模块 4 时整体吸附在视口顶部，吸附范围只能位于模块 4；进入模块 5 后必须停止吸附。

卡片展开后必须展示：两版完整回答与商品卡数量；每名标注、质检、裁决的 Pointwise 和 Overall + 五维 GSB；按模型分组的全局、划线、商品卡评论；两个模型并列的完成态 Trace。Trace 只取 `kind=message`，通过 tool call id 关联完成结果，不展示 system prompt、流式 delta、runtime 控制事件或凭证。`SearchProduct` 的直接 JSON、二次编码 JSON、JSON 后附加提示文本统一解析为商品表；标题超长时省略并悬停显示全称，表格不得撑破 Trace 栏。其余工具保留完整 Raw 返回。无独立语义审计产物时，不得凭评论关键词、回答长度或 Trace 自动生成根因/置信度/Regression 标签。

需要展示根因、能力簇、标注噪声或 Regression 时，报告必须读取 `agent-blind-review.jsonl` 与 `agent-semantic-audit.jsonl`，且它们满足 `semantic-analysis.md` 的覆盖和 schema 要求。缺失或不完整时只展示统计下钻和原始证据，不生成语义结论。

题目链接必须相对当前 task：

```html
<a href="../review/?q=<urlencoded-query-id>">题目</a>
```

禁止写死域名、环境、task id 或本机路径。

## 一致性指标展示

- 一致性系数必须同时给出“很低/较低/一般/中等/较高/高”的读者解释，并提示结合质检重叠题数判断。
- Pointwise MAE 在正文写作“绝对分平均差”，说明 0 表示完全相同、越低越好。
- 最大侧偏写作“单侧选择最高占比”，说明接近 50% 较均衡、达到任务阈值才记为异常。
- 人员处理使用中文状态，并写“分析权重 1.0/0.5/0”，不显示未解释的 `w`。

## 附件下载

只列出并提供下载：两个模型的原始跑测 Trace、本任务原始标注结果、canonical Benchmark。文件模式使用 workspace 相对路径；平台模式使用 `/tasks/<task-id>/artifacts/download?path=<allowlisted-path>`，服务端必须校验任务查看权限和 source/manifest 推导出的文件白名单。不得把 config、seed、checksum、normalized evaluations、worker quality、query scores 或 review queue 放进可见附件区。

## 产物

每次分析写入 `workspace/tasks/<task-id>/report/runs/<analysis-run-id>/`。根目录只发布：

```text
report/decision_report.html
report/decision_summary.json
```

完整 run 包含 config、normalized evaluations、worker quality、query scores、review queue、summary、case evidence、audit 和 HTML。run 不可覆盖。
