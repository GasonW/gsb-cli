# GSB 评估结果统计分析指南

评估收集完成后，执行统计分析并生成 HTML 报告。本指南记录完整方法论与可复用代码模板。

---

## 分析框架：5层递进

| 层次 | 内容 | 核心问题 |
|------|------|---------|
| **L0 数据质量** | 锚点题重测信度 + 行为信号检测 → 评估者连贯性得分 | 数据可信吗？噪声有多大？ |
| L1 总体胜负 | 归一化 verdict（结合 left_version）→ 6类计数 + 胜出方质量分布 | V_new 整体是否优于 V_old？显著/略好比例如何？ |
| L2 统计显著性 | 二项检验 + Bootstrap CI（可选：按连贯性加权） | 提升是真实的还是随机噪声？ |
| L3 细粒度剖析 | 按题目 / 按评估者拆分 + 灵敏度分析 | 哪些 case 赢、哪些 case 退步？结论对噪声稳健吗？ |
| L4 根因归纳 | 评论文本分类 + 评估者聚类 | 为什么赢？为什么输？用户群体是否存在系统性偏好分歧？ |

> **L0 是前置步骤，不是可选项。** 在开始 L1 计数之前，先评估数据质量——高噪声下的胜率数字是误导性的。锚点题设计规范见 [`anchor-design.md`](anchor-design.md)。

---

## 核心数据结构（v2 归一化格式）

每条评估记录（`results/eval_*.json`）的格式：

```json
{
  "Q_0001": {
    "query_id": "Q_0001",
    "evaluator": "张三",
    "winner": "gpt4_turbo",          // 胜出版本的实际名称，或 "similar" 表示差不多
    "magnitude": "much_better",      // much_better | slightly_better | similar
    "quality_rating": "meets",       // exceeds | meets | below（所有场次都有值）
    "comments": {
      "gpt4_turbo": { "pros": "回答更简洁", "cons": "" },
      "claude_3_5": { "pros": "", "cons": "参数错误" },
      "general": "整体评价..."
    },
    "left_version": "gpt4_turbo",    // 盲评时左边面板的版本（审计用）
    "right_version": "claude_3_5",
    "mode": "blind",
    "timestamp": "2026-02-25T16:00:57.220429"
  }
}
```

**关键**：
- `winner` 已在存储时完成归一化，直接是胜出版本的实际名称，**无需再做 left/right 映射**。
- `winner = "similar"` 对应持平判定；通过 `quality_rating` 区分"都好"（exceeds/meets）和"都不好"（below）。
- `quality_rating` 对**所有**场次都有值（含 similar），反映胜出方或双方共同的绝对质量：
  - `exceeds`（超出预期）/ `meets`（符合预期）/ `below`（低于预期，"矮子里拔高个"）
- 评论按版本名直接读取：`comments["gpt4_turbo"]["pros"]`，无需 left/right 映射。
- 若启用了管理员审核，分析时应通过 API `GET /api/summary?all=1&accepted_only=1` 获取仅已接受的结果。

---

## L0：数据质量与锚点分析

> **前提**：需要在数据准备阶段配置锚点题（每位评估者都会遇到、少量题目重复出现）。
> 若本次评估未配置锚点题，跳过 L0.1 / L0.2，仅做 L0.3 行为信号检测。

### L0.1 重测信度（Test-Retest Reliability）

同一道题让同一人评两次，检验前后判断是否一致。这是最干净的连贯性信号，不依赖"正确答案"假设。

```python
# anchor_ids: 在数据准备时预先标注的锚点题 ID 列表
# 例如 anchor_ids = ["Q_0001", "Q_0005"]，且这些题目出现了两次（ID 如 Q_0001 和 Q_0001_repeat）
ANCHOR_PAIRS = {
    "Q_0001": "Q_0001_repeat",
    "Q_0005": "Q_0005_repeat",
}

coherence_scores = {}
for ev, recs in by_ev.items():
    by_qid = {r['query_id']: r for r in recs}
    matches, total_pairs = 0, 0
    for q1, q2 in ANCHOR_PAIRS.items():
        if q1 in by_qid and q2 in by_qid:
            total_pairs += 1
            r1, r2 = by_qid[q1], by_qid[q2]
            # 比较方向一致性（忽略量级）
            if r1['norm_side'] == r2['norm_side']:
                matches += 1
    if total_pairs > 0:
        coherence_scores[ev] = matches / total_pairs
    else:
        coherence_scores[ev] = None  # 未覆盖到锚点题

for ev, score in sorted(coherence_scores.items(), key=lambda x: (x[1] is None, x[1] or 0)):
    label = f"{score:.0%}" if score is not None else "未覆盖锚点题"
    print(f"{ev}: 重测信度 = {label}")
```

### L0.2 关联锚点传递性检验（可选）

若多道锚点题测量相近维度，连贯评估者在这些题上应表现出相关性。随机作答者趋近噪声，判定方向之间几乎无相关。

```python
import numpy as np

# 将每个评估者在锚点题上的判定编码为向量
# Vnew_wins=+1, Vold_wins=-1, both_good/both_bad=0
anchor_ids = list(ANCHOR_PAIRS.keys())

def encode_side(s):
    return +1 if s == 'Vnew_wins' else (-1 if s == 'Vold_wins' else 0)

ev_vectors = {}
for ev, recs in by_ev.items():
    by_qid = {r['query_id']: r for r in recs}
    vec = [encode_side(by_qid[q]['norm_side']) if q in by_qid else 0 for q in anchor_ids]
    if any(v != 0 for v in vec):
        ev_vectors[ev] = vec

# 计算锚点题两两之间的评估者相关性
if len(anchor_ids) >= 2:
    mat = np.array(list(ev_vectors.values()))  # shape: [n_evaluators, n_anchors]
    for i in range(len(anchor_ids)):
        for j in range(i+1, len(anchor_ids)):
            corr = np.corrcoef(mat[:, i], mat[:, j])[0, 1] if len(mat) > 1 else float('nan')
            print(f"锚点 {anchor_ids[i]} vs {anchor_ids[j]}: 相关系数 r = {corr:.2f}")
```

### L0.3 行为信号检测

利用评估元数据（若 server.py 记录了 `duration_ms` 和判定分布）识别低质量作答：

```python
DURATION_THRESHOLD_MS = 5000   # 判断"过快"的阈值（根据题目复杂度调整）

flags = {}
for ev, recs in by_ev.items():
    n = len(recs)
    # 信号1：作答时间异常短
    fast_count = sum(1 for r in recs if r.get('duration_ms', 999999) < DURATION_THRESHOLD_MS)
    fast_rate = fast_count / n if n else 0

    # 信号2：全部选 same（both_good 或 both_bad）
    same_count = sum(1 for r in recs if r['norm_side'] in ('both_good', 'both_bad'))
    same_rate = same_count / n if n else 0

    # 信号3：明显位置偏好（始终选左或始终选右，且未结合 left_version 分析）
    left_pref = sum(1 for r in recs if r.get('verdict', '').startswith('left_'))
    right_pref = sum(1 for r in recs if r.get('verdict', '').startswith('right_'))
    position_bias = max(left_pref, right_pref) / n if n >= 5 else 0

    flags[ev] = {
        'fast_rate': fast_rate,
        'same_rate': same_rate,
        'position_bias': position_bias,
        'suspicious': fast_rate > 0.5 or same_rate > 0.8 or position_bias > 0.85,
    }
    print(f"{ev}: 过快={fast_rate:.0%} | 全same={same_rate:.0%} | 位置偏好={position_bias:.0%}"
          + (" ⚠️ 疑似低质量" if flags[ev]['suspicious'] else ""))
```

### L0.4 连贯性得分与加权

综合重测信度（L0.1）和行为信号（L0.3），为每位评估者计算连贯性得分，用于后续加权分析。

**不建议直接剔除**低连贯评估者——这容易误杀有独立偏好的认真评估者。推荐加权保留。

```python
def compute_coherence_weight(ev):
    """综合重测信度与行为信号，输出 0~1 权重"""
    base = coherence_scores.get(ev)
    if base is None:
        base = 0.7  # 无锚点题数据时给予中等默认值

    flag = flags.get(ev, {})
    penalty = 0.0
    if flag.get('fast_rate', 0) > 0.5:   penalty += 0.3
    if flag.get('same_rate', 0) > 0.8:   penalty += 0.3
    if flag.get('position_bias', 0) > 0.85: penalty += 0.2

    return max(0.1, base - penalty)   # 最低保留 10% 权重，不完全剔除

weights = {ev: compute_coherence_weight(ev) for ev in by_ev}
print("\n评估者连贯性权重：")
for ev, w in sorted(weights.items(), key=lambda x: -x[1]):
    print(f"  {ev}: {w:.2f}")
```

