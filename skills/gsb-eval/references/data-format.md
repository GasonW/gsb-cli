# GSB 统一 JSON / JSONL 输入

## 标准格式

AIDP 与 ChatBuy Eval 共用一个标准输入。可使用逐行 JSONL，也可使用 JSON 数组或 `records/items` 包装对象；每条记录完整包含同一道题的 A/B 数据：

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

可选 `traceA/traceB` 必须是 JSON 序列化 object 的字符串数组。平台把上传文件规范化为 task 根目录唯一的 `input.jsonl`，评估运行时直接读取；“查看原始 JSON 数据”只返回当前题记录。不要按平台复制 task，
也不要创建 `aidp/`、`input/`、`data_a/`、`data_b/` 适配目录。

旧的 `--a <dir-a> --b <dir-b>` 命令只用于读取未迁移历史任务，不用于创建新任务。

## 平台渲染

默认 renderer 展示 `query`、`response`、`product_cards` 等标准字段。需要展示自定义原始字段时，使用 `gsb-cli task renderer upload` 上传任务级 `renderer.js`。
