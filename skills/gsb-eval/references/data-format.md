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

## 检查、上传和绑定

```bash
gsb-cli dataset check --input ./input.jsonl --json
gsb-cli dataset upload --input ./input.jsonl --name candidate-vs-baseline --json
gsb-cli task bind <task-id> --input <jsonl-dataset-id> --json
```

平台会保留 task 内的原始 `input/*.jsonl`，并自动物化 `data_a/data_b` 供评估运行时读取。不要手工再制作另一套 A/B 输入。

旧的 `--a <dir-a> --b <dir-b>` 命令只用于现有任务兼容。

## 平台渲染

默认 renderer 展示 `query`、`response`、`product_cards` 等标准字段。需要展示自定义原始字段时，使用 `gsb-cli task renderer upload` 上传任务级 `renderer.js`。