### L0.5 位置偏倚检测（Position Bias）

盲评模式下左右位置随机分配，但评估者可能无意识地偏好某一侧。系统性地检测这一偏倚：

```python
# 计算每位评估者的左/右偏好
position_stats = {}
for ev, recs in by_ev.items():
    blind_recs = [r for r in recs if r.get('mode') == 'blind']
    if len(blind_recs) < 5:
        continue
    # 统计：选了左边多少次（包含 much_better + slightly_better）
    left_wins = sum(1 for r in blind_recs
                    if r.get('left_version') and r.get('winner') == r['left_version'])
    right_wins = sum(1 for r in blind_recs
                     if r.get('right_version') and r.get('winner') == r['right_version'])
    n = len(blind_recs)
    left_rate = left_wins / n
    right_rate = right_wins / n

    # 二项检验：左边胜率是否偏离 50%（排除 similar 后）
    decisive_blind = [r for r in blind_recs if r.get('winner') != 'similar'
                      and r.get('winner') in (r.get('left_version'), r.get('right_version'))]
    n_dec = len(decisive_blind)
    left_dec = sum(1 for r in decisive_blind if r['winner'] == r['left_version'])
    if n_dec >= 5:
        p_pos = stats.binomtest(left_dec, n=n_dec, p=0.5, alternative='two-sided').pvalue
    else:
        p_pos = None

    position_stats[ev] = {
        'left_rate': left_rate, 'right_rate': right_rate,
        'n_blind': n, 'n_decisive': n_dec,
        'position_pvalue': p_pos,
        'suspicious': p_pos is not None and p_pos < 0.05,
    }
    flag = " ⚠️ 位置偏倚显著" if position_stats[ev]['suspicious'] else ""
    print(f"{ev}: 左边偏好={left_rate:.0%} | 右边偏好={right_rate:.0%} | p={p_pos}{flag}")

# 全局位置偏倚检验
all_blind_decisive = [r for r in all_records
                      if r.get('mode') == 'blind' and r.get('winner') != 'similar'
                      and r.get('winner') in (r.get('left_version'), r.get('right_version'))]
global_left = sum(1 for r in all_blind_decisive if r['winner'] == r['left_version'])
global_n = len(all_blind_decisive)
if global_n >= 10:
    global_p = stats.binomtest(global_left, n=global_n, p=0.5, alternative='two-sided').pvalue
    print(f"\n全局位置偏倚: 左边胜 {global_left}/{global_n} ({global_left/global_n:.1%}), p={global_p:.4f}"
          + (" ⚠️ 存在系统性位置偏倚" if global_p < 0.05 else " ✅ 未检测到系统性位置偏倚"))
```

> 若全局位置偏倚显著（p < 0.05），说明一侧版本被系统性高估，需检查是否是盲评随机化不足、或某版本在特定侧出现频率更高。单个评估者的显著位置偏倚应作为低质量信号纳入连贯性权重。

### L0.6 评分者间信度（Inter-Rater Reliability）

原始一致率（agreement rate）不校正随机一致的影响。科学报告应使用 Cohen's Kappa（2 人）或 Fleiss' Kappa（多人），对 GSB 的三分类（Vnew 胜 / Vold 胜 / 相似）做信度评估。

**Cohen's Kappa（两两评估者配对）**：

```python
def cohens_kappa(ratings1, ratings2, categories):
    """计算两评估者间的 Cohen's Kappa。
    ratings1/2: list of category labels
    categories: list of possible category values
    """
    n = len(ratings1)
    if n == 0:
        return float('nan')

    # 观测一致率
    po = sum(1 for a, b in zip(ratings1, ratings2) if a == b) / n

    # 期望一致率（随机）
    pe = 0.0
    for cat in categories:
        p1 = ratings1.count(cat) / n
        p2 = ratings2.count(cat) / n
        pe += p1 * p2

    if pe == 1.0:
        return 1.0 if po == 1.0 else float('nan')
    return (po - pe) / (1.0 - pe)


# 找出所有评估者两两共享的题目
evaluator_names = list(by_ev.keys())
CATEGORIES = [V_NEW, V_OLD, 'similar']

pairwise_kappas = []
for i in range(len(evaluator_names)):
    for j in range(i + 1, len(evaluator_names)):
        ev1, ev2 = evaluator_names[i], evaluator_names[j]
        by_q1 = {r['query_id']: r.get('winner', '') for r in by_ev[ev1]}
        by_q2 = {r['query_id']: r.get('winner', '') for r in by_ev[ev2]}
        shared = sorted(set(by_q1.keys()) & set(by_q2.keys()))
        if len(shared) < 5:
            continue
        r1 = [by_q1[q] for q in shared]
        r2 = [by_q2[q] for q in shared]
        k = cohens_kappa(r1, r2, CATEGORIES)
        pairwise_kappas.append((ev1, ev2, k, len(shared)))

mean_kappa = np.mean([k for _, _, k, _ in pairwise_kappas]) if pairwise_kappas else float('nan')
print(f"\n评分者间信度（Cohen's Kappa）：")
for ev1, ev2, k, n_shared in pairwise_kappas:
    level = 'Almost Perfect' if k > 0.8 else ('Substantial' if k > 0.6 else ('Moderate' if k > 0.4 else 'Poor'))
    print(f"  {ev1} ↔ {ev2}: κ = {k:.3f} ({level}), n = {n_shared}")
print(f"  平均 Kappa = {mean_kappa:.3f}")
```

**Fleiss' Kappa（多人同时评估同一题目）**：

当 ≥ 3 位评估者评估了同一题目时，Fleiss' Kappa 比两两 Cohen's Kappa 更高效：

```python
def fleiss_kappa(ratings_matrix):
    """计算 Fleiss' Kappa。
    ratings_matrix: list of list, 每行是一道题，每列是各评估者的判定
    每个单元格是类别标签 (str)
    """
    n_items = len(ratings_matrix)        # 题目数
    n_raters = len(ratings_matrix[0])    # 评估者数（每道题必须相同）

    # 统计每道题每个类别被选中的次数
    categories = sorted(set(r for row in ratings_matrix for r in row))
    cat_to_idx = {c: i for i, c in enumerate(categories)}

    # n_ij: 题目 i 中类别 j 被选中的次数
    n_ij = [[0] * len(categories) for _ in range(n_items)]
    for i, row in enumerate(ratings_matrix):
        for r in row:
            n_ij[i][cat_to_idx[r]] += 1

    # P_i: 每道题的评估者间一致度
    P_i = []
    for i in range(n_items):
        s = sum(n_ij[i][j] ** 2 for j in range(len(categories)))
        P_i.append((s - n_raters) / (n_raters * (n_raters - 1)))

    P_bar = np.mean(P_i)

    # p_j: 每个类别的总体比例
    p_j = [sum(n_ij[i][j] for i in range(n_items)) / (n_items * n_raters)
           for j in range(len(categories))]
    P_e = sum(p ** 2 for p in p_j)

    if P_e == 1.0:
        return 1.0 if P_bar == 1.0 else float('nan')
    return (P_bar - P_e) / (1.0 - P_e)


# 为 Fleiss' Kappa 构建评分矩阵（要求每道题评估者数一致）
# 先找出所有评估者均参与的题目
complete_qids = [qid for qid, recs in by_q.items() if len(recs) == len(by_ev)]
if len(complete_qids) >= 5:
    matrix = []
    for qid in sorted(complete_qids):
        row = [r.get('winner', '') for r in sorted(by_q[qid], key=lambda x: x['evaluator'])]
        matrix.append(row)
    fk = fleiss_kappa(matrix)
    print(f"\nFleiss' Kappa（{len(complete_qids)} 道完整题目, {len(by_ev)} 位评估者）: κ = {fk:.3f}")
else:
    print(f"\nFleiss' Kappa: 完整评估题目不足（需 ≥5，当前 {len(complete_qids)}），使用两两 Cohen's Kappa 代替")

# 决定性判定 Kappa（排除 similar 后）
dec_categories = [V_NEW, V_OLD]
dec_pairwise = []
for i in range(len(evaluator_names)):
    for j in range(i + 1, len(evaluator_names)):
        ev1, ev2 = evaluator_names[i], evaluator_names[j]
        by_q1 = {r['query_id']: r.get('winner', '') for r in by_ev[ev1]}
        by_q2 = {r['query_id']: r.get('winner', '') for r in by_ev[ev2]}
        shared = sorted(set(by_q1.keys()) & set(by_q2.keys()))
        # 只保留两人都有明确偏好的题目
        dec_shared = [q for q in shared
                      if by_q1[q] != 'similar' and by_q2[q] != 'similar']
        if len(dec_shared) < 5:
            continue
        r1 = [by_q1[q] for q in dec_shared]
        r2 = [by_q2[q] for q in dec_shared]
        k = cohens_kappa(r1, r2, dec_categories)
        dec_pairwise.append((ev1, ev2, k, len(dec_shared)))

if dec_pairwise:
    mean_dec_kappa = np.mean([k for _, _, k, _ in dec_pairwise])
    print(f"  决定性判定平均 Kappa = {mean_dec_kappa:.3f}")
```

