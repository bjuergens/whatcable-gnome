---
name: implicit-requirements
description: Surface hidden assumptions, landmines, and implicit requirements in code. Use when the user asks about hidden requirements, implicit assumptions, undocumented constraints, naming honesty, or "what could break if I change this". Also suggest this skill when the user is about to modify heavily-depended-on code and might not know the unwritten rules.
user-invocable: true
disable-model-invocation: false
allowed-tools: Bash, Read, Grep, Glob, Agent
shell: bash
---

You are analyzing code to find **implicit requirements** — things the code assumes or enforces
that aren't explicitly documented. The user said: $ARGUMENTS

## Step 1: Determine scope

From the user's message, decide:
- **Target**: a specific file, a module directory, or the whole project
  - If the user names a file: use that file
  - If the user names a directory: analyze files in that directory
  - If no target: default to `backend/app/` (the core business logic)
- **Focus** (optional): a specific category (name-honesty, caller-contract, explicit, implicit-arch, orphan), or all (default)

Set the target path from the user's message.

## Step 2: Pick files to analyze

If the target is a single file, analyze just that file. Skip to Step 3.

If the target is a directory, rank files by how many other files depend on their symbols:

```sh
bash .claude/skills/implicit-requirements/rank-by-dependents.sh "$TARGET" 5
```

This counts cross-file references for each file's exported functions/classes. Files whose symbols
are used by the most other files get analyzed first — implicit requirements there have the biggest
blast radius.

## Step 3: Analyze per-file with parallel agents

Spawn **one Agent per file in parallel** (up to 5 files) using `subagent_type: Explore`.

Give each agent the file path to read.

Each agent should analyze these 5 categories and return structured findings:

### Category 1: Name honesty

Read each function/class name and its full body. Flag where the name doesn't match the behavior:
- `get_X` that also creates, mutates, or has side effects
- `validate_X` that also transforms data or raises in unexpected ways
- `helper` / `utils` / `do_thing` that does critical business logic
- Names that are too vague (`process`, `handle`, `run`) for what they actually do
- Names that are outright misleading

For each flagged name, give a verdict: **honest**, **misleading**, or **incomplete**.
Suggest a more accurate name where applicable.

### Category 2: Caller contract

Find all callers of this file's public functions by searching the codebase for each function name.
Then read the calling code and check:
- Are callers using the function as its signature/docstring intends?
- Are callers accessing private attributes (leading underscore in Python)?
- Are callers ignoring return values that matter?
- Are callers passing hardcoded values that reveal hidden assumptions?
- Are callers wrapping calls in try/except that swallows errors the function expects to propagate?

Verdict per function: **respected**, **stretched** (used in unintended but working ways), or **violated**.

### Category 3: Explicit requirements

List all requirements stated explicitly in the code:
- Assertions and their conditions
- Comments that state constraints (`# must`, `# always`, `# never`, `# assumes`)
- Type hints that encode business rules (e.g. `int` for cents, `Optional` for nullable)
- Config values that set limits or defaults
- References to CLAUDE.md or architecture docs

For each, provide:
- A **free-form description** of what the requirement means
- A **testable predicate** where one naturally fits (e.g. `balance_cents >= 0 after debit`).
  Don't force predicates on vague or contextual requirements.

### Category 4: Implicit architectural requirements

Identify requirements that emerge from framework/architecture choices but aren't stated
at the point of use:
- "Must be async" (from async SQLAlchemy / FastAPI)
- "Must use dependency injection" (from FastAPI `Depends()`)
- "All endpoints authenticated" (from auth middleware)
- "Balance in euro cents, not euros" (from DB schema convention)
- "Must handle within a DB transaction" (from session management pattern)
- "Must not block the event loop" (from asyncio)

These are things that would break silently or loudly if violated, but the code at the point
of use doesn't always say why.

### Category 5: Orphan requirements

Find guards, assertions, or constraints whose purpose isn't obvious from context. For each,
report the file, line number(s), what the constraint enforces, and a testable predicate where
natural. Don't trace git history — just flag it with the line number. Git blame happens in
Step 3b after all agents return.

If a file has no interesting findings in a category, say so in one line and move on.

### Agent return format

Return findings as structured text. Include line numbers for every finding so they can be
cross-referenced with git blame later. Skip categories that have nothing interesting —
a one-line "nothing notable" is fine.

## Step 3b: Annotate orphan requirements with git provenance

After all agents return, collect orphan findings (Category 5) with their file:line references.
For each orphan, use `git blame -L` and `git log` to find who introduced it and why. Example:

```sh
git blame -L 45,45 backend/app/db.py
# → fb99f8a1 (author 2026-03-27 ...) line content

git log -1 --format="%h %ai %s" fb99f8a1
# → fb99f8a ✨ feat: add admin login, admin API, and admin dashboard
```

Use the commit emoji convention (🐛 = bug fix, ✨ = feature, 🧹 = refactor) to help classify
each requirement's origin.

## Step 4: Produce report

Synthesize all agent findings into a single report. Use your judgment on format — adapt to
what the findings actually contain rather than forcing a rigid template. Key goals:

- **Cross-reference across files**: Look for patterns that span multiple files (e.g. a convention
  that 4 out of 5 files follow but one violates, or a distributed responsibility like 401 handling).
- **Rank by impact**: Lead with findings that have the biggest blast radius — requirements in
  highly-depended-on files matter more than quirks in leaf components.
- **Be concrete**: Every finding should reference file:line. Every recommendation should be
  actionable in a separate session without re-reading this analysis.
- **Skip the boring stuff**: Don't list every honest name or respected contract. Only report
  things that are surprising, risky, or worth documenting.
