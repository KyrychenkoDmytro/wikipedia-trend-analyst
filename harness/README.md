# agent-harness

A minimal (~200 line, zero runtime dependencies) OpenRouter tool-calling loop for testing `wikipedia-trend-analyst` against a real, cheap model - without Claude Code or any other polished agent host in between. It exists to give an honest answer to the task's actual requirement: *can a fast, inexpensive tool-using model use this skill correctly from `SKILL.md` alone?*

This is **not part of the skill**. It plays the role of "the agent" so the skill can be tested from outside.

## Setup

Lives inside the skill's own repo, one level down (`wikipedia-trend-analyst/harness/`). It finds the skill automatically (one directory up) - override with `SKILL_DIR` only if you move this folder elsewhere.

```bash
cd harness
npm install
```

Get a free OpenRouter API key at https://openrouter.ai/, then:

```bash
export OPENROUTER_API_KEY=sk-or-...
```

`MODEL` defaults to `openrouter/free` - OpenRouter's own router, which auto-picks a currently-live free model that supports tool calling, so this default doesn't break every time a specific free model gets deprecated (which happens often - `qwen/qwen3-coder:free`, an earlier pick here, is already gone as of this writing). Each turn logs which underlying model actually answered (`answered by: ...`), since `openrouter/free` can pick a different one per call.

To pin one specific model instead (e.g. to reproduce a result, or because you want to test one model in particular), set `MODEL` - check https://openrouter.ai/models?pricing=free for what's currently live, since any name written down today can be gone by the time you read this. As of writing, `moonshotai/kimi-k2.6:free` and `deepseek/deepseek-v4-flash:free` are both live, free, and tool-capable:

```bash
export MODEL=moonshotai/kimi-k2.6:free
```

## Running a real scenario

```bash
npx tsx run-agent.ts "Compare growth of interest in intermittent fasting in pl and cs wikipedia over the last 2 years"
```

This prints every model turn, every tool call the model makes (with its arguments), and a preview of each tool result, ending with the model's final plain-language answer. Try the other two example prompts from the task brief too:

```bash
npx tsx run-agent.ts "We're thinking about adding an astronomy course to our education app. Is interest in this topic growing in Ukrainian Wikipedia, and how much should we trust that growth?"
npx tsx run-agent.ts "We're building a language-learning app. Compare interest in learning English across our selected language editions and prepare a short report on which audiences to research next."
```

## What to actually look for

This is a real test, not a demo - things can go wrong, and that's useful information:

- Does the model call `resolve_title` before guessing an article title, for languages where a literal translation would be wrong?
- Does it pick reasonable defaults (date range, granularity) per `SKILL.md` rather than stalling with clarifying questions?
- Does its final answer reflect `confidence`/`anomalies` from the JSON, or does it just restate a growth percentage as if it were certain?
- Does it recover sensibly from a tool error (e.g. a 404 for a wrong title), or does it just repeat the same failing call?

## Tests

```bash
npm test
```

Verifies the harness's tool-execution layer against the **real** skill CLI (spawns an actual child process) without needing a network connection or an API key: one case hits the skill's own client-side date-range guard (proves real process spawning + stderr capture), another hits a real (locally blocked, if you're in a sandboxed environment) network call and confirms the failure comes back as a clean tool result instead of crashing the harness. Running an actual model turn still requires `OPENROUTER_API_KEY` and outbound network access - there's no way to test that part without both.

## Free-tier limits to plan around

Roughly (verify current numbers in OpenRouter's docs - they do change): 20 requests/minute always; 50 requests/day with no credit ever purchased, or 1000/day once you've bought $10+ of credit at any point (permanent unlock, independent of current balance). A handful of full scenario runs easily fits in 50/day; if you want to run all three example prompts several times each while iterating, either pace it out or spend the $10 once.
