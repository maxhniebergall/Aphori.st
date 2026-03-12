#!/usr/bin/env python3
"""Generate MRR benchmark chart with 95% confidence intervals."""

import json
import sys
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np

INPUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/benchmark-replycount.json'
OUTPUT = sys.argv[2] if len(sys.argv) > 2 else '/tmp/benchmark-mrr-chart.png'

matplotlib.rcParams['font.family'] = 'sans-serif'
matplotlib.rcParams['font.size'] = 11

with open(INPUT) as f:
    data = json.load(f)

summary = data['summary']
n = data['thread_count']

# Algorithms to display (top-down order)
selected = [
    'ER_Vote_Sum_NoDC_Bridge',
    'ER_Vote_Sum_NoDC',
    'ER_Vote_Sum',
    'RRF_Top_Vote_ReplyCount',
    'Top_Flat',
    'Top_ReplyCount',
    'QuadraticEnergy_Vote',
]

short_names = {
    'ER_Vote_Sum_NoDC_Bridge':    'ER Sum/NoDC + Bridge',
    'ER_Vote_Sum_NoDC':           'ER Sum/NoDC',
    'ER_Vote_D95_Sum_NoDC':       'ER(d=0.95) Sum/NoDC',
    'RRF_ER_QE_Reply':            'RRF(ER+QE) Reply',
    'RRF_ER_QE_Vote':             'RRF(ER+QE) I-Node',
    'ER_Vote_Sum':                'ER Sum/DC',
    'RRF_Top_Vote_ReplyCount':    'RRF(Vote+ReplyCount)',
    'ER_Vote_Dim_NoDC':           'ER Diminishing/NoDC',
    'EvidenceRank_Vote':          'EvidenceRank Vote',
    'EvidenceRank_Enthymeme_Attack_Bridge': 'ER+Enthymeme Attack+Bridge',
    'ER_Vote_Geo_NoDC':           'ER Geometric/NoDC',
    'Top_Flat':                   'Top (Vote Sort)',
    'Combined_ER_QE_Vote':        'ER\u00d7QE Combined (old)',
    'ER_Vote_NoDC':               'ER Max/NoDC',
    'EvidenceRank_Vote_NoBridge': 'EvidenceRank NoBridge',
    'Top_ReplyCount':             'Top (Reply Count)',
    'QuadraticEnergy_Vote':       'QuadraticEnergy Vote',
    'DampedModular_ReferenceBias_NoBridge': 'DampedModular RefBias',
    'DampedModular_Vote_HC_NoBridge':       'DampedModular Vote+HC',
}

# Color categories
new_variants = {
    'RRF_ER_QE_Vote', 'RRF_ER_QE_Reply',
    'ER_Vote_Sum_NoDC_Bridge', 'ER_Vote_Sum_NoDC', 'ER_Vote_D95_Sum_NoDC',
    'ER_Vote_Sum', 'ER_Vote_Dim_NoDC', 'ER_Vote_NoDC', 'ER_Vote_Geo_NoDC',
    'RRF_Top_Vote_ReplyCount', 'Top_ReplyCount',
}
baselines = {'Top_Flat', 'Top_ReplyCount'}

names, mrrs, ci_lo, ci_hi, colors = [], [], [], [], []

for key in selected:
    s = summary[key]
    mrr = s['mrr']
    se = s['mrr_std'] / np.sqrt(n)
    lo = mrr - 1.96 * se
    hi = mrr + 1.96 * se

    names.append(short_names.get(key, key))
    mrrs.append(mrr)
    ci_lo.append(mrr - lo)
    ci_hi.append(hi - mrr)

    if key in baselines:
        colors.append('#94a3b8')
    elif key in new_variants:
        colors.append('#2563eb')
    else:
        colors.append('#64748b')

# Reverse for bottom-to-top display
names, mrrs, ci_lo, ci_hi, colors = [x[::-1] for x in [names, mrrs, ci_lo, ci_hi, colors]]

fig, ax = plt.subplots(figsize=(10, 9))
y_pos = np.arange(len(names))

ax.barh(y_pos, mrrs, xerr=[ci_lo, ci_hi], height=0.65,
        color=colors, edgecolor='white', linewidth=0.5,
        capsize=3, error_kw={'linewidth': 1.2, 'color': '#334155'})

ax.set_yticks(y_pos)
ax.set_yticklabels(names, fontsize=10)
ax.set_xlabel('Mean Reciprocal Rank (MRR)', fontsize=12, fontweight='bold')
ax.set_title(f'Benchmark MRR with 95% Confidence Intervals  (n={n} threads)',
             fontsize=13, fontweight='bold', pad=12)

# Value labels
for i, mrr in enumerate(mrrs):
    ax.text(mrr + ci_hi[i] + 0.005, i, f'{mrr:.3f}', va='center', fontsize=9, color='#1e293b')

