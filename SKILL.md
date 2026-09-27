---
name: wikipedia-trend-analyst
description: Analyzes Wikipedia pageview trends across one or more language editions to help product teams decide which topics or markets deserve attention. Fetches real data from the Wikimedia Analytics (AQS) pageviews API, scores growth with a plain-language confidence rating (flagging spikes, bot traffic, or too-short history), and renders a one-page PDF report with a chart. Use whenever asked to compare interest in a topic across languages/wikis, check whether interest in something is growing on Wikipedia, or produce a shareable, data-backed trend report. Not for general Wikipedia content lookups, article text/summaries, or edit-history questions - use a plain web fetch for those.
license: MIT
compatibility: Requires Node.js >=20 and outbound network access to wikimedia.org and *.wikipedia.org. Run `npm install` once inside this skill's directory before first use.
metadata:
  version: 0.1.0
---

# Wikipedia Trend Analyst

## What this does

Given a topic and one or more Wikipedia language editions, this skill:

1. resolves the topic to the exact article title on each wiki (titles are almost never literal translations of each other),
2. fetches the pageview history for each from the Wikimedia Analytics API,
3. fits a growth trend per series and rates how much to trust it (not just a slope number - it flags short history, noisy/flat series, and single-spike-driven "growth"),
4. optionally renders a one-page PDF with a chart comparing all series plus a plain-language assumptions/limitations section.

All of the substantive work (fetching, regression, anomaly detection, chart drawing, PDF layout) happens in `scripts/*.ts` - you are orchestrating a real analysis pipeline, not writing analysis code from scratch each time.

## Before you start

Run once, in this directory: `npm install`. Every command below is invoked as `npm run cli -- <command> [options]` (the `--` matters: it passes the following flags to the CLI instead of to npm).

