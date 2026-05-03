#!/usr/bin/env bash
# Rank files by how many other files depend on their exported symbols.
# Uses output from list-symbols.sh to find symbols, then counts cross-file references.
# Usage: rank-by-dependents.sh <path> [top_N=5]
# Output: reference_count file_path (sorted descending)
set -euo pipefail

TARGET="${1:-.}"
TOP="${2:-5}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Get symbols per file
SYMBOLS=$("$SCRIPT_DIR/list-symbols.sh" "$TARGET")

if [ -z "$SYMBOLS" ]; then
  echo "No symbols found in $TARGET" >&2
  exit 1
fi

# Extract unique files and their exported symbol names
declare -A FILE_SCORE

while IFS=: read -r file line type name; do
  # Skip private symbols (leading underscore or very short names)
  [[ "$name" =~ ^_ ]] && continue
  [ ${#name} -le 2 ] && continue

  # Count how many OTHER files reference this symbol
  hits=$(grep -rl --include='*.py' --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' "$name" "$TARGET" 2>/dev/null \
    | grep -v "^${file}$" \
    | wc -l || true)

  FILE_SCORE["$file"]=$(( ${FILE_SCORE["$file"]:-0} + hits ))
done <<< "$SYMBOLS"

# Sort by score descending, output top N
for file in "${!FILE_SCORE[@]}"; do
  echo "${FILE_SCORE[$file]} $file"
done | sort -rn | head -"$TOP"
