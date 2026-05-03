---
name: ousterhout-principles
description: Evaluate code against design principles from Ousterhout's "A Philosophy of Software Design". Only trigger when the user explicitly mentions "Ousterhout principles", "/ousterhout-principles", or "check psd principles" — e.g. "run ousterhout principles on this", "check this against ousterhout's principles". Do NOT trigger on vague design questions or general code review requests.
user-invocable: true
disable-model-invocation: false
allowed-tools: Bash, Read, Grep, Glob, Agent
shell: bash
---

You are evaluating code against **design principles** from John Ousterhout's
*A Philosophy of Software Design*. The user said: $ARGUMENTS

Principles 1-3 (complexity is incremental, working code isn't enough, continual investment),
Principle 11 (define errors out of existence), and Principle 12 (design it twice) are omitted.
Principles 1-3 and 12 are process/mindset principles that can't be checked from code alone.
Principle 11 conflicts with the project's "fail loudly" principle — silently succeeding can
mask bugs. Error handling is better evaluated case-by-case than by a general rule.

## Step 1: Determine scope

From the user's message, decide:
- **Target**: a specific file, a module directory, or a class/function name
  - If the user names a file: use that file
  - If the user names a directory: analyze source files in that directory
  - If no target: ask for one
- **Focus** (optional): a specific principle number/name, or all (default)

## Step 2: Pick files to analyze

If the target is a single file, use that file. Skip to Step 3.

If the target is a directory, list source files and pick the most substantial ones (up to 8).

```sh
bash .claude/skills/implicit-requirements/list-symbols.sh "$TARGET"
```

## Step 3: Spawn parallel agents — one per principle group

Spawn **up to 4 Agents in parallel** (use `subagent_type: Explore`, `model: sonnet`).
Each agent receives the list of files to analyze and a description of its assigned principles.
All agents are read-only (reading files and grepping) so `Explore` is the right subagent type.

**IMPORTANT**: Every agent must **read the actual file contents** before analyzing.

**IMPORTANT**: For each finding, agents must include a **best-effort quote** from the
relevant section of *A Philosophy of Software Design*. Use direct quotes where confident,
close paraphrases marked with "~" where approximating. Always include chapter/page references.
This grounds the analysis in Ousterhout's actual arguments rather than abstract principle names.

### Agent 1: Module Design (Principles 4, 5, 6, 7)

> **Principle 4 — Modules should be deep** (p. 22). The best modules provide powerful
> functionality behind simple interfaces. A deep module hides significant complexity from
> its users. Shallow modules (simple implementation behind a simple interface) don't help much.
>
> **Principle 5 — Interfaces should be designed to make the most common usage as simple as
> possible** (p. 27). The common case should be easy; rare cases can be harder. Don't force
> every caller to deal with complexity that only some need.
>
> **Principle 6 — It's more important for a module to have a simple interface than a simple
> implementation** (p. 55, 71). Complexity has to live somewhere. It's better inside the
> module (where one developer deals with it once) than in the interface (where every caller
> deals with it repeatedly).
>
> **Principle 7 — General-purpose modules are deeper** (p. 39). Modules designed for general
> use tend to have simpler interfaces and hide more complexity. Special-purpose modules
> expose more of their internals because they're shaped around one use case.

For each file:
1. Read the code fully
2. For each class/module: is it deep? Does it hide significant complexity behind a simple API?
3. For public APIs: is the common usage path simple? Or do callers need to understand internal
   details to use basic features?
4. Where is complexity located — in the module internals (good) or leaked to callers (bad)?
5. Could any special-purpose modules be made more general (and thus deeper)?
6. Rate each module: **deep** (good), **adequate**, or **shallow** (needs redesign)

### Agent 2: Separation & Layering (Principles 8, 9, 10)

> **Principle 8 — Separate general-purpose and special-purpose code** (p. 62). General-purpose
> mechanisms (logging, HTTP handling, data validation) should be cleanly separated from
> business-specific logic. Mixing them makes both harder to understand and reuse.
>
> **Principle 9 — Different layers should have different abstractions** (p. 45). If adjacent
> layers (e.g. a function and the function it calls, or a module and its dependency) have
> similar interfaces, one of them probably isn't adding much value. Each layer should
> transform the abstraction level meaningfully.
>
> **Principle 10 — Pull complexity downward** (p. 55). When you have a choice about where
> to handle complexity, push it into the lower-level module rather than exposing it to
> higher-level callers. It's better for the implementer to suffer than for every user to suffer.

For each file:
1. Read the code fully
2. Is general-purpose code cleanly separated from business logic?
3. Do the layers of abstraction each add meaningful transformation? Or are there pass-through
   layers that just rename things?
4. Where complexity exists, is it pushed down into implementations or leaked up to callers?
5. Look at function call chains: does each level operate at a meaningfully different
   abstraction level?

### Agent 3: Readability & Documentation (Principles 13, 14)

> **Principle 13 — Comments should describe things that are not obvious from the code** (p. 101).
> Good comments explain *why*, not *what*. They describe the reasoning, the constraints,
> the non-obvious implications — things that can't be expressed in code.
>
> **Principle 14 — Software should be designed for ease of reading, not ease of writing** (p. 149).
> Code is read far more often than written. Optimize for the reader: clear names, obvious
> flow, no clever tricks. If it was hard to write, it will be harder to read.

For each file:
1. Read the code fully
2. Are comments useful? Do they explain *why*, not just *what*? Are they present where the
   code is non-obvious and absent where the code is self-explanatory?
3. Is the code optimized for reading? Could a new team member understand the flow without
   asking questions? Or does it require insider knowledge?

### Agent 4: Abstraction Boundaries (Principle 15)

> **Principle 15 — The increments of software development should be abstractions, not
> features** (p. 154). Don't organize code around features or user stories. Organize around
> abstractions — modules with clean interfaces that can be understood and used independently.

This principle operates at a higher level than the others — it's about how modules and files
relate to each other, not just what's inside a single file.

1. Read all target files
2. Look at the directory and file structure: are files organized around abstractions (e.g.
   `auth.py`, `payments.py`, `queue.py` — each a clean concept) or around features/stories
   (e.g. `upload_flow.py`, `onboarding.py` — each mixing multiple abstraction levels)?
3. For each module/class: does it represent a coherent abstraction, or is it a grab-bag of
   functionality grouped by feature?
4. Check imports and dependencies: do modules depend on abstractions (interfaces, protocols)
   or on concrete feature implementations?
5. Look for signs of feature-driven organization: files that combine unrelated concerns
   because they're part of the same user-facing flow

## Step 4: Produce report

After all agents return, synthesize findings into a single report.

### Design Principles Scorecard

| # | Principle | Rating | Notes |
|---|-----------|--------|-------|
| 4 | Modules should be deep | ✅/⚠️/❌ | one-line summary |
| 5 | Simple common usage | ✅/⚠️/❌ | one-line summary |
| 6 | Simple interface > simple impl | ✅/⚠️/❌ | one-line summary |
| 7 | General-purpose modules are deeper | ✅/⚠️/❌ | one-line summary |
| 8 | Separate general/special | ✅/⚠️/❌ | one-line summary |
| 9 | Different layers, different abstractions | ✅/⚠️/❌ | one-line summary |
| 10 | Pull complexity downward | ✅/⚠️/❌ | one-line summary |
| 13 | Comments describe non-obvious | ✅/⚠️/❌ | one-line summary |
| 14 | Ease of reading > ease of writing | ✅/⚠️/❌ | one-line summary |
| 15 | Abstractions, not features | ✅/⚠️/❌ | one-line summary |

Ratings:
- ✅ **Follows well**: the code demonstrates this principle
- ⚠️ **Partially follows**: some areas conform, others don't
- ❌ **Violates**: significant departures from this principle

### Key Findings

Group findings by theme rather than by principle number. Lead with the most impactful
observations. For each finding:

- **Title**: short descriptive name
- **Location**: file:line
- **Observation**: what you see in the code
- **Principle & Book Context**: State the principle that applies, then include a
  best-effort quote from the relevant section of *A Philosophy of Software Design*.
  Use your best recall of Ousterhout's actual words — direct quotes where you are
  confident, close paraphrases marked with "~" where you are approximating.
- **Suggestion**: concrete improvement (optional)

### What This Module Does Well

Briefly note areas where the code exemplifies good design — this provides balance and
highlights patterns to preserve.

### Recommended Follow-up Tasks

Bullet list of concrete tasks for **separate sessions**. Prioritize by impact.
Each should be self-contained and actionable without re-reading this analysis.