# Top_Flat reference line
top_flat_mrr = summary['Top_Flat']['mrr']
ax.axvline(x=top_flat_mrr, color='#e11d48', linestyle='--', linewidth=1, alpha=0.7, zorder=0)
ax.text(top_flat_mrr + 0.003, len(names) - 0.5, 'Top baseline',
        fontsize=8, color='#e11d48', va='bottom')

# Legend
from matplotlib.patches import Patch
ax.legend(handles=[
    Patch(facecolor='#2563eb', label='New variants'),
    Patch(facecolor='#64748b', label='Existing algorithms'),
    Patch(facecolor='#94a3b8', label='Baselines'),
], loc='lower right', fontsize=9, framealpha=0.9)

ax.set_xlim(0.3, 0.68)
ax.grid(axis='x', alpha=0.3, linestyle='-')
ax.set_axisbelow(True)
ax.spines['top'].set_visible(False)
ax.spines['right'].set_visible(False)

plt.tight_layout()
plt.savefig(OUTPUT, dpi=150, bbox_inches='tight')
print(f'Saved to {OUTPUT}')

# ── Chart 2: ΔMRR vs Top_Flat with bootstrap CI and Wilcoxon significance ──

OUTPUT2 = OUTPUT.replace('.png', '-delta.png')

top_mrr = summary['Top_Flat']['mrr']

fig2, ax2 = plt.subplots(figsize=(10, 7))

# Filter out Top_Flat (it's the reference)
sel2 = [k for k in selected if k != 'Top_Flat']
names2, deltas, boot_lo, boot_hi, colors2, sig_labels = [], [], [], [], [], []

for key in sel2:
    s = summary[key]
    delta = s['mrr'] - top_mrr
    names2.append(short_names.get(key, key))
    deltas.append(delta)

    bl = s.get('bootstrap_ci_lo')
    bh = s.get('bootstrap_ci_hi')
    boot_lo.append(delta - bl if bl is not None else 0)
    boot_hi.append(bh - delta if bh is not None else 0)

    wp = s.get('wilcoxon_p')
    bp = s.get('bootstrap_p')
    # Use the more conservative (larger) p-value for significance label
    p = max(wp, bp) if wp is not None and bp is not None else (wp or bp)
    if p is None:
        sig_labels.append('')
    elif p < 0.001:
        sig_labels.append(' ***')
    elif p < 0.01:
        sig_labels.append(' **')
    elif p < 0.05:
        sig_labels.append(' *')
    else:
        sig_labels.append(' (ns)')

    if key in baselines:
        colors2.append('#94a3b8')
    elif key in new_variants:
        colors2.append('#2563eb')
    else:
        colors2.append('#64748b')

# Reverse for bottom-to-top
names2, deltas, boot_lo, boot_hi, colors2, sig_labels = [
    x[::-1] for x in [names2, deltas, boot_lo, boot_hi, colors2, sig_labels]
]

y2 = np.arange(len(names2))

ax2.barh(y2, deltas, xerr=[boot_lo, boot_hi], height=0.6,
         color=colors2, edgecolor='white', linewidth=0.5,
         capsize=3, error_kw={'linewidth': 1.2, 'color': '#334155'})

ax2.set_yticks(y2)
ax2.set_yticklabels(names2, fontsize=10)
ax2.set_xlabel('\u0394MRR vs Top (Vote Sort)', fontsize=12, fontweight='bold')
ax2.set_title(f'\u0394MRR with Bootstrap 95% CI and Wilcoxon Significance  (n={n})',
              fontsize=13, fontweight='bold', pad=12)

# Zero reference line
ax2.axvline(x=0, color='#e11d48', linestyle='--', linewidth=1, alpha=0.7, zorder=0)

# Value + significance labels
for i, (d, sig) in enumerate(zip(deltas, sig_labels)):
    x_pos = d + boot_hi[i] + 0.003 if d >= 0 else d - boot_lo[i] - 0.003
    ha = 'left' if d >= 0 else 'right'
    ax2.text(x_pos, i, f'{d:+.3f}{sig}', va='center', ha=ha, fontsize=9, color='#1e293b')

ax2.legend(handles=[
    Patch(facecolor='#2563eb', label='New variants'),
    Patch(facecolor='#64748b', label='Existing algorithms'),
    Patch(facecolor='#94a3b8', label='Baselines'),
], loc='lower right', fontsize=9, framealpha=0.9)

ax2.grid(axis='x', alpha=0.3, linestyle='-')
ax2.set_axisbelow(True)
ax2.spines['top'].set_visible(False)
ax2.spines['right'].set_visible(False)

plt.tight_layout()
fig2.savefig(OUTPUT2, dpi=150, bbox_inches='tight')
print(f'Saved to {OUTPUT2}')

# ── Chart 3: ΔMRR vs RRF_Top_Vote_ReplyCount baseline ──

