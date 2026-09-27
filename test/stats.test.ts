import assert from "node:assert/strict";
import { computeTrend, detectAnomalies, linearRegression, median } from "../scripts/stats.js";
import type { PageviewPoint } from "../scripts/types.js";

function makeSeries(views: number[], startDate = "2024-01-01"): PageviewPoint[] {
  const start = new Date(startDate);
  return views.map((v, i) => {
    const d = new Date(start);
    d.setUTCMonth(d.getUTCMonth() + i);
    return { date: d.toISOString().slice(0, 10), views: v };
  });
}

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok: ${name}`);
}

check("linearRegression finds an exact line with r2 = 1", () => {
  const fit = linearRegression([0, 1, 2, 3], [10, 12, 14, 16]);
  assert.ok(fit);
  assert.ok(Math.abs(fit!.slope - 2) < 1e-9);
  assert.ok(Math.abs(fit!.r2 - 1) < 1e-9);
});

check("linearRegression returns null for a single point", () => {
  assert.equal(linearRegression([0], [5]), null);
});

check("median handles even and odd length arrays", () => {
  assert.equal(median([1, 3, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
});

check("detectAnomalies flags a single obvious spike, not the steady baseline", () => {
  const points = makeSeries([100, 105, 98, 102, 101, 5000, 99, 103]);
  const anomalies = detectAnomalies(points);
  assert.equal(anomalies.length, 1);
  assert.equal(anomalies[0]!.views, 5000);
});

check("computeTrend rates a clean, consistent upward series as high confidence, positive growth", () => {
  // Roughly +8%/month compounding, low noise.
  const views = [1000, 1080, 1166, 1260, 1360, 1469, 1587, 1714];
  const trend = computeTrend(makeSeries(views));
  assert.equal(trend.confidence, "high");
  assert.ok(trend.growthPerPeriodPct !== null && trend.growthPerPeriodPct > 5, `expected >5% growth, got ${trend.growthPerPeriodPct}`);
});

check("computeTrend rates a flat, noisy series as low confidence", () => {
  const views = [500, 520, 480, 510, 495, 505, 515, 490];
  const trend = computeTrend(makeSeries(views));
  assert.equal(trend.confidence, "low");
});

check("computeTrend rates a too-short series as low confidence regardless of shape", () => {
  const trend = computeTrend(makeSeries([100, 200, 400]));
  assert.equal(trend.confidence, "low");
  assert.ok(trend.confidenceReasons.some((r) => r.includes("data point")));
});

check("computeTrend flags a single-spike-driven series as low confidence with a spike warning", () => {
  // 6 points (>= the min-history threshold) with 1 anomaly = >15% of points flagged,
  // which is the branch that should call out "this looks like a spike, not a trend".
  const views = [100, 102, 98, 9000, 99, 101];
  const trend = computeTrend(makeSeries(views));
  assert.equal(trend.anomalies.length, 1);
  assert.equal(trend.confidence, "low");
  assert.ok(trend.confidenceReasons.some((r) => r.toLowerCase().includes("spike")));
});

console.log(`\n${passed} stats checks passed.`);
