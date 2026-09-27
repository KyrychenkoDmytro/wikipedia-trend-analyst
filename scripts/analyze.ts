import { computeTrend } from "./stats.js";
import type { AnalysisResult, FetchOptions, SeriesResult, SeriesSpec } from "./types.js";
import { fetchPageviews } from "./wikimedia-client.js";

export interface AnalyzeInput {
  topic: string;
  series: SeriesSpec[];
  options: FetchOptions;
}

/**
 * Fetches and scores every requested series, then ranks them by growth so the
 * agent (and the eventual report) can lead with "here's what's rising fastest"
 * rather than making the reader scan a wall of numbers.
 */
export async function analyze(input: AnalyzeInput): Promise<AnalysisResult> {
  const notes: string[] = [];
  if (input.options.agent === "all-agents") {
    notes.push(
      "agent=all-agents includes spider/bot traffic; that traffic doesn't reflect human reader interest and can distort growth numbers. Prefer agent=user unless there's a specific reason not to.",
    );
  }

  const results: SeriesResult[] = [];
  for (const spec of input.series) {
    const points = await fetchPageviews(spec, input.options);
    if (points.length === 0) {
      notes.push(
        `${spec.project}/${spec.article}: no data returned — check the exact article title exists on that wiki (titles are case-sensitive and language-specific; this is NOT the same page as on another language's wiki).`,
      );
    }
    results.push({ spec, options: input.options, series: points, trend: computeTrend(points) });
  }

  const ranking = [...results]
    .sort((a, b) => {
      const ag = a.trend.growthPerPeriodPct;
      const bg = b.trend.growthPerPeriodPct;
      if (ag === null && bg === null) return 0;
      if (ag === null) return 1;
      if (bg === null) return -1;
      return bg - ag;
    })
    .map((r) => ({
      project: r.spec.project,
      article: r.spec.article,
      growthPerPeriodPct: r.trend.growthPerPeriodPct,
    }));

  return {
    topic: input.topic,
    generatedAt: new Date().toISOString(),
    results,
    ranking,
    notes,
  };
}
