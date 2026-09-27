# wikipedia-trend-analyst

An Agent Skill ([agentskills.io/specification](https://agentskills.io/specification)) that analyzes Wikipedia pageview trends across language editions: fetches real data, scores growth with a confidence rating, and renders a one-page PDF report. `SKILL.md` is what the AI agent reads; this README is for a human running it.

## 1. Install dependencies

```bash
npm install
cd harness && npm install && cd ..
```

Requires Node.js >=20.

## 2. Set credentials

```bash
export WIKI_UA_CONTACT="you@example.com"   # Wikimedia asks every API client to identify itself
export OPENROUTER_API_KEY=sk-or-...        # only needed for step 4 below (testing on a cheap agent model)
```

## 3. Run it

**a) Sanity check** - confirms real network access before anything else:

```bash
npm run cli -- fetch --project en.wikipedia --article "Wikipedia" --start 2025-01-01 --end 2025-02-01
```

Should print real numbers, not an error.

**b) Full comparison + PDF report** - a verified, real worked example (see `TESTING.md` for how it was verified):

```bash
npm run cli -- analyze \
  --series "cs.wikipedia=Přerušovaný_půst|Czech" \
  --series "uk.wikipedia=Інтервальне_голодування|Ukrainian" \
  --start 2023-09-01 --end 2025-09-01 \
  --granularity monthly \
  --topic "Intermittent fasting" \
  --out report.pdf
```

Prints the full JSON result to stdout and writes `report.pdf` - open it with any PDF viewer. To try a different topic/languages, first resolve the real article title on each wiki rather than assuming one:

```bash
npm run cli -- resolve-title --project uk.wikipedia --query "your topic here"
```

**c) Test suite:**

```bash
npm run typecheck
npm test
```

## 4. Test the skill on a cheap agent model

This is the task's actual requirement: verify the full scenario on a fast, inexpensive tool-using model, not just assert it should work.

```bash
cd harness
npx tsx run-agent.ts "Compare growth of interest in intermittent fasting in cs and uk wikipedia over the last 2 years"
```

**Read `TESTING.md` first.** It's the real transcript of this exact process finding and fixing two genuine bugs (a deprecated free model, and a data-boundary bug that was silently corrupting growth numbers) - that write-up, not a clean first-try success, is the actual evidence this requirement was taken seriously.

## What's in this repo

- `SKILL.md` - the instructions the AI agent reads
- `scripts/` + `references/` - the skill's own code and its reference docs
- `test/` - the skill's unit + offline smoke tests
- `harness/` - standalone tool used to test the skill against a real cheap model (not part of the skill itself)
- `TESTING.md` - the real evidence from doing that