**Kappa 判读标准（Landis & Koch）**：

| Kappa 范围 | 一致性水平 | 对分析结论的影响 |
|-----------|-----------|----------------|
| > 0.80 | Almost Perfect | 结论高度可靠 |
| 0.60–0.80 | Substantial | 结论可信，可正常解读 |
| 0.40–0.60 | Moderate | 结论存在不确定性，需标注 |
| 0.20–0.40 | Fair | 评估标准需重新对齐，结论仅作参考 |
| < 0.20 | Slight/Poor | 数据不可用于结论，需重新评估 |

> **重要区分**：全判定 Kappa（含 similar）通常低于决定性判定 Kappa（排除 similar），因为 similar 是更大的分歧空间。报告中两者都应呈现，决定性判定 Kappa 反映方向共识的核心质量。

---

## L1：总体计数

v2 格式中 `winner` 已是归一化版本名，无需额外处理。

```python
import json, os
from collections import Counter, defaultdict

RESULTS_DIR = "results"   # 评估结果目录
V_NEW = "claude_3_5"      # 新版本名（按实际调整）
V_OLD = "gpt4_turbo"      # 旧版本名（按实际调整）

all_records = []
for fname in sorted(os.listdir(RESULTS_DIR)):
    if fname.endswith('.json') and not fname.startswith('_'):
        with open(os.path.join(RESULTS_DIR, fname)) as f:
            for record in json.load(f).values():
                all_records.append(record)

total = len(all_records)

# 胜负分布
winner_counts  = Counter(r.get('winner', '')    for r in all_records)
magnitude_counts = Counter(r.get('magnitude', '') for r in all_records)
quality_counts = Counter(r.get('quality_rating', '') for r in all_records if r.get('quality_rating'))

# similar 细分：用 quality_rating 区分"都好"和"都不好"
similar_recs = [r for r in all_records if r.get('winner') == 'similar']
similar_good = sum(1 for r in similar_recs if r.get('quality_rating') in ('exceeds', 'meets'))
similar_bad  = sum(1 for r in similar_recs if r.get('quality_rating') == 'below')

print(f"总计 {total} 条")
print(f"winner 分布: {dict(winner_counts)}")
print(f"  其中 similar 细分: 都好={similar_good}, 都不好={similar_bad}")
print(f"magnitude 分布: {dict(magnitude_counts)}")
print(f"quality 分布: {dict(quality_counts)}")
```

两个维度分析：
- **胜负维度**（winner）：版本名 or "similar" — 回答"谁更好"
  - 有偏好：实际版本名（V_new / V_old）
  - 持平：`"similar"`，再由 `quality_rating` 细分为"都好"（exceeds/meets）或"都不好"（below）
- **量级维度**（magnitude）：`much_better` / `slightly_better` / `similar` — 回答"好多少"
- **质量维度**（quality_rating）：**所有场次都有值** — 回答"胜出方绝对质量如何"
  - `exceeds`（超出预期）/ `meets`（符合预期）/ `below`（低于预期）

> `similar + below`（都不好）≠ `winner=V_old + below`（旧版胜但绝对质量不达标）——前者是两版本共同缺陷，后者是新版退步。

### L1 补充：GSB 综合得分（Composite Score）

除了计数和胜率，可以用加权利分将 GSB 判定转化为可比较的综合得分，方便跨任务对比：

```python
# 评分映射：much_better=2, slightly_better=1, similar=0
# 方向：正值 = V_NEW 胜, 负值 = V_OLD 胜
SCORE_MAP = {
    'much_better': 2,
    'slightly_better': 1,
    'similar': 0,
}

# 题目级聚合（多评估者对同一题的判定取平均）
question_scores = {}
for qid, recs in by_q.items():
    scores = []
    for r in recs:
        w = r.get('winner', '')
        mag = r.get('magnitude', 'similar')
        # 计算原始分数
        raw = SCORE_MAP.get(mag, 0)
        if w == V_NEW:
            s = raw
        elif w == V_OLD:
            s = -raw
        else:
            s = 0  # similar
        # 可选：按评估者连贯性加权
        weight = weights.get(r['evaluator'], 1.0)
        scores.append(s * weight)

    if scores:
        avg_score = sum(scores) / sum(weights.get(r['evaluator'], 1.0) for r in recs)
        question_scores[qid] = {
            'score': round(avg_score, 2),
            'verdict': V_NEW if avg_score > 0 else (V_OLD if avg_score < 0 else 'tie'),
            'n_evaluators': len(recs),
        }

# 总体 GSB 综合得分
total_score = sum(qs['score'] for qs in question_scores.values())
max_possible = len(question_scores) * 2  # 理论最高分（全票 much_better for V_NEW）
normalized_score = total_score / max_possible if max_possible > 0 else 0

# 胜率计算（排除持平题）
focus_wins = sum(1 for qs in question_scores.values() if qs['verdict'] == V_NEW)
baseline_wins = sum(1 for qs in question_scores.values() if qs['verdict'] == V_OLD)
ties = sum(1 for qs in question_scores.values() if qs['verdict'] == 'tie')
decisive_total = focus_wins + baseline_wins

print(f"\nGSB 综合得分:")
print(f"  总得分: {total_score:.1f} / {max_possible}（归一化: {normalized_score:+.3f}）")
print(f"  题目级判定: {V_NEW}胜 {focus_wins} 题, {V_OLD}胜 {baseline_wins} 题, 持平 {ties} 题")
if decisive_total > 0:
    print(f"  胜率（排除持平）: {focus_wins}/{decisive_total} = {focus_wins/decisive_total:.1%}")
```

> **综合得分的优势**：单次评估内的得分可用于跨任务对比（如"本模型在上次评估得 +0.35，本次得 +0.42"），但需注意不同测试集的得分不可直接对比。归一化得分 > 0 表示新版整体占优，越接近 +1 优势越大。

---

## L2：统计显著性检验

```python
import numpy as np
from scipy import stats

# 只取有明确方向的"决定性场次"（排除 winner="similar"）
decisive = [r for r in all_records if r.get('winner') != 'similar']
n = len(decisive)
n_new = sum(1 for r in decisive if r.get('winner') == V_NEW)

print(f"决定性场次: {n}，新版胜: {n_new}（{n_new/n:.1%}）")

# 二项检验（H₀: 两版本获胜概率相等，即 p=0.5）
binom = stats.binomtest(n_new, n=n, p=0.5, alternative='two-sided')
ci = binom.proportion_ci(confidence_level=0.95, method='wilson')
print(f"p-value: {binom.pvalue:.4f}")
print(f"95% CI (Wilson): ({ci.low:.1%}, {ci.high:.1%})")

# Bootstrap CI（更稳健，用于验证）
np.random.seed(42)
labels = np.array([1 if r.get('winner') == V_NEW else 0 for r in decisive])
boot_rates = [np.mean(np.random.choice(labels, size=n, replace=True)) for _ in range(10000)]
boot_ci = np.percentile(boot_rates, [2.5, 97.5])
print(f"Bootstrap 95% CI: ({boot_ci[0]:.1%}, {boot_ci[1]:.1%})")

# 额外：区分"显著好"和"略好"的信号强度
n_new_much   = sum(1 for r in decisive if r.get('winner') == V_NEW and r.get('magnitude') == 'much_better')
n_new_slight = sum(1 for r in decisive if r.get('winner') == V_NEW and r.get('magnitude') == 'slightly_better')
print(f"新版胜中：显著好 {n_new_much}，略好 {n_new_slight}")
```

**结论判读规则**：
- `p < 0.05` → 差异显著，新版提升非偶然
- CI 下限 > 50% → 新版胜率置信区间完全在 50% 以上，结论稳健
- Wilson CI 和 Bootstrap CI 对齐 → 结论可靠
- 显著好占比高 → 提升更强烈、更可靠

**注意**：若样本量 n < 30，p 值仅供参考，优先看 CI 范围宽度（CI 越宽，置信度越低）。

### L2 补充：灵敏度分析（Sensitivity Analysis）

同时呈现两组结果：全量数据 vs 过滤低连贯评估者后的数据。若两者结论一致，结果稳健；若差异显著，说明噪声数据正在影响结论方向。

