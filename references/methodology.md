# Methodology: trend, confidence, and where this analysis stops

## How growth is estimated

For each series, `scripts/stats.ts` fits an ordinary least-squares line to `log(views + 1)` against the period index (0, 1, 2, ...). Working in log space turns "grew by roughly a constant percentage per period" into a straight line, which matches how "is interest growing?" questions are usually meant, and keeps one unusually large period from dominating a fit done on raw counts.

- `growthPerPeriodPct = (e^slope - 1) * 100` - the estimated compounding % change per period.
- `growthOverWindowPct` - the same fit evaluated at the first vs. last period, i.e. the total estimated change across the whole window.
- `r2` - the standard coefficient of determination of the fit, in log space. Treat this as a rough "does the data actually move in one consistent direction" signal, not a p-value or a formal significance test.

## How confidence is assigned

Plain-language, rule-based (see `computeTrend` in `scripts/stats.ts`), in this order:

1. Fewer than 6 data points -> **low** ("too little history to trust a trend"), regardless of how clean the fit looks. A 3-point "trend" is usually noise wearing a costume.
2. More than 15% of points flagged as anomalies (see below) -> **low**, with an explicit note that the growth number may be an artifact of those spikes rather than sustained interest.
3. Otherwise, by r2: `< 0.3` -> **low** (noisy/non-monotonic), `0.3-0.6` -> **moderate** (directionally suggestive), `>= 0.6` -> **high** (consistent across the window).

This is intentionally simple and auditable over being maximally sophisticated - every report can say exactly why it rated something the way it did (`confidenceReasons` is always populated), which matters more for a decision-support tool than a marginally tighter statistical test would.

## Anomaly detection

`detectAnomalies` uses a **Median Absolute Deviation (MAD)** test rather than a mean/standard-deviation z-score: a point is flagged when its distance from the median exceeds `3.5 * 1.4826 * MAD`. MAD is robust to the very outliers it's being used to detect - a mean/stdev z-score gets dragged toward a huge spike and can under-flag it, while the median and MAD barely move. Series with fewer than 4 points skip anomaly detection entirely (not enough data for "typical" to mean anything).

An anomaly is a **flag for the agent and the reader to investigate**, not an automatic exclusion from the trend fit - the regression still runs on the full series. This is a deliberate choice: silently dropping "outlier" points from a small pageview series is exactly the kind of invisible massaging that would make a report's conclusions less trustworthy, not more. It's better to fit the real data and say "this looks spike-driven" than to fit a cleaned version and imply the data was smoother than it was.

## Why cross-language comparisons are indexed, not raw

A big-wiki language (English, German, Spanish) will always have far more raw pageviews than a smaller one, regardless of relative interest in a specific topic. Comparing raw counts across languages therefore mostly measures wiki size, not topic interest. `report.ts` indexes each series to its own first period = 100 whenever more than one series is being charted, so the chart compares *growth shape*, not *traffic volume*. The summary table still reports real point counts and R² per series so nothing is hidden - just don't read the chart's y-axis as "views".

A sharper version of this (not implemented here) would normalize each article's views by that project's *total* pageviews for the same period (via the AQS `aggregate` endpoint), giving a "share of attention" metric instead of an index-to-100 metric. Worth adding if absolute cross-language comparison (not just growth-shape comparison) becomes a common ask.

## Explicit limitations (say these out loud when they apply)

- **Correlation, not intent.** Rising pageviews mean more people are reading about a topic, not that they want a product about it, or would pay for one. Treat this as a prioritization signal for further validation (a landing page test, a survey, a small ad spend), never as a standalone go/no-go.
- **A regression is not a hypothesis test.** `r2` is a fit-quality heuristic here, not a p-value from a proper time-series significance test (e.g. Mann-Kendall). Don't describe a "high confidence" result as "statistically significant" - say "consistent trend over the observed window" instead.
- **One article is not a topic.** A real-world "topic" (e.g. a course subject, a product category) is often better represented by several related articles than by guessing a single canonical one. The current pipeline treats each `--series` entry as exactly one article; see the extension notes below for combining several into one topic.

## How to extend this for bigger or more rigorous analyses

Roughly in order of "next thing worth building," not all at once:

1. **Multi-article topics.** Let one `--series` entry accept several article titles (sum their views before fitting) so "interest in astronomy" isn't reduced to whichever single article you happened to pick. Needs a small change to `SeriesSpec` (an array of articles instead of one) and a sum step before `computeTrend`.
2. **A real trend-significance test**, e.g. Mann-Kendall, in place of (or alongside) the log-linear R² heuristic - meaningfully stronger for genuinely noisy series, at the cost of a slightly heavier dependency and less intuitive output for a report reader.
3. **Seasonality handling.** Many topics have a natural yearly cycle (e.g. exam-related topics spiking every spring); an STL-style decomposition would separate "seasonal wobble" from "structural growth" instead of letting a MAD-based anomaly check flag every seasonal peak as a one-off spike.
4. **Share-of-attention normalization** (see above) instead of index-to-100, for cross-language comparisons that need to speak to absolute reach, not just growth shape.
5. **Bulk data for large sweeps.** The per-article endpoint is fine for a handful of series per request; if an analysis ever needs dozens of articles across many wikis, switch to Wikimedia's bulk pageview dumps (`dumps.wikimedia.org/other/pageviews/`) instead of one HTTP call per article - much faster and kinder to the API for that scale.
6. **A persistent, shared cache** (e.g. SQLite or MongoDB instead of the current flat-file cache) once the skill runs across many invocations/sessions rather than one CLI process at a time - useful once there's a longer-lived host (a scheduled job, a small service) worth keeping warm.
