# Testing this skill on a cheap/free model - what actually happened

The task requires verifying the full scenario on a fast, inexpensive tool-using model, not just asserting it should work. This is the real transcript from that verification, run via `harness/run-agent.ts` against live OpenRouter models and the live Wikimedia API - not a mocked demo. Two real problems turned up. Both are fixed in this repo now; this file documents the evidence so the fix isn't just asserted either.

## Run 1: model unavailable

First attempt used `qwen/qwen3-coder:free` (a reasonable, well-known choice at the time this skill was written). It failed immediately:

```
Error: OpenRouter request failed (404 Not Found): {"error":{"message":"This model is unavailable for free.
The paid version is available now - use this slug instead: qwen/qwen3-coder", ...}}
```

That specific free model had been deprecated between when this was written and when it was tested - free-tier model availability on OpenRouter changes often enough that a hardcoded slug is not a durable choice. **Fix:** default `MODEL` to `openrouter/free`, OpenRouter's own router that auto-selects a currently-live, tool-capable free model, so this class of failure doesn't recur. `MODEL` remains overridable for pinning a specific model.

## Run 2: openrouter/free routed to a different model almost every turn, and the agent never finished

Prompt: *"Compare growth of interest in intermittent fasting in pl and cs wikipedia over the last 2 years"*

What happened, turn by turn:

1. **Turn 1** (`inclusionai/ling-3.0-flash-fin:free`) - correctly called `resolve_title` for both `pl.wikipedia` and `cs.wikipedia` in the same turn, per `SKILL.md`. Also hallucinated a call to a nonexistent `export` tool (apparently trying to act on `SKILL.md`'s "set `WIKI_UA_CONTACT`" instruction via a tool call). The harness returned a clean `Error: unknown tool "export"` - no crash, and the model dropped it and moved on.
2. **Turns 2-5** (four different underlying models: `dots-studio/dots-3-note-preview`, `liquid/lfm-2.5-2.6b`, `nvidia/nemotron-3-ultra-550b-a55b`, back to `ling-3.0-flash-fin`) - repeatedly re-ran `resolve_title` against `pl.wikipedia` with minor rewordings ("post przerywany", "Post przerywany", "przerywany post", "fasting", "Post_przerywany"). None returned a relevant match - results included things like "Charlie Kirk" and "Insulinooporność" (insulin resistance), not an intermittent-fasting article.
3. **Turn 6** - despite no `resolve_title` call ever confirming a Polish title, the model called `analyze` with `article: "Post_przerywany"` anyway - a title it had never actually gotten back from the tool. (Separately, live web research turned up no evidence this article exists on Polish Wikipedia at all - the search failures in turns 2-5 were very likely correct, not a fluke.) The Czech side was fine: `Přerušovaný_půst` came from a real, clean `resolve_title` result in turn 1.
4. **Turns 7-8** - the model went back and re-fetched `Post_przerywany` directly, got an empty series (`[]`), tried one more guessed variant (`Post_przerywany_(dieta)`), also empty - then the harness hit its turn cap before the model produced a final answer.

**What this actually shows, separated out:**

- The plumbing held up under real, messy conditions: a hallucinated tool call was handled gracefully, a client-side date-range guard fired correctly earlier in ad hoc testing, and an empty/wrong series didn't crash anything or get silently reported as a confident result - it just came back as zero points.
- `openrouter/free`'s free-to-choose-any-tool-capable-model-per-call behavior is a poor fit for a sustained multi-turn agentic task: five different models across eight turns, several of them very small (e.g. a 2.6B-parameter model), means no consistent plan or memory of "I already tried this" across the run. That's a property of the router, not of the skill.
- The real gap in the skill: `SKILL.md` said not to "silently pick a wrong article," but didn't say what to do when resolution genuinely fails, and didn't forbid using a title the tool never returned. A model under no explicit stop condition kept re-searching, then guessed anyway.

**Fixes made in response (see `SKILL.md`):**

- Explicit stop condition: at most 2 differently-phrased `resolve_title` attempts per (topic, wiki) pair, then either use the closest real candidate and flag the uncertainty, or ask the user - never a title the tool didn't return.
- Explicit rule: a 0-point series is a signal the title is probably wrong, not a finding that "interest is flat."
- Removed the unverified `pl.wikipedia=Post_przerywany` example from `SKILL.md` and `README.md` entirely, replacing it with the verified Czech example and a placeholder that has to come from a real `resolve_title` call.
- Bumped the harness's turn cap (8 -> 14) and lengthened its tool-result preview (300 -> 600 chars), since part of the failure was simply running out of room to recover.

## What to do with this

Re-running the same prompt now should look different: fewer, more purposeful `resolve_title` calls, and either a real Czech-only comparison with an explicit "couldn't confirm a Polish title" caveat, or a successful two-language comparison if resolution succeeds this time. If you re-run it (`cd harness && npx tsx run-agent.ts "..."`), that transcript is worth keeping too - this file is meant to be added to, not treated as a one-time box to check. Pinning a single stable model (e.g. `MODEL=moonshotai/kimi-k2.6:free`) instead of `openrouter/free` will also give a cleaner, more attributable signal for that kind of follow-up run, at the cost of being pinned to one model's specific quirks.
