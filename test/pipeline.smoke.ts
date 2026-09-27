/**
 * Exercises the full pipeline (client -> analyze -> report) end to end with a
 * mocked `fetch`, so it runs offline and in CI without hitting wikimedia.org.
 *
 * This is deliberately NOT a substitute for a real hit against the live API —
 * see references/api-reference.md for the one live smoke-test command to run
 * by hand (e.g. from WebStorm's terminal) before trusting this in an agent.
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyze } from "../scripts/analyze.js";
import { generateReport } from "../scripts/report.js";

function monthlyDates(start: string, count: number): string[] {
  const dates: string[] = [];
  const d = new Date(start);
  for (let i = 0; i < count; i++) {
    dates.push(d.toISOString().slice(0, 10));
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return dates;
}

const toTimestamp = (date: string): string => `${date.replaceAll("-", "")}00`;

// One clearly-growing series, one flat/noisy series - lets us assert the
// trend math actually tells them apart, not just that the pipeline runs.
const fixtures: Record<string, number[]> = {
  "pl.wikipedia": [800, 850, 900, 1000, 1150, 1300, 1500, 1750],
  "cs.wikipedia": [400, 410, 395, 405, 402, 398, 407, 401],
};

let fetchCalls = 0;
// @ts-expect-error - intentionally replacing the global fetch for this offline smoke test
globalThis.fetch = async (url: string) => {
  fetchCalls++;
  const project = Object.keys(fixtures).find((p) => url.includes(`/${p}/`));
  if (!project) throw new Error(`smoke test has no fixture for URL: ${url}`);
  const views = fixtures[project]!;
  const dates = monthlyDates("2025-01-01", views.length);
  const items = views.map((v, i) => ({
    project,
    article: "Test_Article",
    granularity: "monthly",
    timestamp: toTimestamp(dates[i]!),
    access: "all-access",
    agent: "user",
    views: v,
  }));
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({ items }),
  } as unknown as Response;
};

const tmpDir = await mkdtemp(join(tmpdir(), "wta-smoke-"));
const outPath = join(tmpDir, "report.pdf");

const result = await analyze({
  topic: "Smoke test topic",
  series: [
    { project: "pl.wikipedia", article: "Test_Article", label: "Polish" },
    { project: "cs.wikipedia", article: "Test_Article", label: "Czech" },
  ],
  options: {
    access: "all-access",
    agent: "user",
    granularity: "monthly",
    start: "2025-01-01",
    end: "2025-08-01",
    refresh: true, // bypass cache so this test is deterministic and hits our mock every run
  },
});

assert.equal(result.results.length, 2);
assert.equal(fetchCalls, 2, "expected exactly one fetch per series - no redundant re-fetching within one run");
assert.equal(result.results[0]!.trend.confidence, "high", "clean upward Polish series should score high confidence");
assert.ok((result.results[0]!.trend.growthPerPeriodPct ?? 0) > 0, "Polish series should show positive growth");
assert.equal(result.results[1]!.trend.confidence, "low", "flat/noisy Czech series should score low confidence");
assert.equal(result.ranking[0]!.project, "pl.wikipedia", "ranking should surface the faster-growing series first");

await generateReport(result, outPath);
const pdfBytes = await readFile(outPath);
assert.ok(pdfBytes.length > 2000, `expected a non-trivial PDF, got ${pdfBytes.length} bytes`);
assert.equal(pdfBytes.subarray(0, 5).toString("latin1"), "%PDF-", "output file should be a real PDF");

await rm(tmpDir, { recursive: true, force: true });
console.log(`ok: pipeline smoke test passed (mocked fetch \u2192 analyze \u2192 ${pdfBytes.length}-byte PDF)`);
