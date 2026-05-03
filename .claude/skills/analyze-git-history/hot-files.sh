#!/usr/bin/env bash
# List files most frequently changed in recent commits, broken down by commit type.
# Merge commits are excluded — use churn-in-branches.sh for branch churn.
# Usage: hot-files.sh [N_commits=100] [top_Y=10] [folder=.]
set -euo pipefail

N="${1:-100}"
Y="${2:-10}"
FOLDER="${3:-.}"
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

python3 - "$N" "$Y" "$FOLDER" <<'EOF'
import sys
import subprocess
import unicodedata
from collections import defaultdict

n, top, folder = sys.argv[1], sys.argv[2], sys.argv[3]

def leading_emoji(msg):
    for i, ch in enumerate(msg):
        cp = ord(ch)
        is_emoji = (
            0x1F000 <= cp <= 0x1FFFF or
            0x2600 <= cp <= 0x27BF or
            0x2300 <= cp <= 0x23FF
        )
        if is_emoji:
            end = i + 1
            while end < len(msg) and ord(msg[end]) in (0xFE0F, 0x200D):
                end += 1
            return msg[i:end]
        elif unicodedata.category(ch)[0] in ("L", "N", "P"):
            return None
    return None

# git log with a sentinel line before each commit's file list
raw = subprocess.run(
    ["git", "log", f"-{n}", "--no-merges", "--format=COMMIT:%s", "--name-only", "--", folder],
    capture_output=True, text=True
).stdout.strip().splitlines()

# file -> {emoji_or_"(none)": count}
file_emojis = defaultdict(lambda: defaultdict(int))
current_emoji = None

for line in raw:
    if line.startswith("COMMIT:"):
        subject = line[7:]
        current_emoji = leading_emoji(subject) or "(none)"
    elif line.strip() and current_emoji is not None:
        file_emojis[line.strip()][current_emoji] += 1

if not file_emojis:
    print("No commits found.")
    sys.exit(0)

# Sort by total commits descending, take top Y
ranked = sorted(file_emojis.items(), key=lambda x: sum(x[1].values()), reverse=True)[:int(top)]

# Collect all emojis in order of frequency across all files (excluding "(none)")
from collections import Counter
emoji_totals = Counter()
for _, counts in ranked:
    for k, v in counts.items():
        if k != "(none)":
            emoji_totals[k] += v
all_emojis = [e for e, _ in emoji_totals.most_common()]

# Build table
headers = ["file", "total"] + all_emojis + ["(none)"]
rows = []
for path, counts in ranked:
    total = sum(counts.values())
    row = [path, str(total)]
    for e in all_emojis:
        row.append(str(counts.get(e, "")) )
    row.append(str(counts.get("(none)", "")))
    rows.append(row)

# Column widths
widths = [len(h) for h in headers]
for row in rows:
    for i, cell in enumerate(row):
        widths[i] = max(widths[i], len(cell))

def fmt_row(row):
    return "  ".join(cell.ljust(widths[i]) for i, cell in enumerate(row)).rstrip()

sep = "  ".join("-" * w for w in widths)
print(fmt_row(headers))
print(sep)
for row in rows:
    print(fmt_row(row))
EOF
