#!/usr/bin/env python3
"""Generate architecture diagram for ER_Vote_Sum_NoDC_Bridge algorithm.

Produces publication-quality PDF (vector) and PNG (300 dpi) for ArgMining paper.
"""

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch
import matplotlib.patheffects as pe
import os

# ── Style config ──────────────────────────────────────────────────────────────
matplotlib.rcParams['font.family'] = 'sans-serif'
matplotlib.rcParams['pdf.fonttype'] = 42  # TrueType embedding
matplotlib.rcParams['ps.fonttype'] = 42

FILL_LIGHT = '#f0f0f0'
BORDER = '#444444'
ARROW_COLOR = '#333333'
TEXT_COLOR = '#1a1a1a'
FORMULA_SIZE = 7
LABEL_SIZE = 7.5
TITLE_SIZE = 7
GROUP_TITLE_SIZE = 8

OUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'docs')
os.makedirs(OUT_DIR, exist_ok=True)


def rounded_box(ax, x, y, w, h, label, formula=None, *,
                fill=FILL_LIGHT, edgecolor=BORDER, linewidth=1.0,
                label_y_offset=0):
    """Draw a rounded rectangle with label and optional formula."""
    box = FancyBboxPatch(
        (x - w/2, y - h/2), w, h,
        boxstyle="round,pad=0.03",
        facecolor=fill, edgecolor=edgecolor, linewidth=linewidth,
        zorder=2,
    )
    ax.add_patch(box)

    # Vertical position of label depends on whether there's a formula
    if formula:
        ly = y + 0.15 + label_y_offset
        fy = y - 0.15 + label_y_offset
    else:
        ly = y + label_y_offset
        fy = None

    ax.text(x, ly, label, ha='center', va='center',
            fontsize=LABEL_SIZE, fontweight='bold', color=TEXT_COLOR, zorder=3)

    if formula and fy is not None:
        ax.text(x, fy, formula, ha='center', va='center',
                fontsize=FORMULA_SIZE, color='#333333', zorder=3)

    return box


def arrow(ax, x1, y1, x2, y2, **kwargs):
    """Draw a connecting arrow."""
    style = kwargs.pop('style', 'simple,tail_width=2,head_width=6,head_length=4')
    a = FancyArrowPatch(
        (x1, y1), (x2, y2),
        arrowstyle='->', mutation_scale=10,
        color=ARROW_COLOR, linewidth=1.2, zorder=3,
        **kwargs,
    )
    ax.add_patch(a)
    return a


def dashed_group(ax, x, y, w, h, title):
    """Draw a dashed-border group with title."""
    group = FancyBboxPatch(
        (x, y), w, h,
        boxstyle="round,pad=0.05",
        facecolor='none', edgecolor='#666666',
        linewidth=0.8, linestyle=(0, (5, 3)),
        zorder=1,
    )
    ax.add_patch(group)
    ax.text(x + w/2, y + h - 0.08, title, ha='center', va='top',
            fontsize=GROUP_TITLE_SIZE, fontweight='bold', color='#444444', zorder=3)


# ── Main figure ───────────────────────────────────────────────────────────────
fig, ax = plt.subplots(figsize=(7.5, 3.7))
ax.set_xlim(0, 7.5)
ax.set_ylim(-0.7, 3.0)
ax.set_aspect('equal')
ax.axis('off')

# ── Coordinates ───────────────────────────────────────────────────────────────
# Input box
IN_X, IN_Y = 0.50, 1.50
IN_W, IN_H = 0.65, 0.65

# EvidenceRank group
ER_GX, ER_GY = 1.0, 0.30
ER_GW, ER_GH = 2.85, 2.40

# Boxes inside ER group
ARG_X, ARG_Y = 1.55, 1.50    # Argument Extraction (tall)
ARG_W, ARG_H = 0.75, 1.5

SEED_X, SEED_Y = 2.95, 2.10  # Social Seed
SEED_W, SEED_H = 1.35, 0.50

PROP_X, PROP_Y = 2.95, 1.20  # Propagation
PROP_W, PROP_H = 1.35, 0.50

# Reply Aggregation group
RA_GX, RA_GY = 4.15, 0.30
RA_GW, RA_GH = 2.10, 2.40

# Boxes inside Reply Agg
GRP_X, GRP_Y = 4.58, 2.10    # Group by Reply
GRP_W, GRP_H = 0.55, 0.50

SUM_X, SUM_Y = 5.55, 2.10    # Sum
SUM_W, SUM_H = 1.05, 0.50

BRIDGE_X, BRIDGE_Y = 5.55, 1.20  # Bridge
BRIDGE_W, BRIDGE_H = 1.05, 0.55

# Output box
OUT_X, OUT_Y = 6.90, 1.50
OUT_W, OUT_H = 0.70, 0.65

# ── Draw groups ───────────────────────────────────────────────────────────────
dashed_group(ax, ER_GX, ER_GY, ER_GW, ER_GH, 'EvidenceRank (per i-node)')
dashed_group(ax, RA_GX, RA_GY, RA_GW, RA_GH, 'Reply Aggregation')