Set a real contact string once per environment: `export WIKI_UA_CONTACT="you@example.com"` (Wikimedia's API etiquette policy asks every client to identify itself). You can also pass `--contact` on any command instead.

## Step 1: find the exact article title on each wiki

Don't guess a title from an English topic name - resolve it:

```
npm run cli -- resolve-title --project pl.wikipedia --query "intermittent fasting"
```

This returns candidate `{ key, title, description }` objects from that wiki's own search. Use the `key` field verbatim as the `article` value in later steps - it's already in the underscore-safe form the pageviews API expects.

**Stop condition - do not skip this.** Try at most 2 differently-phrased queries per (topic, wiki) pair (e.g. the English name, then a natural phrase in that wiki's language). If neither attempt returns a candidate whose `description` (or clearly self-explanatory `title`) matches the topic:

- Do **not** invent, assume, or reuse a title that never appeared in a `resolve-title` result - not even one that "looks right" or that you recognize from training data. Real testing found a model doing exactly this (guessing an untested Polish title that turned out not to exist) and it silently produced a report row full of zeros instead of catching the problem.
- Either pick the closest thematically-related real candidate you actually got back and clearly flag the uncertainty in your final answer ("closest match I found was X, which may not be exactly right"), or tell the user you couldn't confidently identify the article on that wiki and ask them to confirm it. Don't do both silently and hope for the best.

A series that comes back with 0 data points is itself a signal, not a finding - it almost always means the title was wrong, not that "nobody is interested." Re-check the title (or ask the user) before reporting a flat/zero result as if it told you something about interest.

## Step 2: run the analysis

```
npm run cli -- analyze \
  --series "cs.wikipedia=Přerušovaný_půst|Czech" \
  --series "uk.wikipedia=<key from resolve-title>|Ukrainian" \
  --start 2023-09-01 --end 2025-09-01 \
  --granularity monthly \
  --topic "Intermittent fasting" \
  --out report.pdf
```

Every `article` value in `--series` must be a `key` that actually came back from `resolve-title` in Step 1 (or one the user gave you directly) - never a guessed translation. `Přerušovaný_půst` above is a real, verified Czech Wikipedia title, shown as a concrete example of the *format*; it is not a hint that similarly-plausible-looking titles in other languages exist or are correct - always confirm per language.

- Repeat `--series project=article|Label` once per language/edition being compared. The `|Label` suffix is optional (defaults to the project name) and is only used for display.
- This single command does everything: fetch (with on-disk caching) + trend scoring + PDF. Prefer this over calling `fetch` separately for each series when you already know the titles - fewer tool calls, fewer chances to make a mistake partway through.
- It always prints the full result as JSON to stdout, whether or not `--out` is given. Read that JSON before writing anything to the user - it's how you check the numbers you're about to describe.

### Choosing defaults when the user didn't specify them

- **Date range**: if not given, use the last 24 months up to today.
- **Granularity**: `monthly` for ranges longer than ~6 months, `daily` for shorter ones. When unsure, `monthly` is the safer default.
- **access**: leave at the default (`all-access`) unless the user specifically cares about mobile vs. desktop behavior.
- **agent**: leave at the default (`user`). Only switch to `all-agents` if the user explicitly wants bot/crawler traffic included - otherwise it will silently inflate "interest" with non-human hits.
- **Report file**: only pass `--out` when the user asked for a report/PDF/chart, or when you're about to hand off a written summary that would benefit from one. For a quick "is X growing?" question, the JSON alone plus a short prose answer is often enough.

Only ask the user a clarifying question when a default would clearly produce the wrong answer for what they asked (e.g. they named a language you can't map to a wiki project code, or a topic too ambiguous to resolve confidently). Otherwise, pick the sensible default, proceed, and say what you assumed.

## Step 3: interpret the result before you say anything to the user

Each series in the JSON has a `trend` object:

- `growthPerPeriodPct`: estimated % change per period (per the chosen granularity), from a log-linear fit. This is a rate, not a one-time total change.
- `r2`: how well the data actually follows that trend line (0-1). Low r2 means "noisy or non-monotonic", not "no data".
- `confidence`: `"low" | "moderate" | "high"`, plus `confidenceReasons` explaining why. **Always reflect this in your answer.** Don't report a "low" confidence trend with the same certainty as a "high" one - say so explicitly (e.g. "Ukrainian pageviews are up, but with only 8 months of history this is a low-confidence read").
- `anomalies`: dates that look like spikes (a news mention, a main-page feature, a bot crawl) rather than sustained interest. If a series' growth number is being driven by one of these, call that out - don't launch straight into "recommendations" as if the number were solid.
- `ranking` (top-level, not per-series): the series sorted fastest-growing first - useful for "which of these should we prioritize" style questions, but re-check confidence before treating the top of that list as a strong signal.

Also always mention, once, somewhere in your answer: **pageview interest is not the same as willingness to pay or demand for a specific product feature.** This is a prioritization signal, not a go/no-go decision by itself. (The PDF report already says this - if you generated one, you don't need to repeat it at length, just don't contradict it.)

## Handling follow-up / related questions efficiently

- Responses are cached on disk (`cache/`) for 7 days, keyed by every parameter that affects them. A follow-up like "now add German too" only needs a new `--series` entry added to the same command - the previously-fetched series come straight from cache, so re-running the full command is cheap. You don't need to hand-manage what's cached; just re-issue `analyze` with the union of series you now want.
- If the user only wants to add or check one more language without regenerating the whole report yet, use `fetch` (single series, no PDF, no trend math) as a fast intermediate step, then fold it into a full `analyze` call once they're ready for the comparison/report.
- If a number looks surprising, re-run with `--refresh` before assuming the analysis is wrong - it forces a fresh fetch past the cache.
- **The user can change an assumption from your first answer at any point** - a wider date range, a different granularity, a different topic or language entirely, a different confidence bar for what counts as "worth pursuing." Treat this exactly like a normal new request: re-run `analyze` (and `resolve-title` first, if the topic/language changed) with the updated parameters, and say plainly what changed from before ("widening to 3 years now, here's how that shifts the picture") rather than silently re-answering as if it were the first question. The cache means only the parameters that actually changed cost a fresh fetch - you're not redoing the whole analysis from scratch.

## Known limitations to be upfront about (don't oversell the analysis)

- The growth estimate is a simple log-linear regression, not a formal significance test. It's a reasonable "is this going up or down, and how confidently" read, not a peer-reviewed trend analysis. See `references/methodology.md` for what a more rigorous version would look like, and mention that this is the current method if the user pushes on precision.
- Comparing raw view counts across languages is misleading (bigger wikis simply have more traffic); the report's chart therefore indexes each series to its own first period = 100 when comparing more than one language. Don't quote raw pageview counts as if they were comparable across languages unless the user specifically wants absolute reach, not relative growth.
- Data only exists from 2015-07-01 onward, and the most recent day or two may be missing (publication lag) - neither is a bug.

See `references/api-reference.md` for exact endpoint/parameter details and `references/methodology.md` for the trend/confidence methodology and how to extend it for larger or more rigorous analyses.
