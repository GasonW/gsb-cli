# GSB 统一 JSONL 输入

## 决策分析评次字段

`gsb-decision-v2` 的每个评次至少需要：稳定 Query ID、评估者、角色（worker/qc/adjudicator）、L/R 真实模型、两个模型的 Pointwise `0/1/2/3`、Pairwise Overall 与五维五档、状态和结果 lineage。不同题可以有不同 Worker 数。

归一化后 Pointwise 按真实模型保存，Pairwise winner 可以直接保存真实模型名；L/R 仍需保留用于身份和位置偏好审计。复制或继承的 workflow final 必须标为 derived，不能增加票数。完整处理口径见 `analysis.md`。

## 标准格式

AIDP 与 ChatBuy Eval 共用一个 JSONL。每个非空行是一个 JSON object，并完整包含同一道题的 A/B 数据：

```json
{"taskName":"candidate vs baseline","queryId":"item_001","query":"用户问题","versionAName":"baseline","versionBName":"candidate","responseA":"版本 A 回复","responseB":"版本 B 回复","productCardsA":[],"productCardsB":[]}
```

必填字段：

- `taskName`、`queryId`、`query`
- `versionAName`、`versionBName`
- `responseA`、`responseB`
- `productCardsA`、`productCardsB`：JSON 字符串数组；无商品卡时为 `[]`

`queryId` 在文件内唯一，只使用字母、数字、点、下划线或连字符。`taskName` 和两个版本名在所有行中保持一致。

## 检查、上传和绑定

```bash
gsb-cli dataset check --input ./input.jsonl --json
gsb-cli dataset upload --input ./input.jsonl --name candidate-vs-baseline --json
gsb-cli task bind <task-id> --input <jsonl-dataset-id> --json
```

本地 canonical task 只保存一份 `input.jsonl`；线上 JS 后端把每行固化为同一 task 的 PostgreSQL item 快照。不要按平台复制 task，
也不要创建 `aidp/`、`input/`、`data_a/`、`data_b/` 适配目录。

旧的 `--a <dir-a> --b <dir-b>` 命令只用于读取未迁移历史任务，不用于创建新任务。

## 平台渲染

默认 renderer 展示 `query`、`response`、`product_cards` 等标准字段。需要展示自定义原始字段时，使用 `gsb-cli task renderer upload` 上传任务级 `renderer.js`。
