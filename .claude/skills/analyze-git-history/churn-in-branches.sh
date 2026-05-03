#!/usr/bin/env bash
# Find files changed multiple times within single feature branches.
# High intra-branch churn suggests confusion, rework, or unstable requirements.
# Usage: churn-in-branches.sh [N_merges=20] [top_X=10] [folder=.]
set -euo pipefail

N="${1:-20}"
X="${2:-10}"
FOLDER="${3:-.}"
REPO_ROOT="$(git rev-parse --show-toplevel)"

cd "$REPO_ROOT"

git log --merges --format="%H %P" -"$N" | while read -r merge fp sp; do
  [ -z "${sp:-}" ] && continue
  # List files touched multiple times within this feature branch
  git log --name-only --format="" "$fp..$sp" -- "$FOLDER" 2>/dev/null \
    | grep -v '^$' \
    | sort | uniq -c | awk '$1 > 1 {print $1, $2}'
done \
  | awk '{count[$2]+=$1} END {for(f in count) print count[f], f}' \
  | sort -rn \
  | head -"$X"