```python
COHERENCE_THRESHOLD = 0.5   # 低于此阈值视为低连贯

high_coherence_records = [
    r for r in all_records
    if weights.get(r['evaluator'], 1.0) >= COHERENCE_THRESHOLD
]

def run_binom(records):
    decisive = [r for r in records if r.get('winner') != 'similar']
    n = len(decisive)
    if n == 0: return None
    n_new = sum(1 for r in decisive if r.get('winner') == V_NEW)
    result = stats.binomtest(n_new, n=n, p=0.5)
    ci = result.proportion_ci(0.95, 'wilson')
    return {'n': n, 'rate': n_new/n, 'p': result.pvalue, 'ci': (ci.low, ci.high)}

full   = run_binom(all_records)
filtered = run_binom(high_coherence_records)

print(f"全量数据:       n={full['n']}, 新版胜率={full['rate']:.1%}, p={full['p']:.4f}, CI={full['ci'][0]:.1%}~{full['ci'][1]:.1%}")
print(f"高连贯评估者:   n={filtered['n']}, 新版胜率={filtered['rate']:.1%}, p={filtered['p']:.4f}, CI={filtered['ci'][0]:.1%}~{filtered['ci'][1]:.1%}")

delta = abs(full['rate'] - filtered['rate'])
if delta > 0.05:
    print(f"⚠️ 两组胜率差异 {delta:.1%}，噪声数据影响显著，建议优先参考高连贯组结论")
else:
    print(f"✅ 两组结论一致（差异 {delta:.1%}），结果稳健")
```

### L2 补充2：McNemar 检验（配对二分类）

二项检验和 Bootstrap 对所有决定性判定做聚合检验，但未利用配对设计信息。McNemar's test 是配对二分类数据的行业标准检验：对每道题同一评估者的配对判定，检验新版胜 vs 旧版胜的差异。

```python
def mcnemar_test(records, evaluator_field='evaluator', query_field='query_id'):
    """对配对判定做 McNemar 检验。
    只考虑同一评估者对同一题目的判定（自然配对）。
    返回 (chi2_stat, p_value, n_discordant_vnew, n_discordant_vold)
    """
    from collections import defaultdict
    # 按 (evaluator, query_id) 索引
    paired = defaultdict(dict)
    for r in records:
        key = (r[evaluator_field], r[query_field])
        paired[key] = r

    # 统计 discordant pairs: 同一评估者一题上新版胜、另一题上旧版胜
    # 但 GSB 是同一道题同时比较两版，判定本身就是配对的
    # 所以 McNemar 直接在题目级做：统计各题目多数意见
    by_q = defaultdict(list)
    for r in records:
        by_q[r[query_field]].append(r)

    b = 0  # 新版胜 → 旧版胜（新版退步）
    c = 0  # 旧版胜 → 新版胜（新版提升）
    for qid, recs in by_q.items():
        n_new = sum(1 for r in recs if r.get('winner') == V_NEW)
        n_old = sum(1 for r in recs if r.get('winner') == V_OLD)
        if n_new > n_old:
            c += 1  # 该题多数意见偏向新版
        elif n_old > n_new:
            b += 1  # 该题多数意见偏向旧版
        # n_new == n_old: 归入 tie，不进入 b/c 计数

    if b + c == 0:
        return None, 1.0, 0, 0

    # McNemar chi-squared statistic (with continuity correction)
    chi2 = (abs(b - c) - 1) ** 2 / (b + c) if (b + c) > 0 else 0
    from scipy.stats import chi2 as chi2_dist
    p = 1.0 - chi2_dist.cdf(chi2, 1)
    return chi2, p, b, c

chi2, p_mc, n_disc_old, n_disc_new = mcnemar_test(all_records)
if chi2 is not None:
    print(f"\nMcNemar 检验: χ² = {chi2:.3f}, p = {p_mc:.4f}")
    print(f"  新版胜→旧版胜: {n_disc_new} 题, 旧版胜→新版胜: {n_disc_old} 题")
    if p_mc < 0.05:
        print(f"  ✅ 新版显著占优（p < 0.05）")
    else:
        print(f"  → 差异不显著")
```

> McNemar 和 Binomial test 的关系：Binomial test 检验「胜率是否偏离 50%」，McNemar 检验「在 discordant pairs 中新版胜 vs 旧版胜是否对称」。两者互补，报告中建议同时呈现。当两检验结论一致时，结论更稳健。

### L2 补充3：效应量（Effect Size）

p 值只回答「是否存在差异」，效应量回答「差异有多大」。对于比例数据，使用 **Cohen's h**（两比例差别的标准化度量）：

```python
import math

def cohens_h(p1, p2):
    """计算两比例的 Cohen's h 效应量。
    h = 2 * (arcsin(sqrt(p1)) - arcsin(sqrt(p2)))
    判读: |h| < 0.2 = negligible, 0.2-0.5 = small, 0.5-0.8 = medium, > 0.8 = large
    """
    return 2.0 * (math.asin(math.sqrt(p1)) - math.asin(math.sqrt(p2)))

# 新版胜率 vs 随机基线 (50%)
n_decisive = len(decisive)
p_new = n_new / n_decisive if n_decisive > 0 else 0.5
p_null = 0.5

h = cohens_h(p_new, p_null)
h_level = 'Large' if abs(h) > 0.8 else ('Medium' if abs(h) > 0.5 else ('Small' if abs(h) > 0.2 else 'Negligible'))

# 新版胜率 vs 旧版胜率
p_old = (n_decisive - n_new) / n_decisive if n_decisive > 0 else 0.5
h_vs_old = cohens_h(p_new, p_old)

print(f"\n效应量 (Cohen's h):")
print(f"  新版 vs 随机: h = {h:+.3f} ({h_level})")
print(f"  新版 vs 旧版: h = {h_vs_old:+.3f}")
print(f"  新版胜率: {p_new:.1%}, 旧版胜率: {p_old:.1%}, 差值: {p_new - p_old:+.1%}")
```

> **报告规则**：当 p < 0.05 但 |h| < 0.2 时，差异虽统计显著但实际意义微弱（大样本下常见），应标注"统计显著但效应量忽略不计"。

### L2 补充4：多重比较校正（Multiple Comparison Correction）

当按题目类型、难度、评估者等多个维度做分层分析时，同时进行多次统计检验会膨胀第一类错误率（Family-Wise Error Rate）。使用 **Benjamini-Hochberg** 方法控制错误发现率（FDR）：

```python
def benjamini_hochberg(pvalues, alpha=0.05):
    """Benjamini-Hochberg FDR 校正。
    pvalues: list of (name, p_value)
    返回: list of (name, p_value, is_significant_after_correction)
    """
    sorted_p = sorted(pvalues, key=lambda x: x[1])
    n = len(sorted_p)
    results = []
    for rank, (name, p) in enumerate(sorted_p, 1):
        bh_threshold = (rank / n) * alpha
        results.append((name, p, p <= bh_threshold, bh_threshold))
    return results

# 示例：按题目类型分层检验
type_pvalues = []
for qtype, qids in type_groups.items():
    type_recs = [r for r in all_records if r['query_id'] in qids]
    type_dec = [r for r in type_recs if r.get('winner') != 'similar']
    if len(type_dec) >= 10:
        n_t = len(type_dec)
        n_new_t = sum(1 for r in type_dec if r.get('winner') == V_NEW)
        p_t = stats.binomtest(n_new_t, n=n_t, p=0.5, alternative='two-sided').pvalue
        type_pvalues.append((qtype, p_t))

if type_pvalues:
    corrected = benjamini_hochberg(type_pvalues)
    print("\n分层显著性（BH 校正后）:")
    for name, p, sig, threshold in corrected:
        flag = "✅" if sig else "→"
        print(f"  {name}: p={p:.4f}, BH阈值={threshold:.4f} {flag}")
```

> 仅在分层 ≥ 3 组时触发校正。校正后不显著的组别结论应从「确定」降级为「趋势」，避免过度解读。

---

## L3：细粒度拆分

### 按评估者

```python
by_ev = defaultdict(list)
for r in all_records: by_ev[r['evaluator']].append(r)

for ev, recs in sorted(by_ev.items()):
    n_ev = len(recs)
    decisive_ev = [r for r in recs if r.get('winner') != 'similar']
    n_dec = len(decisive_ev)
    n_new_wins = sum(1 for r in decisive_ev if r.get('winner') == V_NEW)
    v_rate = n_new_wins / n_dec if n_dec > 0 else None

    similar_ev = [r for r in recs if r.get('winner') == 'similar']
    similar_rate = len(similar_ev) / n_ev
    similar_bad  = sum(1 for r in similar_ev if r.get('quality_rating') == 'below')
    below_rate   = sum(1 for r in decisive_ev if r.get('quality_rating') == 'below') / n_dec if n_dec > 0 else 0

    print(f"{ev}: n={n_ev}, 新版胜率={v_rate:.0%}, similar率={similar_rate:.0%}, "
          f"similar中都不好={similar_bad}, 低于预期率={below_rate:.0%}")
```

