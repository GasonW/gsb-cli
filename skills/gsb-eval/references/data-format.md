# GSB 数据格式说明

## 唯一硬性约束：文件名一一对应

平台对 JSON 文件**内容没有固定要求**。唯一约束是：两个版本目录下的文件名必须一一对应（文件名即 query ID）。

```
<data_dir>/
├── <version_A_folder>/
│   ├── item_001.json   ← 文件名决定 query ID
│   └── item_002.json
└── <version_B_folder>/
    ├── item_001.json   ← 与版本 A 文件名相同
    └── item_002.json
```

- 只出现在一个版本中的文件会被忽略。
- query ID 区分大小写（`Q_0001` ≠ `q_0001`）。
- 命名规则任意（`Q_0001`、`item_001`、`case_abc` 等均可）。

## 平台渲染

平台使用默认 renderer 展示数据。默认 renderer 主要识别 `query`、`response`、`rubrics`、`product_cards` 等常见字段。如果数据结构不同（如自定义字段名、嵌套结构、多轮对话等），需要通过 `gsb-cli task renderer upload` 上传自定义 renderer.js。详见 `references/agent-cli.md` 中 Renderer 管理章节。

## 数据检查

使用 CLI 检查数据格式和文件对齐：

```bash
gsb-cli dataset check --a ./data/baseline --b ./data/candidate --json
```

只检查文件名匹配和 JSON 可解析性，不校验内容格式。常见错误码：`DATASET_DIR_NOT_FOUND`、`NO_JSON_FILES`、`JSON_PARSE_ERROR`、`JSON_ROOT_NOT_OBJECT`、`ZERO_COMMON_ITEMS`。
