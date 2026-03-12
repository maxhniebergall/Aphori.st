#!/usr/bin/env python3
"""
Analyze whether i-node count or child reply count better predicts delta awards.

Reads the benchmark JSON for delta_reply_ids, queries the DB for per-reply
i-node counts and child reply counts, then computes correlations and effect sizes.
"""

import json
import sys
import psycopg2
import numpy as np
from scipy import stats

INPUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/benchmark-replycount.json'
DB_URL = 'postgresql://chitin:chitin_dev@localhost:5432/chitin'

with open(INPUT) as f:
    data = json.load(f)

threads = data['threads']

# Collect all delta and non-delta reply IDs across threads
all_delta_ids = set()
all_reply_ids = set()
for t in threads:
    for alg_results in t['algorithms'].values():
        for r in alg_results:
            all_reply_ids.add(r['id'])
        break  # all algorithms have the same reply IDs
    all_delta_ids.update(t['delta_reply_ids'])

print(f'Threads: {len(threads)}')
print(f'Total replies: {len(all_reply_ids)}')
print(f'Delta replies: {len(all_delta_ids)}')
print()

conn = psycopg2.connect(DB_URL)
cur = conn.cursor()

# Count i-nodes per reply
cur.execute("""
    SELECT ar.source_id, COUNT(DISTINCT n.id) as inode_count
    FROM v3_nodes_i n
    JOIN v3_analysis_runs ar ON ar.id = n.analysis_run_id
    WHERE ar.source_type = 'reply'
    GROUP BY ar.source_id
""")
inode_counts = dict(cur.fetchall())

# Count child replies per reply
cur.execute("""
    SELECT parent_reply_id, COUNT(*) as child_count
    FROM replies
    WHERE parent_reply_id IS NOT NULL AND deleted_at IS NULL
    GROUP BY parent_reply_id
""")
child_counts = dict(cur.fetchall())

conn.close()

# Build arrays: for each reply, get (is_delta, inode_count, child_count)
deltas_inode = []
nondeltas_inode = []
deltas_child = []
nondeltas_child = []

is_delta_arr = []
inode_arr = []
child_arr = []

for rid in all_reply_ids:
    ic = inode_counts.get(rid, 0)
    cc = child_counts.get(rid, 0)
    d = rid in all_delta_ids

    is_delta_arr.append(1 if d else 0)
    inode_arr.append(ic)
    child_arr.append(cc)

    if d:
        deltas_inode.append(ic)
        deltas_child.append(cc)
    else:
        nondeltas_inode.append(ic)
        nondeltas_child.append(cc)

is_delta_arr = np.array(is_delta_arr)
inode_arr = np.array(inode_arr, dtype=float)
child_arr = np.array(child_arr, dtype=float)

# ── Descriptive statistics ──
print('=== Descriptive Statistics ===')
print(f'  I-node count  — Delta: {np.mean(deltas_inode):.2f} ± {np.std(deltas_inode):.2f}  |  Non-delta: {np.mean(nondeltas_inode):.2f} ± {np.std(nondeltas_inode):.2f}')
print(f'  Child replies — Delta: {np.mean(deltas_child):.2f} ± {np.std(deltas_child):.2f}  |  Non-delta: {np.mean(nondeltas_child):.2f} ± {np.std(nondeltas_child):.2f}')
print()

# ── Effect size (Cohen's d) ──
def cohens_d(a, b):
    na, nb = len(a), len(b)
    pooled_std = np.sqrt(((na-1)*np.std(a,ddof=1)**2 + (nb-1)*np.std(b,ddof=1)**2) / (na+nb-2))
    return (np.mean(a) - np.mean(b)) / pooled_std if pooled_std > 0 else 0

d_inode = cohens_d(deltas_inode, nondeltas_inode)
d_child = cohens_d(deltas_child, nondeltas_child)

print('=== Effect Size (Cohen\'s d) ===')
print(f'  I-node count:  d = {d_inode:.4f}')
print(f'  Child replies: d = {d_child:.4f}')
print()

# ── Point-biserial correlation ──
r_inode, p_inode = stats.pointbiserialr(is_delta_arr, inode_arr)
r_child, p_child = stats.pointbiserialr(is_delta_arr, child_arr)

print('=== Point-Biserial Correlation with Delta Status ===')
print(f'  I-node count:  r = {r_inode:.4f}, p = {p_inode:.2e}')
print(f'  Child replies: r = {r_child:.4f}, p = {p_child:.2e}')
print()

# ── Mann-Whitney U test (non-parametric) ──
u_inode, p_mw_inode = stats.mannwhitneyu(deltas_inode, nondeltas_inode, alternative='two-sided')
u_child, p_mw_child = stats.mannwhitneyu(deltas_child, nondeltas_child, alternative='two-sided')

# Rank-biserial correlation (effect size for Mann-Whitney)
n1, n2 = len(deltas_inode), len(nondeltas_inode)
rbc_inode = 1 - (2 * u_inode) / (n1 * n2)
rbc_child = 1 - (2 * u_child) / (n1 * n2)

print('=== Mann-Whitney U Test ===')
print(f'  I-node count:  U = {u_inode:.0f}, p = {p_mw_inode:.2e}, rank-biserial r = {rbc_inode:.4f}')
print(f'  Child replies: U = {u_child:.0f}, p = {p_mw_child:.2e}, rank-biserial r = {rbc_child:.4f}')
print()

# ── ROC AUC (discriminative ability) ──
from sklearn.metrics import roc_auc_score
auc_inode = roc_auc_score(is_delta_arr, inode_arr)
auc_child = roc_auc_score(is_delta_arr, child_arr)

print('=== ROC AUC (Discriminative Ability) ===')
print(f'  I-node count:  AUC = {auc_inode:.4f}')
print(f'  Child replies: AUC = {auc_child:.4f}')
print()

# ── Logistic regression (both predictors) ──
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

X = np.column_stack([inode_arr, child_arr])
scaler = StandardScaler()
X_scaled = scaler.fit_transform(X)

lr = LogisticRegression(random_state=42)
lr.fit(X_scaled, is_delta_arr)

print('=== Logistic Regression (standardized coefficients) ===')
print(f'  I-node count:  beta = {lr.coef_[0][0]:.4f}')
print(f'  Child replies: beta = {lr.coef_[0][1]:.4f}')
print(f'  (Larger |beta| = stronger predictor)')
print()

# ── Summary ──
print('=== Summary ===')
print(f'  I-node count is a {"stronger" if abs(r_inode) > abs(r_child) else "weaker"} predictor than child reply count.')
print(f'  Correlation ratio: {abs(r_inode) / abs(r_child):.2f}x' if r_child != 0 else '')
print(f'  Effect size ratio: {abs(d_inode) / abs(d_child):.2f}x' if d_child != 0 else '')
print(f'  AUC ratio: {auc_inode / auc_child:.2f}x' if auc_child != 0 else '')