> **similar 率高**（≥30%）的评估者，倾向于认为两版本差不多；再看 `similar + below` 的数量区分"都好"还是"都不好"。
> **低于预期率高**的评估者，绝对质量标准更严苛。
> **新版胜率差异大**（>30% 的差距）的评估者之间，需检查评估标准是否一致。

### 按题目

```python
by_q = defaultdict(list)
for r in all_records: by_q[r['query_id']].append(r)

q_stats = {}
for qid, recs in sorted(by_q.items()):
    n_ev = len(recs)
    n_new  = sum(1 for r in recs if r.get('winner') == V_NEW)
    n_old  = sum(1 for r in recs if r.get('winner') == V_OLD)
    n_sim  = sum(1 for r in recs if r.get('winner') == 'similar')
    n_sim_bad = sum(1 for r in recs if r.get('winner') == 'similar' and r.get('quality_rating') == 'below')
    majority = V_NEW if n_new > n_old else (V_OLD if n_old > n_new else 'split')
    consensus = max(n_new, n_old) / n_ev if n_ev else 0
    qc = Counter(r.get('quality_rating', '') for r in recs if r.get('quality_rating'))
    q_stats[qid] = {
        V_NEW: n_new, V_OLD: n_old, 'similar': n_sim, 'similar_bad': n_sim_bad,
        'quality': dict(qc), 'n': n_ev, 'majority': majority, 'consensus': consensus,
    }
    print(f"{qid}: 新={n_new} 旧={n_old} similar={n_sim}(其中都不好={n_sim_bad}) → {majority} ({consensus:.0%})")
```

重点关注：
- **高共识新版胜**（consensus ≥ 60%）→ 新版真正有提升的案例
- **高共识旧版胜**（consensus ≥ 50%）→ 新版退步，需 bad case 分析
- **`similar + below` 占比高**（在 n≥3 的题目中 ≥ 50%）→ 该 query 两个版本都不好
- **低于预期集中的题目** → 揭示系统性质量问题

### winner × quality_rating 交叉分析

```python
cross = Counter((r.get('winner', ''), r.get('quality_rating', '')) for r in all_records)
print("\nwinner × quality_rating 交叉表:")
for w in [V_NEW, V_OLD, 'similar']:
    for qr in ['exceeds', 'meets', 'below']:
        cnt = cross.get((w, qr), 0)
        if cnt:
            print(f"  winner={w:15s} + {qr:8s}: {cnt}")
```

> 交叉分析揭示重要组合：
> - `winner=V_new + below`：新版虽然相对更好但绝对质量仍不达标（"矮子里拔高个"）
> - `winner=V_new + exceeds`：新版胜出且质量很好——最强的提升信号
> - `winner=V_old + meets/exceeds`：旧版更好且质量尚可——新版退步的 bad case
> - `winner=similar + below`：两版都不好——共同系统性缺陷

### 评估者间一致性

```python
shared_qs = [qid for qid, recs in by_q.items() if len(recs) >= 2]

all_pairs, dec_pairs = [], []
for qid in shared_qs:
    winners = [r.get('winner', '') for r in by_q[qid]]
    pairs = [(winners[i], winners[j]) for i in range(len(winners)) for j in range(i+1, len(winners))]
    all_pairs.extend([1 if a == b else 0 for a, b in pairs])
    dec = [w for w in winners if w != 'similar']
    if len(dec) >= 2:
        dpairs = [(dec[i], dec[j]) for i in range(len(dec)) for j in range(i+1, len(dec))]
        dec_pairs.extend([1 if a == b else 0 for a, b in dpairs])

print(f"全判定一致率: {np.mean(all_pairs):.1%}（含 similar 的分歧）")
print(f"决定性判定一致率: {np.mean(dec_pairs):.1%}（有明确偏好时的方向一致率）")
```

> 全判定一致率通常较低（30-40%），因为 similar 选择分散。
> 决定性判定一致率是更有意义的指标，60% 以上说明方向判断有基本共识。

### 按题目类型 / 难度分层（Stratified Analysis）

若每道题有类型标签（如商品知识、商品对比、值不值得买）或难度标签，应做分层胜率分析。分层结论比总胜率更有指导意义——不同题型的表现差异可能指向模型在特定能力上的强弱。

```python
# 假设题目元数据来自 _config.json 或外部标注文件
# question_meta[qid] = {"type": "值不值得买", "difficulty": "hard", ...}
# 实际使用时按数据来源读取

# 方法1：若元数据来自 _config.json
import json
config_path = os.path.join(RESULTS_DIR, '_config.json')
question_meta = {}
if os.path.exists(config_path):
    with open(config_path) as f:
        config = json.load(f)
    # 假设 config["question_types"] = {"Q_0001": "商品知识", ...}
    question_meta = config.get('question_types', {})

# 方法2：若题目 ID 中包含类型信息（如 Q_type_qid），从 ID 中解析
# 或由 Agent 读取题目原文件后人工标注类型

# 按类型分组统计
type_groups = defaultdict(list)
for qid, qs in question_scores.items():
    qtype = question_meta.get(qid, '未分类')
    type_groups[qtype].append(qid)

print("\n=== 按题目类型分层 ===")
type_stats = []
for qtype, qids in sorted(type_groups.items(), key=lambda x: -len(x[1])):
    type_scores = [question_scores[qid]['score'] for qid in qids]
    type_focus = sum(1 for qid in qids if question_scores[qid]['verdict'] == V_NEW)
    type_base = sum(1 for qid in qids if question_scores[qid]['verdict'] == V_OLD)
    type_tie = sum(1 for qid in qids if question_scores[qid]['verdict'] == 'tie')
    n_dec_type = type_focus + type_base

    # 对该类型做统计检验
    if n_dec_type >= 5:
        type_p = stats.binomtest(type_focus, n=n_dec_type, p=0.5, alternative='two-sided').pvalue
        type_ci = stats.binomtest(type_focus, n=n_dec_type, p=0.5).proportion_ci(0.95, 'wilson')
        type_win_rate = type_focus / n_dec_type
        type_h = cohens_h(type_win_rate, 0.5)
        hlevel = 'Large' if abs(type_h) > 0.8 else ('Medium' if abs(type_h) > 0.5 else ('Small' if abs(type_h) > 0.2 else 'Negligible'))
    else:
        type_p = None
        type_ci = None
        type_win_rate = n_dec_type / n_dec_type if n_dec_type > 0 else None
        type_h = None
        hlevel = None

    # below 分析：该类型中 below 的题目
    type_below_questions = set()
    for qid in qids:
        for r in by_q.get(qid, []):
            if r.get('quality_rating') == 'below':
                type_below_questions.add(qid)

    stat = {
        'type': qtype,
        'n': len(qids),
        'score_mean': np.mean(type_scores),
        'focus_wins': type_focus,
        'baseline_wins': type_base,
        'ties': type_tie,
        'focus_rate': round(type_win_rate, 3) if type_win_rate else None,
        'pvalue': round(type_p, 4) if type_p else None,
        'ci_low': round(type_ci.low, 3) if type_ci else None,
        'ci_high': round(type_ci.high, 3) if type_ci else None,
        'cohens_h': round(type_h, 3) if type_h else None,
        'h_level': hlevel,
        'below_questions': len(type_below_questions),
        'low_sample': n_dec_type < 5,  # 标记小样本
    }
    type_stats.append(stat)

    sample_warning = " ⚠️ 样本不足" if stat['low_sample'] else ""
    h_str = f"h={type_h:+.3f}" if type_h else "h=N/A"
    print(f"{qtype}: n={len(qids)}, 得分均值={np.mean(type_scores):+.2f}, "
          f"胜率={stat['focus_rate']}, {h_str}, p={type_p}{sample_warning}")

# 对分层做多重比较校正（≥ 3 层且有 p 值）
type_pvalues = [(s['type'], s['pvalue']) for s in type_stats if s['pvalue'] is not None]
if len(type_pvalues) >= 3:
    corrected = benjamini_hochberg(type_pvalues)
    print("\n分层 BH 校正后:")
    for name, p, sig, threshold in corrected:
        flag = "✅ 显著" if sig else "→ 不显著"
        print(f"  {name}: p={p:.4f}, BH阈值={threshold:.4f} {flag}")
```

> **分层报告原则**：
> - 每层必须带效应量和 CI，不可仅报告胜率。
> - 样本量 < 5 的分层标注"样本不足，仅供趋势参考"。
> - ≥ 3 层时必须做 BH 校正。
> - 若某题型新版显著胜出（p < 0.05 且 |h| > 0.5），这是最强的提升信号。
> - 若某题型新版显著退步，这是高优修复目标。
> - 分层结果应作为报告第 3 节"核心结果 + 题型拆分"的数据源。

