---
name: analyze-git-history
description: Analyze git history to find files changed suspiciously often and investigate why. Use when user reminisces about the codebase — "where did it all go wrong", "remember when things were good", "what happened to this code".
user-invocable: true
disable-model-invocation: false
allowed-tools: Bash, Read, Grep, Glob, Agent
shell: bash
---

You are analyzing this project's git history to find files that changed suspiciously often
and investigate root causes. The user said: $ARGUMENTS

## Step 1: Determine scope

From the user's message, decide:
- **Folder scope**: entire repo (default), or a specific module (e.g. `backend`, `frontend/src/pages`)?
- **Depth**: how far back? Defaults: 100 commits for hot-files, 20 merges for churn.

Set shell variables for the steps below:
```sh
SCOPE="."          # or "backend", "frontend/src", etc.
N_COMMITS=100
N_MERGES=20
TOP=10
```

## Step 2: Run discovery scripts

Run both helper scripts from the skill directory:

```sh
bash .claude/skills/analyze-git-history/hot-files.sh "$N_COMMITS" "$TOP" "$SCOPE"
```

```sh
bash .claude/skills/analyze-git-history/churn-in-branches.sh "$N_MERGES" "$TOP" "$SCOPE"
```

Combine results. Files appearing in **both** lists are highest priority for investigation.

## Step 3: Investigate top files

For the top 3-5 suspicious files (prioritize those in both lists), spawn **one Agent per file
in parallel** using `subagent_type: Explore`. Each agent should:

1. Read the current file content
2. Run `git log --oneline -20 -- <file>` to see recent changes
3. Run `git log --format="%s" -20 -- <file>` to see commit message patterns
4. Assess:
   - Is the file doing too many things? (god file)
   - Were requirements unstable in this area?
   - Is the file confusing / poorly structured, causing repeated fix-up commits?
   - Is it a natural hotspot (config, main entry point) that's fine?
5. Return a verdict: **problem** (needs refactoring), **requirements churn** (external cause),
   or **natural hotspot** (no action needed), with a 1-2 sentence explanation.

## Step 4: Produce analysis report

Output a structured report:

### Git History Analysis

**Scope**: [folder analyzed]
**Period**: last N commits / N merges

#### Hot Files

`hot-files.sh` outputs a table with one row per file: filename, total commits,
one column per emoji type seen (e.g. 🧹 🐛 ✨), and a `(none)` column for
commits without a leading emoji (should normally be 0). Merge commits are
excluded — see churn-in-branches for branch churn.

| Rank | File | Commits | Branch churn | Verdict |
|------|------|---------|-------------|---------|
| 1    | path/to/file | 15 | 12 | problem / natural hotspot / requirements churn |

#### Per-file Findings

For each investigated file:
- **Why it's hot**: brief explanation of change patterns
- **Root cause**: requirements churn / structural issue / natural hotspot
- **Recommendation**: specific follow-up action (or "no action needed")

#### Recommended Follow-up Tasks

Bullet list of concrete tasks for **separate sessions**. Each task should be
self-contained and actionable without re-reading this analysis. Format as task
descriptions that could be pasted into a GitHub issue or given to Claude Code.