# ── Draw boxes ────────────────────────────────────────────────────────────────
# Input
rounded_box(ax, IN_X, IN_Y, IN_W, IN_H,
            'CMV Thread', 'OP + $n$ replies')

# Argument Extraction
rounded_box(ax, ARG_X, ARG_Y, ARG_W, ARG_H,
            'Argument\nExtraction &\nDeduplication', 'LLM\ni-nodes + edges',
            label_y_offset=0.25)

# Social Seed
rounded_box(ax, SEED_X, SEED_Y, SEED_W, SEED_H,
            'Social Seed', r'$s_i = votes$')

# Propagation
rounded_box(ax, PROP_X, PROP_Y, PROP_W, PROP_H,
            'Propagation', r'$r_i = s_i + d(\Sigma_{\mathrm{sup}} - \Sigma_{\mathrm{att}})$')

# Group by Reply
rounded_box(ax, GRP_X, GRP_Y, GRP_W, GRP_H,
            'Group\nby Reply', label_y_offset=0)

# Sum
rounded_box(ax, SUM_X, SUM_Y, SUM_W, SUM_H,
            'Sum', r'$S_r = \sum_{i \in r} r_i$')

# Bridge
rounded_box(ax, BRIDGE_X, BRIDGE_Y, BRIDGE_W, BRIDGE_H,
            'Bridge', r'$\hat{S}_r = S_r \cdot T_r$')

# Output
rounded_box(ax, OUT_X, OUT_Y, OUT_W, OUT_H,
            'Ranked\nReply List', label_y_offset=0)

# ── Draw arrows ───────────────────────────────────────────────────────────────
# Input → ER group (horizontal)
arrow(ax, IN_X + IN_W/2 + 0.02, IN_Y, ER_GX + 0.1, IN_Y)

# Arg Extraction → Social Seed (horizontal)
arrow(ax, ARG_X + ARG_W/2 + 0.02, SEED_Y, SEED_X - SEED_W/2 - 0.02, SEED_Y)

# Social Seed → Propagation (vertical down)
arrow(ax, SEED_X, SEED_Y - SEED_H/2 - 0.02, PROP_X, PROP_Y + PROP_H/2 + 0.02)

# ER group → Group by Reply (across group boundary)
arrow(ax, ER_GX + ER_GW + 0.02, 1.50,
      GRP_X - GRP_W/2 - 0.02, GRP_Y,
      connectionstyle='arc3,rad=-0.12')

# Group by Reply → Sum (horizontal)
arrow(ax, GRP_X + GRP_W/2 + 0.02, GRP_Y, SUM_X - SUM_W/2 - 0.02, SUM_Y)

# Sum → Bridge (vertical down)
arrow(ax, SUM_X, SUM_Y - SUM_H/2 - 0.02, BRIDGE_X, BRIDGE_Y + BRIDGE_H/2 + 0.02)

# Bridge → Output (horizontal)
arrow(ax, BRIDGE_X + BRIDGE_W/2 + 0.02, BRIDGE_Y,
      OUT_X - OUT_W/2 - 0.02, OUT_Y,
      connectionstyle='arc3,rad=0.12')

# ── Variable legend ───────────────────────────────────────────────────────────
LEGEND_SIZE = 6.5
LEGEND_COLOR = '#444444'
legend_y = -0.15
col_spacing = 2.5

legend_items = [
    (r'$s_i$', 'social seed score for i-node $i$'),
    (r'$r_i$', 'EvidenceRank score after propagation'),
    (r'$d$', 'damping factor (0.85)'),
    (r'$\Sigma_{\mathrm{sup}}, \Sigma_{\mathrm{att}}$',
     'weighted sum of supporting / attacking scores'),
    (r'$S_r$', 'aggregated score for reply $r$'),
    (r'$\hat{S}_r$', 'final reply score after bridge'),
    (r'$T_r$', 'number of unique argument targets of reply $r$'),
]

# Two-column layout
n_per_col = (len(legend_items) + 1) // 2
for idx, (sym, desc) in enumerate(legend_items):
    col = idx // n_per_col
    row = idx % n_per_col
    x = 0.25 + col * col_spacing * 1.5
    y = legend_y - row * 0.15
    ax.text(x, y, f'{sym}  —  {desc}', fontsize=LEGEND_SIZE,
            color=LEGEND_COLOR, va='center', zorder=3)

# ── Save ──────────────────────────────────────────────────────────────────────
plt.tight_layout(pad=0.1)

pdf_path = os.path.join(OUT_DIR, 'architecture-er-vote-sum-nodc-bridge.pdf')
png_path = os.path.join(OUT_DIR, 'architecture-er-vote-sum-nodc-bridge.png')

fig.savefig(pdf_path, bbox_inches='tight', pad_inches=0.05)
fig.savefig(png_path, dpi=300, bbox_inches='tight', pad_inches=0.05)

print(f'Saved PDF: {pdf_path}')
print(f'Saved PNG: {png_path}')