### 按难度 / 其他维度分层

若有难度标签，同理可做按难度的分层。代码结构相同，替换分组 key 即可：

```python
# 按难度分层
difficulty_groups = defaultdict(list)
for qid, qs in question_scores.items():
    diff = question_meta.get(qid, {}).get('difficulty', 'normal')
    difficulty_groups[diff].append(qid)

for diff, qids in sorted(difficulty_groups.items()):
    # ... 同上分层统计逻辑
    pass
```

分层维度建议（按数据可用性选择）：
- **题目类型**（最常用）：商品知识 / 商品对比 / 值不值得买 / 商品推荐 / 多轮对话 / ...
- **难度**：简单 / 中等 / 困难
- **是否多轮**：单轮 / 多轮
- **领域/行业**：家电 / 数码 / 服装 / 美妆 / 食品 / ...

> 报告中选择 1-2 个最重要的分层维度展开，不宜过多。通常题目类型是必做维度。

---

从评论中归纳根因。评估格式提供 5 个评论字段，信息丰富。

### 分类标签

| 类别 | 对应判定 | 改进方向 |
|------|---------|---------|
| **新版取胜根因** | winner=V_new（显著+略好） | 保持并加强这些优势 |
| **新版退步根因** | winner=V_old（显著+略好） | 高优修复 |
| **都不好根因** | winner="similar" + quality_rating="below" | 两版共同问题 |
| **低于预期根因** | quality_rating="below"（含有明确偏好的场次） | 虽然相对更好但绝对质量不达标，需策略层改进 |

### 根因归纳方法

L4 是定性分析，没有固定代码——需要阅读每条有评论的记录，从中提炼模式。步骤：

**第一步：提取所有非空评论**

```python
def collect_comments(r):
    """汇总一条记录的所有评论（v2 格式：按版本名直接读取）"""
    parts = []
    comments = r.get('comments', {})
    for version_name, c in comments.items():
        if version_name == 'general':
            if c and str(c).strip():
                parts.append(f"  共同评价: {c}")
        elif isinstance(c, dict):
            pros = c.get('pros', '').strip()
            cons = c.get('cons', '').strip()
            if pros: parts.append(f"  {version_name} 优点: {pros}")
            if cons: parts.append(f"  {version_name} 缺点: {cons}")
    return '\n'.join(parts)

for r in all_records:
    comments = collect_comments(r)
    if comments:
        winner = r.get('winner', '')
        magnitude = r.get('magnitude', '')
        qr = r.get('quality_rating', '')
        qr_label = {'exceeds': '🌟超出预期', 'meets': '✅符合预期', 'below': '⚠️低于预期'}.get(qr, '')
        label = f"similar({qr_label})" if winner == 'similar' else f"{winner}胜({magnitude}) {qr_label}"
        print(f"[{label}] {r['evaluator']} / {r['query_id']}:")
        print(comments)
        print()
```

**第二步：阅读评论，按 4 类归纳模式**

对每类（Vnew 赢 / Vold 赢 / both_bad / 低于预期）：
- 找出被多人提及的共同批评或赞扬（出现 ≥2 次的点优先）
- 归纳为一句话标签（如"新版使用了用户无法理解的术语"）
- 摘录 1-2 条最有代表性的原话作为佐证
- 区分"显著好"和"略好"的评论——显著好的评论通常揭示更核心的差异

**第三步：识别任务相关的根因维度**

不同类型的 GSB 任务，根因会有所不同，但通常围绕以下几个通用维度展开：

| 维度 | 新版可能的优势 | 新版可能的退步 |
|------|--------------|--------------|
| **准确性** | 旧版存在幻觉/事实错误 | 新版引入新的错误 |
| **信息完整性** | 新版覆盖更多关键维度 | 新版遗漏重要信息 |
| **语言质量** | 表达更流畅/口语化 | 用词更复杂/生硬 |
| **相关性** | 更精准回应用户意图 | 答非所问或偏题 |
| **冗余度** | 去除了无效内容 | 引入了新的冗余 |
| **格式/结构** | 组织更清晰 | 结构混乱或过长 |

`similar + below`（都不好）和低于预期案例的常见共性根因（跨任务通用）：
- **任务本身超出合理范围**：两个版本都没有识别出这是一个不该直接回答/需要拒绝的 case
- **两版本共同遗漏了核心信息**：在这个维度上版本差异无意义
- **领域知识缺失**：两版都不了解该领域的关键约束（如法规、时效性等）

### L4 补充：自然语言定性反馈的结构化分析

定量统计（胜率、p 值、效应量）告诉我们"谁赢了多少"，但评估者写下的自然语言 comment 告诉我们"为什么这么判断"。定性与定量结合才能形成完整的分析。

#### 反馈分析方法论

```
定量统计（L1-L3）         定性反馈（L4）
    ↓                       ↓
  胜率 + CI + 效应量  ←→  comment 归纳的模式
    ↓                       ↓
  数字告诉"谁赢"          评论告诉"为什么赢/输"
    ↓                       ↓
        综合 → 结论 + 行动建议
```

#### 结构化 comment 提取

```python
def extract_structured_comments(all_records, V_NEW, V_OLD):
    """将所有评估者的 comment 按判定类型归类，输出结构化反馈表。"""
    structured = {
        'vnew_wins': [],        # V_NEW 胜出场次的 comment
        'vold_wins': [],        # V_OLD 胜出场次的 comment
        'both_bad': [],         # similar + below 的 comment
        'vnew_but_below': [],   # V_NEW 胜但质量 below 的 comment
        'exceeds': [],          # 质量 exceeds 的 comment（亮点）
    }

    for r in all_records:
        entry = {
            'query_id': r['query_id'],
            'evaluator': r['evaluator'],
            'winner': r.get('winner', ''),
            'magnitude': r.get('magnitude', ''),
            'quality_rating': r.get('quality_rating', ''),
            'pros': {},
            'cons': {},
            'general': '',
        }
        comments = r.get('comments', {})
        for version_name, c in comments.items():
            if version_name == 'general':
                entry['general'] = str(c).strip() if c else ''
            elif isinstance(c, dict):
                entry['pros'][version_name] = c.get('pros', '').strip()
                entry['cons'][version_name] = c.get('cons', '').strip()

        w = r.get('winner', '')
        qr = r.get('quality_rating', '')
        if w == V_NEW and qr == 'below':
            structured['vnew_but_below'].append(entry)
        elif w == V_NEW:
            structured['vnew_wins'].append(entry)
        elif w == V_OLD:
            structured['vold_wins'].append(entry)
        elif w == 'similar' and qr == 'below':
            structured['both_bad'].append(entry)
        if qr == 'exceeds':
            structured['exceeds'].append(entry)

    return structured

feedback = extract_structured_comments(all_records, V_NEW, V_OLD)
for cat, entries in feedback.items():
    print(f"\n{cat}: {len(entries)} 条")
```

#### Comment 聚合与模式归纳

不要罗列所有原始 comment。按以下步骤聚合：

**第 1 步：按主题聚类**
阅读每个类别（V_NEW 赢 / V_OLD 赢 / both_bad / below）中的 comment，识别 ≥ 2 次出现的共同赞扬或批评。例如：

```
V_NEW 赢的 comment 中反复出现的正向点：
- "回答更简洁，直接给结论"（出现 8 次）
- "商品推荐更贴合用户场景"（出现 5 次）
- "表格对比让选择更清晰"（出现 4 次）

V_OLD 赢的 comment 中反复出现的负向点：
- "新版本没有先分析用户需求就直接推荐"（出现 6 次）
- "遗漏了关键约束条件"（出现 4 次）
- "商品卡不相关或过时"（出现 3 次）
```

**第 2 步：提炼问题簇 / 能力簇**
将同主题合并为可命名的问题簇。问题簇命名要具体、可指导改进：

| 推荐命名 | 不推荐命名 |
|---------|-----------|
| "决策题没有真正接住用户纠结" | "用户意图与场景" |
| "对比题缺少稳定的差异框架" | "信息完整性" |
| "商品推荐和约束匹配不稳定" | "准确性" |
| "高风险场景信息深度不足" | "其他问题" |

**第 3 步：摘录代表性原话**
每个问题簇摘录 1-2 条最具有代表性的评估者原话作为佐证。原话摘录原则：
- 保留能直接看出问题的片段
- 标注评估者和题目 ID
- 合并同义 comment

