# GSB 统一 JSONL 输入

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

可选 Trace 字段：

- `traceA`、`traceB`：对应模型侧的 JSON object 字符串数组；
- `traceSchemaVersion`：当前使用 `chatbuy-trace-message/v1`；
- `showTrace`：只控制评估作业页是否展示，不控制 Trace 是否保存在数据中，也不控制 Review HTML。

准备、拆分或重导出数据时，先按 query 身份和模型标签核对两侧源记录。源 Trace 可以可靠对齐时必须写入对应的 `traceA/traceB`，不得截断、串侧或因平台转换而省略；无法可靠对齐时停止写入并报告冲突。`dataset check` 前应统计两侧 Trace 覆盖率。Review HTML 由 `gsb-analysis` 的共享模板生成，对已经保存的 Trace 默认展示。

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
