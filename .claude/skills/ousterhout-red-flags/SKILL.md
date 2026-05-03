---
name: ousterhout-red-flags
description: Check code for red flags from Ousterhout's "A Philosophy of Software Design". Only trigger when the user explicitly mentions "ousterhout red flags", or "/ousterhout-red-flags" or "philosophy of software design red flags" — e.g.  "run ousterhout red flags on backend/app/". Do NOT trigger on general code review or design questions.
user-invocable: true
disable-model-invocation: false
allowed-tools: Bash, Read, Grep, Glob, Agent
shell: bash
---

You are analyzing code for **red flags** from John Ousterhout's *A Philosophy of Software Design*.
The user said: $ARGUMENTS

## Step 1: Determine scope

From the user's message, decide:
- **Target**: a specific file, a module directory, or a class/function name
  - If the user names a file: use that file
  - If the user names a directory: analyze Python/TS/JS files in that directory
  - If no target: ask for one
- **Focus** (optional): a specific red flag category, or all (default)

## Step 2: Pick files to analyze

If the target is a single file, use that file. Skip to Step 3.

If the target is a directory, list source files and pick the most substantial ones (up to 8).
Use file size and symbol count as heuristics — skip near-empty files.

```sh
bash .claude/skills/implicit-requirements/list-symbols.sh "$TARGET"
```

## Step 3: Spawn parallel agents — one per red flag group

Spawn **up to 6 Agents in parallel**. Each agent receives the list of files to analyze and a
description of its assigned red flags.

- Agent 2 (Information Leakage): use `subagent_type: general-purpose`, `model: sonnet` —
  it does multi-step work (list symbols, grep codebase, evaluate hits).
- All other agents: use `subagent_type: Explore`, `model: sonnet` — they only read and analyze.

**IMPORTANT**: Every agent must **read the actual file contents** before analyzing. Don't just
pass file paths — the agent needs to read and understand the code.

### Agent 1: Module Depth (Shallow Module + Pass-Through Method)

> **Shallow Module**: the interface for a class or method isn't much simpler than its
> implementation (p. 25, 110). A deep module has a simple interface but complex internals.
> A shallow module's interface is nearly as complex as what it does — it doesn't hide much.
>
> **Pass-Through Method**: a method does almost nothing except pass its arguments to another
> method with a similar signature (p. 46). These add interface complexity without functionality.

For each file, read it fully. Then:
1. List all public functions/methods and classes with their signatures
2. For each, estimate the ratio of interface complexity to implementation complexity
3. Flag functions where the interface is nearly as complex as the implementation
4. Flag methods that just delegate to another method with similar arguments
5. For each finding, give: file:line, function name, and a 1-2 sentence explanation

### Agent 2: Information Leakage + Temporal Decomposition

> **Information Leakage**: a design decision is reflected in multiple modules (p. 31).
> Knowledge that should be encapsulated in one place leaks into others — changes to that
> decision then require modifying multiple files.
>
> **Temporal Decomposition**: the code structure is based on the order in which operations
> are executed, not on information hiding (p. 32). E.g. separate read/parse/process functions
> that each know about the file format, instead of one module that hides the format.

**Special procedure for Information Leakage**:
1. Read all target files
2. List all public names: function names, class names, constants, config keys, type names,
   important string literals, column names, enum values
3. **Filter before grepping** — skip generic/trivial names (`get`, `create`, `data`, `result`,
   `id`, `name`, etc.) and very short names (≤3 chars). Prioritize domain-specific names,
   constants, config keys, and type names that encode design decisions.
4. **Batch grep calls** — combine related names into regex patterns where possible
   (e.g. `COLUMN_A|COLUMN_B|COLUMN_C`) to reduce the number of grep calls.
5. For each name, search the **entire codebase** for references outside the target module
   (exclude the file that defines it)
6. For each cross-module reference, evaluate: is this a normal public API usage, or does it
   reveal a design decision leaking across module boundaries?
7. Focus on: format details, protocol specifics, column/field names used in multiple places,
   magic constants, internal state shape exposed to callers

For Temporal Decomposition:
1. Look for groups of functions that mirror a temporal sequence (init/process/cleanup,
   read/parse/validate, before/during/after)
2. Check if these functions share knowledge about internal details (data formats, state shape)
   that could be hidden behind a single deeper interface

### Agent 3: Interface Design (Overexposure + Special-General Mixture)

