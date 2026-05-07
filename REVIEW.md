# Code Review Checklist

Red flags from Ousterhout, tailored to this codebase.

2. **Helper exists but was bypassed** — new code duplicates an existing helper instead of calling it. Ask: "why not use the existing function?"
3. **Parallel branches on the same type** — two functions both switch on the same enum. Ask: "could a new variant be added in one place?"
4. **Name doesn't match behavior** — `validate_*` that returns data, `get_*` that mutates, same name meaning different things in different places.
5. **Magic numbers** — unnamed literal repeated in multiple places. Fix: named constant.
6. **Abstraction without benefit** — does an abstraction have a real, concrete benefit, or is it just indirection?
8. **Unjustified dependency** — does this dependency earn its place, or could stdlib or a smaller library do the job?

## General

* **Lying names and comments** — does the name/comment match what the code does? Does the code have side effects not implied by the name? Are comments still justified?
* **Self-healing instead of failing fast** — silent recovery (defaults, fallbacks, retries) where it should throw. If it's wrong, be loud.
* Could it be stricter? were constraints relaxed ? Nullable fields? optional parameters? default values? catch/except blocks?
* avoid Default values without good reason. If a caller forgets an argument, that is an error. 
* are we failing fast? are errors loud? is there a chance of silently swallowing unexpected situations? were error/exceptions removed or downgraded?
* is the implementation clever? or non obvious? or deviates from established princples?


## what to flag

* was a pragmatic approach used instead of a "correct" or "official" one?
* were pre-existing failures or issues skipped? 

## after review

* which flagged issues hint at bad design in surrounding code?
