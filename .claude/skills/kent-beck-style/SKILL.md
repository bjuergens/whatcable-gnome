---
name: kent-beck-style
description: Review code against Kent Beck's design heuristics — simple design rules, YAGNI, code smells, and refactoring readiness. Only trigger when the user explicitly mentions "Kent Beck", "beck style", "simple design", "beck review", or "/kent-beck-style" — e.g. "run kent beck on this", "beck style review of backend/app/", "check simple design". Do NOT trigger on general code review, refactoring requests, or Ousterhout-related queries.
user-invocable: true
disable-model-invocation: false
allowed-tools: Bash, Read, Grep, Glob, Agent
shell: bash
---

You are reviewing code against **Kent Beck's design heuristics**: the four rules of simple
design, YAGNI, code smells (from Beck and Fowler's catalogs), and refactoring readiness.
The user said: $ARGUMENTS

## Step 1: Determine scope

From the user's message, decide:
- **Target**: a specific file, a module directory, or a class/function name
  - If the user names a file: use that file
  - If the user names a directory: analyze source files in that directory
  - If no target: ask for one
- **Focus** (optional): a specific concept (e.g. "just YAGNI", "change preventers"), or all (default)

## Step 2: Pick files to analyze

If the target is a single file, use that file. Skip to Step 3.

If the target is a directory, list source files and pick the most substantial ones (up to 8).
Use file size and symbol count as heuristics — skip near-empty files.

```sh
bash .claude/skills/implicit-requirements/list-symbols.sh "$TARGET"
```

## Step 3: Spawn parallel agents — one per analysis group

Spawn **4 Agents in parallel**. Each agent receives the list of files to analyze and a
description of its assigned concepts.

- Agent 2 (YAGNI & Dispensables): use `subagent_type: general-purpose`, `model: sonnet` —
  it does multi-step work (read files, grep codebase for callers, count usage).
- All other agents: use `subagent_type: Explore`, `model: sonnet` — they only read and analyze.

**IMPORTANT**: Every agent must **read the actual file contents** before analyzing. Don't just
pass file paths — the agent needs to read and understand the code.

**IMPORTANT**: This project considers big functions acceptable ("A 100-line function that does
one clear thing is better than 10 tiny functions that require jumping around to understand the
flow"). Do NOT flag function length or class size. Instead, check whether long functions have
clear internal structure and do one coherent thing.

### Agent 1: Four Rules of Simple Design

> Kent Beck's four rules of simple design, in priority order:
> 1. **Passes the tests** — the code is correct (not statically checkable — skip this rule)
> 2. **Reveals intention** — you can understand what the code does by reading it
> 3. **No duplication** — every piece of knowledge has a single, unambiguous representation
> 4. **Fewest elements** — remove anything that doesn't serve the first three rules
>
> The key insight is the priority order. Rule 4 ("fewest elements") is the lowest priority —
> meaning you should only add abstractions, classes, or indirection when they serve rules 2 or 3.
> Unnecessary elements are worse than duplication, and duplication is worse than unclear intent.

For each file, read it fully. Then evaluate:

**Reveals Intention:**
1. Can you understand what each function does without reading its internals?
2. Does the code's behavior match what its signature and name promise?
3. Are there surprising side effects, hidden state changes, or misleading return types?
4. Are names vague (`data`, `result`, `process`, `handle`) or dishonest (a function named
   `validate_X` that also transforms, or `get_X` that has side effects)?
5. Would a reader's mental model match the actual execution?

**No Duplication:**
1. Are there duplicated business rules — the same decision or policy encoded in multiple places?
2. Are there repeated decision structures — similar if/else chains or match patterns that
   encode the same conceptual choice?
3. Is the same knowledge (format, protocol, domain rule) expressed in different ways across files?
4. Note: some code repetition is acceptable if extracting it would obscure intent (rule 2 > rule 3).

**Fewest Elements:**
1. Are there abstractions that don't earn their keep? Base classes with one subclass, interfaces
   with one implementation, wrapper classes that add no behavior?
2. Are there types defined but used only once, where an inline type would be clearer?
3. Are there configuration surfaces (env vars, settings, parameters) that could be hardcoded
   constants at this project's scale (10-100 users)?
4. Are there indirection layers (factories, registries, strategy patterns) that exist for
   a future that hasn't arrived?

For each finding: file:line, which rule, 1-2 sentence explanation, and a best-effort Beck
quote or paraphrase (mark with "~" if approximating).

### Agent 2: YAGNI & Dispensables

> **YAGNI** (You Aren't Gonna Need It): ~"Always implement things when you actually need them,
> never when you just foresee that you need them." — Kent Beck / Ron Jeffries
>
> **Speculative Generality** (Fowler): ~"Oh, I think we'll need the ability to do this kind
> of thing someday." Hooks, abstract classes, and parameters added for future flexibility
> that isn't needed yet.
>
> **Dead Code**: Code that is never executed — unreachable branches, unused functions, stale
> imports, commented-out blocks.
>
> **Lazy Class** (Fowler): A class that doesn't do enough to justify its existence.

**Special procedure** — this agent needs to grep across the codebase:

1. Read all target files fully.
2. List all public functions, classes, and constants defined in the target files.
3. For each public function/class, **grep the entire codebase** for callers/references
   outside the defining file. Flag those with zero external callers (excluding tests —
   a function called only from tests may still be dead in production).
4. For each function parameter with a default value, grep for callers that override the
   default. Flag parameters where no caller ever overrides the default — the parameter
   is speculative generality.
5. For each abstraction layer (base class, Protocol, ABC, interface), count concrete
   implementations. Flag single-implementation abstractions.
6. Look for commented-out code blocks (3+ consecutive commented lines that look like code,
   not documentation comments).
7. Look for TODO/FIXME comments that reference completed work or features that already exist.
8. Look for feature flags, environment variables, or configuration options that are always
   set to the same value across all environments.

**Batch grep calls** — combine related names into regex patterns where possible
(e.g. `func_a|func_b|func_c`) to reduce the number of grep calls.

For each finding: file:line, category (Dead Code / Speculative Generality / Lazy Class),
evidence (e.g. "0 callers found", "parameter `x` always passed as True", "1 implementation"),
and suggested action.

### Agent 3: Change Preventers & Couplers

> **Shotgun Surgery** (Fowler): ~"Every time you make a change, you have to make a lot of
> little edits to a lot of different classes." A single logical change requires touching
> many files.
>
> **Divergent Change** (Fowler): ~"One class is commonly changed in different ways for
> different reasons." The opposite of shotgun surgery — one file that changes for too many
> different reasons.
>
> **Feature Envy** (Fowler): ~"A method that seems more interested in a class other than
> the one it actually is in." A function that accesses another module's data more than its own.
>
> **Message Chains** (Fowler): ~"You see message chains when a client asks one object for
> another object, which the client then asks for yet another object..." Long chains of
> attribute access: `a.b.c.d.do_thing()`.

**IMPORTANT**: Do NOT flag function length. Big functions are acceptable per project principles.
Instead, for long functions, check whether they have clear internal structure and do one
coherent thing.

For each file, read it fully. Then check:

**Shotgun Surgery:**
1. Pick a concrete hypothetical change (e.g. "add a field to this model", "change this
   API response format", "add a new payment method")
2. Trace how many files would need to change — model, schema, service, API route, frontend
   type, frontend component
3. Is there a single source of truth, or is the same structure redefined in multiple places?
4. Flag cases where a single conceptual change would require editing 4+ files

**Divergent Change:**
1. Does this file mix multiple responsibilities that change for different reasons?
2. E.g. a service file that handles business logic AND data formatting AND notification
   sending AND error reporting
3. Would different future requirements (new business rule vs. new output format vs. new
   notification channel) all modify this same file?

**Feature Envy:**
1. Does a function access data from another module more than from its own?
2. Look for functions that take an object and pick apart 3+ attributes from it
3. Look for functions that import heavily from one other module and barely use their own
   module's code
4. Would this function make more sense living in the module it's reaching into?

**Message Chains:**
1. Look for chains of 3+ attribute accesses: `a.b.c.d`
2. Are the intermediate objects just structural containers with no behavior?
3. Could a method on an intermediate object eliminate the chain?

For each finding: file:line, smell name, what concrete change it would make harder,
and a specific suggestion.

### Agent 4: Refactoring Readiness

> Beck's practice centers on making code safe to change. ~"Make the change easy (this might
> be hard), then make the easy change." The question isn't "is this code perfect?" but
> "if I needed to change this tomorrow, how hard would it be?"

**IMPORTANT**: Do NOT flag function length. Big functions are acceptable per project principles.
Instead, check whether long functions have identifiable internal sections and consistent
abstraction levels.

For each file, read it fully. Then assess:

**Seam Analysis:**
1. Where are the natural points to introduce a change? Can you modify one section of a
   function without understanding the rest?
2. Are there clear boundaries between logical sections (even within a long function)?
3. Or are there monolithic blocks where any change requires understanding everything —
   deeply nested conditionals, interleaved concerns, variables used far from their definition?
4. Could you add a new case/branch without restructuring the surrounding code?

**Test Safety Net:**
1. For each major function or module, search for references in test files
2. Flag high-risk functions (touching DB, payments, auth, session management) that have
   no test references
3. Are edge cases and error paths tested, or only happy paths?
4. Note: don't penalize missing tests for trivial code — focus on risk

**Dependency Direction:**
1. Do dependencies point in a consistent direction? (e.g. routes → services → repositories → models)
2. Look for circular imports or backwards dependencies (a model importing from a service,
   a repository importing from a route)
3. Are there dependency cycles between modules?
4. Does the code use dependency injection or direct imports? Are dependencies explicit?

**Magic Values & Implicit Coupling:**
1. Hardcoded strings, numbers, or paths that appear in multiple files without a shared constant
2. Port numbers, URLs, column names, status strings, error messages that create invisible
   coupling — changing one would silently break the other
3. Are there implicit contracts between files (e.g. two files must agree on a string format
   but neither defines it as a constant)?

For each finding: file:line, category, what would break if changed (risk assessment),
and a concrete suggestion.

## Step 4: Produce report

After all agents return, synthesize findings into a single report. Guidelines:

- **Group by severity**: lead with the most impactful findings
- **Cross-reference**: if multiple agents flag the same area, combine their findings
- **Be concrete**: every finding must include file:line and a brief explanation
- **Skip clean areas**: don't list things that passed — only report problems
  (except in the scorecard and "does well" section)

### Simple Design Scorecard

| Rule (Priority Order) | Rating | Summary |
|----------------------|--------|---------|
| 1. Reveals Intention | ✅/⚠️/❌ | one-line summary |
| 2. No Duplication | ✅/⚠️/❌ | one-line summary |
| 3. Fewest Elements | ✅/⚠️/❌ | one-line summary |

Ratings:
- ✅ **Follows well**: the code demonstrates this rule
- ⚠️ **Partially follows**: some areas conform, others don't
- ❌ **Violates**: significant departures from this rule

### Findings by Severity

Group all findings across agents. Lead with the most impactful.

For each finding:
- **Category**: which Beck/Fowler concept
- **Location**: file:line
- **What**: 1-2 sentence description
- **Change impact**: what future change this makes harder (Beck's core question)
- **Beck context**: best-effort quote or paraphrase from Beck/Fowler, marked with "~" if approximating
- **Severity**: 🔴 blocks safe change / 🟡 increases change cost / 🟢 minor friction
- **Suggestion**: concrete action (optional)

### YAGNI Inventory

| Item | Type | Evidence | Action |
|------|------|----------|--------|
| `example_function()` | Dead code | 0 callers | Remove |
| `AbstractProcessor` | Speculative | 1 implementation | Inline |
| `ENABLE_FEATURE_X` | Dead flag | Always True | Remove flag, keep code |

(Only include this section if Agent 2 found items. Omit if clean.)

### Refactoring Readiness Assessment

For each major module/file analyzed:
- **Safety**: test coverage for key paths (high/medium/low)
- **Seams**: where safe changes can be introduced
- **Risk zones**: areas where changes would be hard to make safely
- **Dependency health**: clean / tangled / circular

### What This Code Does Well

Briefly note areas that exemplify Beck's values — simplicity, directness, appropriate
minimalism. The project's "big functions are fine" philosophy may itself be a strength here.

### Recommended Follow-up Tasks

Bullet list of concrete tasks for **separate sessions**. Each should be self-contained
and actionable without re-reading this analysis. Prioritize by:
1. Dead code removal (quick wins)
2. Change-safety improvements (reduce shotgun surgery)
3. Simplification (remove unnecessary elements)