OUTPUT3 = OUTPUT.replace('.png', '-vs-rrf.png')

from scipy import stats as scipy_stats

# Compute paired tests from per-thread data
threads = data['threads']
baseline_key = 'RRF_Top_Vote_ReplyCount'
baseline_rrs = [t['metrics'][baseline_key]['rr'] for t in threads]

def paired_bootstrap(alg_rrs, base_rrs, n_boot=10_000, seed=42):
    n = len(alg_rrs)
    diffs = [a - b for a, b in zip(alg_rrs, base_rrs)]
    observed = sum(diffs) / n
    centered = [d - observed for d in diffs]
    rng = np.random.RandomState(seed)
    boot_h0, boot_ci = [], []
    for _ in range(n_boot):
        idx = rng.randint(0, n, n)
        boot_h0.append(np.mean([centered[i] for i in idx]))
        boot_ci.append(np.mean([diffs[i] for i in idx]))
    p = max(np.mean([abs(m) >= abs(observed) for m in boot_h0]), 1/n_boot)
    boot_ci.sort()
    ci_lo = boot_ci[int(0.025 * n_boot)]
    ci_hi = boot_ci[int(0.975 * n_boot)]
    return p, ci_lo, ci_hi

sel3 = [k for k in selected if k != baseline_key]

fig3, ax3 = plt.subplots(figsize=(10, 7))

base_mrr = summary[baseline_key]['mrr']
names3, deltas3, blo3, bhi3, colors3, sig3 = [], [], [], [], [], []

for key in sel3:
    s = summary[key]
    delta = s['mrr'] - base_mrr
    names3.append(short_names.get(key, key))
    deltas3.append(delta)

    alg_rrs = [t['metrics'][key]['rr'] for t in threads]

    # Wilcoxon signed-rank
    diffs = [a - b for a, b in zip(alg_rrs, baseline_rrs)]
    non_zero = [d for d in diffs if d != 0]
    if len(non_zero) >= 10:
        w_stat, w_p = scipy_stats.wilcoxon([a for a, b in zip(alg_rrs, baseline_rrs) if a - b != 0],
                                            [b for a, b in zip(alg_rrs, baseline_rrs) if a - b != 0])
    else:
        w_p = None

    # Bootstrap
    b_p, ci_lo, ci_hi = paired_bootstrap(alg_rrs, baseline_rrs)

    blo3.append(delta - ci_lo)
    bhi3.append(ci_hi - delta)

    p = max(w_p, b_p) if w_p is not None else b_p
    if p < 0.001:
        sig3.append(' ***')
    elif p < 0.01:
        sig3.append(' **')
    elif p < 0.05:
        sig3.append(' *')
    else:
        sig3.append(' (ns)')

    if key in baselines:
        colors3.append('#94a3b8')
    elif key in new_variants:
        colors3.append('#2563eb')
    else:
        colors3.append('#64748b')

names3, deltas3, blo3, bhi3, colors3, sig3 = [
    x[::-1] for x in [names3, deltas3, blo3, bhi3, colors3, sig3]
]

y3 = np.arange(len(names3))

ax3.barh(y3, deltas3, xerr=[blo3, bhi3], height=0.6,
         color=colors3, edgecolor='white', linewidth=0.5,
         capsize=3, error_kw={'linewidth': 1.2, 'color': '#334155'})

ax3.set_yticks(y3)
ax3.set_yticklabels(names3, fontsize=10)
ax3.set_xlabel(f'\u0394MRR vs {short_names.get(baseline_key, baseline_key)}', fontsize=12, fontweight='bold')
ax3.set_title(f'\u0394MRR with Bootstrap 95% CI and Wilcoxon Significance  (n={n})',
              fontsize=13, fontweight='bold', pad=12)

ax3.axvline(x=0, color='#e11d48', linestyle='--', linewidth=1, alpha=0.7, zorder=0)

for i, (d, sig) in enumerate(zip(deltas3, sig3)):
    x_pos = d + bhi3[i] + 0.003 if d >= 0 else d - blo3[i] - 0.003
    ha = 'left' if d >= 0 else 'right'
    ax3.text(x_pos, i, f'{d:+.3f}{sig}', va='center', ha=ha, fontsize=9, color='#1e293b')

ax3.legend(handles=[
    Patch(facecolor='#2563eb', label='New variants'),
    Patch(facecolor='#64748b', label='Existing algorithms'),
    Patch(facecolor='#94a3b8', label='Baselines'),
], loc='lower right', fontsize=9, framealpha=0.9)

ax3.grid(axis='x', alpha=0.3, linestyle='-')
ax3.set_axisbelow(True)
ax3.spines['top'].set_visible(False)
ax3.spines['right'].set_visible(False)

plt.tight_layout()
fig3.savefig(OUTPUT3, dpi=150, bbox_inches='tight')
print(f'Saved to {OUTPUT3}')
