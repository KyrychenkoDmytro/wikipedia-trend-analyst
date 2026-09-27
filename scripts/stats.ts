import type { Anomaly, ConfidenceLevel, PageviewPoint, TrendStats } from "./types.js";

/**
 * Ordinary least squares fit of y = a + b*x.
 * Returns slope (b), intercept (a), and r2 (coefficient of determination).
 * Returns nulls if there are fewer than 2 points or x has zero variance.
 */
export function linearRegression(
  xs: number[],
  ys: number[],
): { slope: number; intercept: number; r2: number } | null {
  const n = xs.length;
  if (n < 2 || n !== ys.length) return null;

  const xMean = xs.reduce((a, b) => a + b, 0) / n;
  const yMean = ys.reduce((a, b) => a + b, 0) / n;

  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - xMean;
    sxx += dx * dx;
    sxy += dx * (ys[i]! - yMean);
  }
  if (sxx === 0) return null;

  const slope = sxy / sxx;
  const intercept = yMean - slope * xMean;

  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const predicted = intercept + slope * xs[i]!;
    ssRes += (ys[i]! - predicted) ** 2;
    ssTot += (ys[i]! - yMean) ** 2;
  }
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;

  return { slope, intercept, r2 };
}

/** Median of a numeric array (copies before sorting; does not mutate input). */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/**
 * Robust outlier detection via Median Absolute Deviation (MAD).
 * A point is flagged when |x - median| / (1.4826 * MAD) exceeds `threshold`.
 * MAD is scale-invariant and, unlike z-scores from mean/stdev, isn't itself
 * dragged around by the very spikes we're trying to detect.
 */
export function detectAnomalies(points: PageviewPoint[], threshold = 3.5): Anomaly[] {
  if (points.length < 4) return [];
  const values = points.map((p) => p.views);
  const med = median(values);
  const absDeviations = values.map((v) => Math.abs(v - med));
  const mad = median(absDeviations);

  if (mad === 0) return [];

  const anomalies: Anomaly[] = [];
  for (let i = 0; i < points.length; i++) {
    const deviation = Math.abs(values[i]! - med) / (1.4826 * mad);
    if (deviation >= threshold) {
      anomalies.push({ date: points[i]!.date, views: values[i]!, deviation: Math.round(deviation * 10) / 10 });
    }
  }
  return anomalies;
}

/**
 * Computes a growth trend + a plain-language confidence rating for a pageview series.
 *
 * Method: linear regression on log(views + 1) vs. period index. Working in log
 * space turns "grew by a roughly constant percentage per period" into a straight
 * line, which is the shape product-decision questions ("is interest growing?")
 * usually care about, and keeps one huge month from dominating an ordinary-scale fit.
 *
 * This is a deliberately simple, transparent method — not a substitute for a
 * proper time-series significance test. See references/methodology.md for
 * what a v2 (e.g. Mann-Kendall, STL decomposition) would add.
 */
export function computeTrend(points: PageviewPoint[]): TrendStats {
  const totalViews = points.reduce((sum, p) => sum + p.views, 0);
  const meanViews = points.length ? totalViews / points.length : 0;
  const anomalies = detectAnomalies(points);

  const reasons: string[] = [];
  let growthPerPeriodPct: number | null = null;
  let growthOverWindowPct: number | null = null;
  let r2: number | null = null;

  const xs = points.map((_, i) => i);
  const ys = points.map((p) => Math.log(p.views + 1));
  const fit = linearRegression(xs, ys);

  if (fit) {
    growthPerPeriodPct = (Math.exp(fit.slope) - 1) * 100;
    r2 = Math.max(0, Math.min(1, fit.r2));
    const fittedFirst = Math.exp(fit.intercept);
    const fittedLast = Math.exp(fit.intercept + fit.slope * (points.length - 1));
    growthOverWindowPct = fittedFirst > 0 ? ((fittedLast - fittedFirst) / fittedFirst) * 100 : null;
  }

  let confidence: ConfidenceLevel = "low";

  if (points.length < 6) {
    confidence = "low";
    reasons.push(`only ${points.length} data point(s) — too little history to trust a trend`);
  } else if (r2 === null) {
    confidence = "low";
    reasons.push("could not fit a trend (flat or degenerate series)");
  } else {
    const anomalyShare = anomalies.length / points.length;
    if (anomalyShare > 0.15) {
      confidence = "low";
      reasons.push(
        `${anomalies.length} of ${points.length} points look like spikes (news mention, main-page feature, bot traffic) — the trend may be an artifact of those, not sustained interest`,
      );
    } else if (r2 < 0.3) {
      confidence = "low";
      reasons.push(`fit is noisy (R^2=${r2.toFixed(2)}) — the series doesn't move consistently in one direction`);
    } else if (r2 < 0.6) {
      confidence = "moderate";
      reasons.push(`fit is moderate (R^2=${r2.toFixed(2)}) — directionally suggestive, not conclusive`);
    } else {
      confidence = "high";
      reasons.push(`fit is consistent (R^2=${r2.toFixed(2)}) across the whole window`);
    }
    if (anomalies.length > 0 && anomalyShare <= 0.15) {
      reasons.push(`${anomalies.length} outlier point(s) detected but excluded from dominating the read — see anomalies list`);
    }
  }

  return {
    points: points.length,
    totalViews,
    meanViews,
    growthPerPeriodPct,
    growthOverWindowPct,
    r2,
    confidence,
    confidenceReasons: reasons,
    anomalies,
  };
}
