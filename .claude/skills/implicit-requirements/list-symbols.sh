#!/usr/bin/env bash
# Extract function/class/method definitions with locations.
# Usage: list-symbols.sh <path>  (file or directory)
# Output: file:line:type:name (one per line)
set -euo pipefail

TARGET="${1:-.}"

if [ -d "$TARGET" ]; then
  # Python files
  grep -rnE '^\s*(async\s+)?def\s+\w+|^\s*class\s+\w+' "$TARGET" --include='*.py' 2>/dev/null \
    | sed -E 's|^([^:]+):([0-9]+):\s*(async\s+)?def\s+(\w+).*|\1:\2:func:\4|' \
    | sed -E 's|^([^:]+):([0-9]+):\s*class\s+(\w+).*|\1:\2:class:\3|' || true
  # TypeScript/JavaScript: named functions and arrow function components (PascalCase or UPPER_CASE const)
  grep -rnE '^\s*(export\s+)?(async\s+)?function\s+\w+|^\s*(export\s+)?const\s+[A-Z]\w+\s*[=:]' "$TARGET" --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' 2>/dev/null \
    | sed -E 's|^([^:]+):([0-9]+):.*(async\s+)?function\s+(\w+).*|\1:\2:func:\4|' \
    | sed -E 's|^([^:]+):([0-9]+):\s*(export\s+)?const\s+(\w+).*|\1:\2:func:\4|' || true
elif [ -f "$TARGET" ]; then
  case "$TARGET" in
    *.py)
      grep -nE '^\s*(async\s+)?def\s+\w+|^\s*class\s+\w+' "$TARGET" 2>/dev/null \
        | sed -E "s|^([0-9]+):\s*(async\s+)?def\s+(\w+).*|${TARGET}:\1:func:\3|" \
        | sed -E "s|^([0-9]+):\s*class\s+(\w+).*|${TARGET}:\1:class:\2|" || true
      ;;
    *.ts|*.tsx|*.js|*.jsx)
      grep -nE '^\s*(export\s+)?(async\s+)?function\s+\w+|^\s*(export\s+)?const\s+[A-Z]\w+\s*[=:]' "$TARGET" 2>/dev/null \
        | sed -E "s|^([0-9]+):.*?(async\s+)?function\s+(\w+).*|${TARGET}:\1:func:\3|" \
        | sed -E "s|^([0-9]+):\s*(export\s+)?const\s+(\w+).*|${TARGET}:\1:func:\3|" || true
      ;;
    *)
      echo "Unsupported file type: $TARGET" >&2
      exit 1
      ;;
  esac
else
  echo "Not found: $TARGET" >&2
  exit 1
fi