```python
# 辅助：按关键词搜索 comment
def search_comments(feedback_category, keywords):
    """在指定类别的 feedback 中搜索包含关键词的 comment。"""
    matches = []
    for entry in feedback_category:
        text = entry['general'] + ' '.join(entry['cons'].values()) + ' '.join(entry['pros'].values())
        if any(kw in text for kw in keywords):
            matches.append(entry)
    return matches

# 示例：找出 V_OLD 胜出场次中提到"需求理解"的 comment
need_understanding = search_comments(feedback['vold_wins'], ['需求', '意图', '理解'])
for e in need_understanding[:5]:
    print(f"  {e['evaluator']} / {e['query_id']}: {e['general'][:120]}...")
```

#### 定性反馈在报告中的呈现

在 HTML 报告中，定性与定量应交织呈现而非割裂：

```
第 7 节「根因分析」的推荐结构：

  定量骨架                    定性血肉
  ─────────                  ─────────
  新版胜率 58%        ←→     "回答更简洁直接"（8位评估者提及）
  效应量 h=+0.32      ←→     "表格对比让选择更清晰"（5位）
  p=0.012             ←→     "商品推荐贴合场景"（4位）

  新版退步 25%        ←→     "没有先分析需求就推荐"（6位）
  旧版胜率高共识题    ←→     具体 case 的 comment 原文
                      ←→     "遗漏关键约束条件"（4位）
```

> 详细的 case 分析报告写作规范见 [`references/case-analysis-report.md`](references/case-analysis-report.md)，其中包括问题簇命名、case 选择原则、双版本对比展示、comment 使用规范和可执行改进动作的写法。

---

锚点题最有战略价值的用法——用评估者在锚点题上的判定模式做聚类，识别系统性偏好分歧。

**适用条件**：锚点题 ≥ 3 道，且评估者 ≥ 6 人。

```python
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler
import numpy as np

# 将每位评估者在所有题目上的判定编码为特征向量
all_qids = sorted(by_q.keys())

def encode_side(s):
    return +1 if s == 'Vnew_wins' else (-1 if s == 'Vold_wins' else 0)

ev_feature_matrix = {}
for ev, recs in by_ev.items():
    by_qid = {r['query_id']: r for r in recs}
    vec = [encode_side(by_qid[q]['norm_side']) if q in by_qid else 0 for q in all_qids]
    ev_feature_matrix[ev] = vec

ev_names = list(ev_feature_matrix.keys())
X = np.array([ev_feature_matrix[ev] for ev in ev_names])

# K-Means 聚类（K=2 适合多数场景；可尝试 K=3）
K = 2
km = KMeans(n_clusters=K, random_state=42, n_init=10)
labels = km.fit_predict(X)

# 输出分群结果
for k in range(K):
    group_evs = [ev_names[i] for i, l in enumerate(labels) if l == k]
    group_recs = [r for r in all_records if r['evaluator'] in group_evs]
    decisive = [r for r in group_recs if r['norm_side'] in ('Vnew_wins', 'Vold_wins')]
    n_new = sum(1 for r in decisive if r['norm_side'] == 'Vnew_wins')
    rate = n_new / len(decisive) if decisive else 0
    print(f"群体 {k+1}（{len(group_evs)} 人）: {group_evs}")
    print(f"  新版胜率 = {rate:.1%}（决定性场次 {len(decisive)} 条）")
```

**报告分群结论时的建议格式**：

```
群体 A（n=4）：倾向于重视准确性，新版胜率 72%
群体 B（n=3）：倾向于重视表达流畅性，新版胜率 41%

→ 若目标用户更接近群体 A，新版表现显著更好；
  若目标用户更接近群体 B，新版可能不如旧版。
  建议对照目标用户画像选择参考哪一组结论。
```

与其报告一个被平均掉的总胜率，不如明确偏好分歧——这对产品决策更有指导意义。

---

## HTML 报告生成

### 报告结构（推荐）

```
0. 元数据页眉：任务名称、对比版本、参与人数、评估时间、报告生成时间（方便回溯）
1. 页眉 + 6个核心指标卡（新版胜率 / p值 / 效应量Cohen's h / both_bad率 / 评估者一致率 / 平均Kappa）
2. 统计显著性：CI 可视化（全量 vs 高连贯组）+ Bootstrap 分布直方图 + 6类判定分布卡
3. 总体分布：verdict donut chart（6类）+ 决定性场次 bar chart（区分显著/略好）
4. 胜出方质量分布：超出预期/符合预期/低于预期 三档 + 判定×质量交叉表
5. 评估者画像：stacked bar chart + 详细表格（含连贯性得分 + Kappa配对矩阵 + both_bad率 + 质量评价分布）
6. 题目粒度：card grid（按多数意见着色 + 共识度标注）
7. 根因分析：4列卡片（新版赢 / 新版输 / both_bad / 低于预期）+ 评论引用
8. 评估者聚类（若适用）：分群胜率 + 偏好解读
9. 信度与偏倚说明：评分者间信度（Cohen's Kappa / Fleiss' Kappa）+ 位置偏倚检测结果
10. 结论与行动建议：优先级列表（高优修复退步 > 中优系统性改进 > 低优巩固优势）
11. 局限性说明：样本量不足的分层、低信度维度、已知偏倚
```

### 技术选型

- 纯 HTML + Chart.js（CDN），无构建步骤，单文件可直接分发或邮件附件
- 所有数据内联到 `<script>` 中，Chart.js 加载成功后离线可用
- Agent 直接生成完整 HTML 文件，**不依赖预置模板**（每次任务数据结构不同，按需生成）

### 数据对象约定

Agent 生成 HTML 前，先在 Python 中整理好数据对象，再内联到 `<script>` 中：

```python
from datetime import datetime

report_data = {
    "meta": {
        "title": f"{V_OLD} vs {V_NEW} 评估报告",  # ← 按实际版本语义填写
        "v_new": V_NEW,
        "v_old": V_OLD,
        "total": total,
        "n_evaluators": len(by_ev),
        "n_questions": len(by_q),
        # ⚠️ 必填元数据（每次报告必须记录，方便回溯）
        "task_name": "",                # 评估任务名称（如 "P2-RL0420 vs P2-RL0413 上线前评估"）
        "evaluator_names": list(by_ev.keys()),  # 参与评估者名单
        "evaluation_period": {          # 评估进行的时间范围
            "start": "",                # 最早 timestamp
            "end": "",                  # 最晚 timestamp
        },
        "report_generated_at": datetime.now().isoformat(),  # 报告生成时间
        "analysis_version": "2.0",      # 分析方法版本号
    },
    "winner_counts":    dict(winner_counts),    # {V_NEW: n, V_OLD: n, "similar": n}
    "magnitude_counts": dict(magnitude_counts), # {much_better, slightly_better, similar}
    "quality_counts":   dict(quality_counts),   # {exceeds, meets, below}
    "similar_breakdown": {"good": similar_good, "bad": similar_bad},
    "decisive": {
        "n": n,
        "n_new": n_new,
        "n_new_much": n_new_much,
        "n_new_slight": n_new_slight,
        "rate": round(n_new / n, 3) if n else 0,
    },
    "significance": {
        "pvalue": round(binom.pvalue, 4),
        "ci_low": round(ci.low, 3),
        "ci_high": round(ci.high, 3),
        "boot_ci_low": round(boot_ci[0], 3),
        "boot_ci_high": round(boot_ci[1], 3),
        # 新增：效应量与 McNemar
        "cohens_h": round(h, 3),
        "cohens_h_level": h_level,
        "win_rate_delta": round(p_new - p_old, 3),  # 胜率差值
        "mcnemar_chi2": round(chi2, 3) if chi2 else None,
        "mcnemar_pvalue": round(p_mc, 4) if chi2 else None,
    },
    "reliability": {                           # 新增：评分者间信度
        "mean_cohens_kappa": round(mean_kappa, 3) if not np.isnan(mean_kappa) else None,
        "mean_decisive_kappa": round(mean_dec_kappa, 3) if dec_pairwise else None,
        "fleiss_kappa": round(fk, 3) if 'fk' in dir() else None,
        "kappa_level": (                       # Landis-Koch 判读
            "Almost Perfect" if mean_kappa > 0.8 else
            "Substantial" if mean_kappa > 0.6 else
            "Moderate" if mean_kappa > 0.4 else
            "Fair" if mean_kappa > 0.2 else "Poor"
        ) if not np.isnan(mean_kappa) else None,
    },
    "position_bias": {                         # 新增：位置偏倚检测
        "global_left_rate": round(global_left / global_n, 3) if global_n >= 10 else None,
        "global_pvalue": round(global_p, 4) if global_n >= 10 else None,
        "has_global_bias": global_p < 0.05 if global_n >= 10 else None,
    },
    "cross_table": {                            # winner × quality_rating 交叉计数
        f"{w}_{qr}": cross.get((w, qr), 0)
        for w in [V_NEW, V_OLD, 'similar']
        for qr in ['exceeds', 'meets', 'below']
    },
    "evaluators": {                             # name → 胜负计数 + similar率 + 质量分布
        ev: {
            "total": len(recs),
            "v_new": sum(1 for r in recs if r.get('winner') == V_NEW),
            "v_old": sum(1 for r in recs if r.get('winner') == V_OLD),
            "similar": sum(1 for r in recs if r.get('winner') == 'similar'),
            "similar_bad": sum(1 for r in recs if r.get('winner') == 'similar' and r.get('quality_rating') == 'below'),
            "quality": dict(Counter(r.get('quality_rating','') for r in recs if r.get('quality_rating'))),
        }
        for ev, recs in by_ev.items()
    },
    "questions": {                              # qid → 判定计数 + 质量分布 + 多数意见 + 共识度
        qid: s for qid, s in q_stats.items()
    },
    "agreement": {
        "all_winners": round(np.mean(all_pairs), 3),
        "decisive_only": round(np.mean(dec_pairs), 3),
    },
}
import json
print(json.dumps(report_data, ensure_ascii=False, indent=2))
```

