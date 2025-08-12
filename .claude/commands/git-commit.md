# Git/dvc commit the working tree

There are unstaged (and possibly staged changes). The changes in the working tree might reflect multiple logical tasks. Use `git status` to assess the changes. Split them into logical groups, and `git add` and `git commit -m` them or `dvc add` and `dvc commit`. Give each commit a concise commit message. Do not use any other git commands.

## DVC/Git Strategy

### File Type Classification

- **Git tracks:**
  - All TypeScript/JavaScript source code
  - Configuration files (`*.json`, `*.yaml`)
  - DVC pipeline files (`dvc.yaml`, `dvc.lock`)
  - DVC pointer files (`*.dvc`)
  - Documentation and scripts

- **DVC tracks:**
  - Large datasets (`*.csv`, `*.bin`, `*.json` data files)
  - Generated models and indices
  - Raw data and processed outputs

### Workflow Pattern

1. **Code changes** → Git commit
2. **Data processing** → `dvc add data/file.ext` → Git commit (for `.dvc` files)
3. **Pipeline changes** → `dvc commit` → Git commit (for `dvc.lock`)

### Important Rules

- **Do not commit data files through git**
- Large files (>1MB) must use DVC tracking
- Always commit DVC pointer files (`.dvc`) to git
- Commit pipeline dependencies through `dvc commit`, then commit `dvc.lock` to git

### Example DVC Workflow

```bash
# Add large dataset to DVC
dvc add data/large_dataset.csv

# Commit DVC pointer to git
git add data/large_dataset.csv.dvc .gitignore
git commit -m "Add large dataset to DVC tracking"

# Update pipeline if needed
dvc commit
git add dvc.lock
git commit -m "Update DVC pipeline dependencies"
```

Do not include "🤖 Generated with [Claude Code](https://claude.ai/code) Co-Authored-By: Claude <noreply@anthropic.com>".