> **Overexposure**: An API forces callers to be aware of rarely used features in order to use
> commonly used features (p. 36). E.g. requiring configuration objects with many fields when
> most callers only need defaults.
>
> **Special-General Mixture**: special-purpose code is not cleanly separated from general
> purpose code (p. 65). E.g. a utility function that handles one specific business case inline.

For each file:
1. Read the code fully
2. For public APIs: are callers forced to understand/provide things they rarely need?
   Look for functions with many parameters where most callers pass the same values.
3. For mixed code: is business-specific logic tangled with general-purpose utilities?
   Look for if-branches or special cases embedded in otherwise generic code.

### Agent 4: Code Dependencies (Repetition + Conjoined Methods)

> **Repetition**: a nontrivial piece of code is repeated over and over (p. 62). Not just
> duplicate lines — repeated patterns, logic, or decision-making across multiple places.
>
> **Conjoined Methods**: two methods have so many dependencies that it's hard to understand
> the implementation of one without understanding the other (p. 72). They share mutable state,
> call each other in complex ways, or rely on implicit ordering.

For each file:
1. Read the code fully
2. Look for repeated logic patterns (not just copy-paste — also repeated decision structures,
   similar error handling chains, duplicated validation logic)
3. Look for method pairs that are tightly coupled through shared state or implicit contracts
4. For conjoined methods: would you need to read method B to understand method A?

### Agent 5: Documentation Quality (Comment Repeats Code + Implementation Contaminates Interface)

> **Comment Repeats Code**: all of the information in a comment is immediately obvious from
> the code next to the comment (p. 104). E.g. `# increment i` above `i += 1`.
>
> **Implementation Documentation Contaminates Interface**: an interface comment describes
> implementation details not needed by users of the thing being documented (p. 114).
> E.g. a docstring that explains internal data structures instead of what the function does
> for the caller.

For each file:
1. Read the code fully
2. Flag comments that add zero information beyond what the code says
3. Flag docstrings/interface comments that describe *how* instead of *what* — internal
   algorithms, private data structures, implementation steps that callers don't need to know
4. Note: absence of comments is NOT a red flag here — only bad comments are flagged

### Agent 6: Naming & Clarity (Vague Name + Hard to Pick Name + Hard to Describe + Nonobvious Code)

> **Vague Name**: the name of a variable or method is so imprecise that it doesn't convey
> much useful information (p. 123). E.g. `data`, `result`, `process`, `handle`, `info`.
>
> **Hard to Pick Name / Dishonest Name**: a name that seems forced, overly long, or doesn't
> match what the thing actually does (p. 125). This often indicates the entity is doing too
> many things, the abstraction boundary is wrong, or the name was picked to match a convention
> rather than reality.
>
> **Hard to Describe**: in order to be complete, the documentation for a variable or method
> must be long (p. 131). If you can't describe it briefly, the design may be too complex.
>
> **Nonobvious Code**: the behavior or meaning of a piece of code cannot be understood easily
> (p. 148). Clever tricks, implicit side effects, non-local behavior, or reliance on subtle
> ordering.

For each file:
1. Read the code fully
2. Flag variables/functions with vague names that don't communicate intent
3. Flag names that seem forced, overly long, or don't match what the thing actually does —
   e.g. a function named `validate_X` that also transforms, or `get_X` that has side effects.
   If the name doesn't fit naturally, the abstraction may be wrong.
4. Flag code blocks that require significant mental effort to understand: implicit type
   conversions, boolean logic that's hard to trace, side effects hidden in expressions,
   magic numbers without explanation

## Step 4: Produce report

After all agents return, synthesize findings into a single report. Guidelines:

- **Group by severity**: lead with the most impactful findings
- **Cross-reference**: if multiple agents flag the same area, combine their findings
- **Be concrete**: every finding must include file:line and a brief explanation
- **Skip clean areas**: don't list things that passed — only report problems
- **Rate each finding**: 🔴 serious (redesign needed), 🟡 moderate (worth fixing), 🟢 minor (nice-to-have)

### Red Flags Summary

| Red Flag | Count | Severity | Key Locations |
|----------|-------|----------|---------------|
| Shallow Module | N | 🔴/🟡/🟢 | file:line, ... |
| ... | | | |

### Detailed Findings

For each finding:
- **Red flag**: which one
- **Location**: file:line
- **What**: 1-2 sentence description
- **Why it matters**: connection to Ousterhout's principle
- **Suggestion**: concrete action (optional — only if a fix is obvious)

### Recommended Follow-up Tasks

Bullet list of concrete tasks for **separate sessions**. Each should be self-contained
and actionable without re-reading this analysis.