---

## 分析结论表述规范

输出结论时建议按以下结构组织，确保有分析深度而非只是数字展示：

```
结论 1（核心问题）：新版是否显著优于旧版？
  → 给出胜率 + p值 + CI + 效应量(Cohen's h)，明确说"显著"还是"不显著"
  → 区分"显著好"和"略好"的比例，量化提升强度
  → 若效应量 |h| < 0.2 但 p < 0.05，标注"统计显著但效应量微弱"

结论 2（质量达标）：胜出方的绝对质量如何？
  → 质量评价三档分布（超出预期/符合预期/低于预期）
  → "Vnew_wins + below"说明相对更好但绝对不达标

结论 3（新版优势）：新版在哪些维度/案例上赢？
  → 列举高共识题目 + 根因标签 + 评论引用
  → 区分显著好和略好的案例，显著好更值得分析

结论 4（新版退步）：新版有哪些 bad case？
  → 重点！列举 V_old 胜出的题目，分析退步根因

结论 5（系统性问题）：similar+below 和低于预期标记揭示了什么？
  → similar+below（都不好）说明两版共同的系统性不足

结论 6（置信度说明）：评估者一致性和信度如何？结论可靠吗？
  → Kappa 值和判读水平（Almost Perfect / Substantial / Moderate / Fair / Poor）
  → McNemar 和 Binomial test 结论是否一致
  → 低 Kappa 需说明原因（标准不统一？主观性强？）
  → 位置偏倚是否影响结论

行动建议：按优先级排列（高优=修复退步 > 中优=系统性问题 > 低优=巩固优势）
  每项建议附带效应量参考——大效应量的提升/退步值得更高优先级
```

---

## 局限性说明模板

每份报告必须包含局限性说明，不粉饰不回避。模板如下：

```
### 局限性说明

**样本量**：
- 总评估记录 {total} 条，{n_questions} 道题目，{n_evaluators} 位评估者
- [若 n_evaluators < 3] 仅 {n_evaluators} 人参与，结论仅作参考
- [若某分层 n < 10] 分层"{name}"样本量不足，结论标注为"趋势"

**信度**：
- 平均 Cohen's Kappa = {kappa}（{level}）
- [若 Kappa < 0.4] 评估者间一致性较低，结论存在不确定性
- [若 Fleming' Kappa < 0.4] 多人一致性不足，建议对齐评估标准后重新评估

**偏倚**：
- [若存在位置偏倚] 检测到全局位置偏倚（p={p_val}），可能影响结论方向
- [若低连贯评估者影响] 全量 vs 高连贯组胜率差异 {delta}，[描述差异]

**覆盖度**：
- 测试集覆盖 {n_domains} 个领域 / {n_types} 种题型
- [未覆盖的场景] 本次评估未覆盖 [列举]，结论不适用于这些场景
- [测试集代表性] 测试集来源于 [来源]，[说明是否代表真实用户分布]

**评估者代表性**：
- 评估者背景：[描述评估者专业背景]
- [若评估者同质化] 评估者来自同一团队，可能存在群体偏好偏倚
```

---

## 科学报告检查清单

生成每份 GSB 评估报告前，逐项确认：

### 必须包含（不可省略）

- [ ] **元数据完整**：任务名称、对比版本、参与人数与名单、评估时间范围、报告生成时间
- [ ] **全量数据概览**：总记录数、题目数、评估者数、有效 vs 剔除记录
- [ ] **GSB 分布**：新版胜（显著/略好）、旧版胜（显著/略好）、相似（都好/都不好）
- [ ] **统计检验**：p 值 + 95% CI（Wilson + Bootstrap）+ 效应量（Cohen's h）+ McNemar 检验
- [ ] **质量交叉分析**：winner × quality_rating 交叉表
- [ ] **评分者间信度**：Cohen's Kappa（两两平均）+ Fleiss' Kappa（若多人评同题）
- [ ] **灵敏度分析**：全量 vs 高连贯组对比
- [ ] **位置偏倚检测**：全局位置偏倚 p 值
- [ ] **结论与行动建议**：按优先级排序，带效应量参考
- [ ] **局限性说明**：样本量、信度、偏倚、覆盖度

### 建议包含（提升完备性）

- [ ] **分层分析**：按题目类型/领域/难度的胜率 + CI（若 ≥ 3 层，做 BH 校正）
- [ ] **Bootstrap 分布直方图**：展示胜率估计的不确定性形态
- [ ] **Kappa 配对矩阵热图**：可视化评估者间信度结构
- [ ] **评估者聚类**：若 ≥ 6 人 + ≥ 3 道锚点题，做偏好分群
- [ ] **根因分类**：按 4 类归纳评论模式

### 不应出现的错误

- [ ] 未校正随机一致的"一致率"代替 Kappa
- [ ] 仅报告 p 值不报告效应量和 CI
- [ ] 分层检验未做多重比较校正
- [ ] 小样本（n < 30）结论语气过于确定
- [ ] 忽略评估者间系统性差异
- [ ] 缺少元数据导致报告无法回溯

---

## 常见陷阱

| 陷阱 | 说明 |
|------|------|
| 把 `similar` 当单一类别统计 | `similar` 中 `quality_rating="below"` 是"都不好"，`exceeds/meets` 是"都好"，语义截然不同，必须分开 |
| 只看判定不看质量评价 | 高"低于预期"率意味着虽然"新版更好"但绝对质量仍不达标 |
| 忽略 winner × quality 交叉分析 | `winner=V_new + below` 是"矮子里拔高个"，不能当作真正的提升 |
| 错误读取评论字段 | v2 格式评论在 `comments[版本名]["pros"]`，不是 `comment_left_pros`；读错字段会得到空数据 |
| 忽略量级差异 | `much_better` 和 `slightly_better` 的信号强度不同，`much_better` 更可靠 |
| 忽略评估者差异 | 一个超严苛评估者会拉高 `similar+below` 率，稀释真实的胜率信号 |
| 用全判定一致率评判可靠性 | 决定性判定一致率（排除 similar）才是方向共识的有效指标 |
| 样本量过小时过度解读 p 值 | n < 30 的题目级结论，说"趋势"而非"结论" |
| 遗漏 `_config.json` / `_reviews.json` | 读取 results 目录时应跳过 `_` 开头的配置文件 |
| 直接剔除低连贯评估者 | 应使用加权（权重 ≥ 0.1），避免误杀有独立偏好的认真评估者 |
| 用整体胜率代替分群胜率 | 当聚类分析发现两个群体胜率差异 >20% 时，总胜率会掩盖偏好分歧，产生误导 |
| 无锚点题时跳过 L0 | 仍可做行为信号检测（作答时长、全 same 率、位置偏好）作为质量辅助判据 |
| 把高"全same率"评估者直接标为噪声 | same 偏好也可能是真实的"差不多"判断，需结合作答时长综合判断 |
| 只看 p 值不关注效应量 | 大样本下微小差异也显著（p < 0.05 但 Cohen's h < 0.2），应标注"效应量忽略不计" |
| 分层分析不做多重比较校正 | 按 ≥ 3 组维度分层时，逐组检验不校正会膨胀第一类错误，应使用 BH FDR 校正 |
| 用原始一致率代替 Kappa | 原始一致率不校正随机一致，GSS 3 分类中随机一致期望 ≈ 33%，需使用 Cohen's Kappa 或 Fleiss' Kappa |
| 忽略位置偏倚 | 盲评中位置偏倚可能系统性高估一侧版本，应在 L0 阶段检测 |
| 报告缺少元数据 | 无任务名称、参与人数、评估时间、报告时间的报告无法回溯，严重影响长期使用价值 |
