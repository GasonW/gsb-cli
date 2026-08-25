# GSB 分析协议

> protocol_version: `gsb-decision-v2`
> canonical spec: `chatbuy_gsb_eval_framework/docs/analysis-specs/gsb-decision-analysis-template-spec.md`

本文件是 `gsb-decision-v2` 主协议中的确定性统计与清洗规范，不是独立协议，也不是建议。Agent 必须通过唯一入口 `scripts/build_gsb_decision_report.py` 执行；入口内部加载 canonical `gsb_analysis_v2` 实现包，Agent 不得直接调用或修改该包，也不得在单次任务中自行改变阈值、聚合单位、冲突规则、置信度或输出口径。只有用户明确要求时才能通过 `analysis_config.json.method_overrides` 偏离，并在新的不可覆盖 run 中记录原规则、新规则、原因及 `declared_by=user`。

## 执行顺序

```text
结构校验 → L/R 到真实模型 → Worker/QC 校准 → Worker 权重处理
→ 评次级跨指标冲突 → Query 有效 Worker 检查 → 题内聚合
→ 主分析 + 原始/处理后敏感性 → 下钻与 Case 证据
```

## 多 Worker 与 QC

- 支持每题 1～N Worker，人数可不等。
- 独立 adjudication 优先于独立 QC；无独立终判时使用 Worker 加权聚合。
- Worker 状态为保留 `1.0`、降权 `0.5`、剔除 `0`、未校准 `1.0`。
- QC 重叠不足只标“未校准”。剔除须同时有 QC 低一致与独立异常信号，并由人工在 config 确认。
- QC/终判的复制值是 derived lineage，不增加票数。

## 聚合

Pointwise 对每个模型分别计算 `sum(weight*score)/sum(weight)`，保留小数。Pairwise 先统一编码为 Candidate `+2/+1`、Same `0`、Baseline `-1/-2`，再同样加权。连续值用于统计；五档用于展示：`≥1.5` 显著好、`(0,1.5)` 略好、`0` Same、`(-1.5,0)` Baseline 略好、`≤-1.5` Baseline 显著好。

## 冲突

严重冲突在复核前排除对应评次：显著 Pairwise 与 Pointwise 方向相反；Same 但 Pointwise 差至少 2 分；Overall 与至少 4 个维度反向；模型身份/字段不自洽。低严重度冲突保留并标记：略好与 Pointwise 反向、显著好但 Pointwise 相同、Overall 与 2～3 维反向。

Worker 彼此意见不同不是脏数据。无 QC 且清洗后有效 Worker 少于 config 最小数时，整题进入复核，不进入主分析。

## 统计与置信度

- Pointwise 与 Pairwise 均按 Query bootstrap，不能按评次重采样。
- 输出题目级效应、95% CI 和实际分母；可见打分汇总只展示质检优先的主口径，并明确质检结果与有效标注聚合各覆盖多少题。原始全部标注、质量处理后标注、质检优先三套口径仅在一致性与数据质量模块对照。
- 差异稳定性与数据可信度分开计算：Overall 95% CI 不跨 0 为“达到统计显著”，跨 0 或缺失为“未达到统计显著”；这只表示抽样波动，不表示数据有问题。
- 数据可信度取数据有效性、口径稳健性和证据完整性三项最低值，并展示规则与本轮触发事实；统计显著性不得参与该最低值计算。
- 报告只输出相对胜负、绝对质量和证据可信度，不根据业务门槛给出上线建议。

## 下钻证据链

每个结论依次完成：定位、量化、读取评审与双回答证据、归因、检查反例/口径、映射动作和 Regression。评论关键词、回答长度或单一 Case 不能单独证明根因。

其中“归因、标注噪声和 Regression”必须来自 `semantic-analysis.md` 的全量两层审核产物；确定性统计代码不得生成这些标签。

## 字段语义与证据边界

- 规范化后的 `winner` 已是实际模型名或 `similar`，不得再次按 left/right 映射。
- `magnitude` 表示显著好、略好或相似；`quality_rating` 表示绝对质量。`similar + below` 表示两版共同低质，不代表后一模型胜出。
- 主结论按题目聚合；多名标注人员是同一题的证据，不得拆成多道题增加权重。
- 版本级评论读取 `comments[模型名].items`、`pros` 和 `cons`；划线或卡片评论读取 `anchored_comments`，分析划线定位时过滤 `target_type=global` 的同源全局评论。
- 回答长度、标题数、表格、商品卡数量等结构指标只能解释回答形态，不能单独证明质量好坏。
- 标注人员样本少不自动代表低质；只有质检低一致与快答、锚点不一致、极端位置偏好或冲突率等独立信号叠加时，才提出降权或剔除候选。
- 锚点题只用于标注一致性与偏好诊断，不作为模型胜负的直接证据。
