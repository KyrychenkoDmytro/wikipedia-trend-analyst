/**
 * Verifies the harness's tool-execution layer against the REAL skill CLI
 * (not a mock) - no OpenRouter key or network needed, since both cases here
 * are designed to resolve without hitting wikimedia.org:
 *
 *  1. `analyze` with a start date before Wikimedia's data horizon fails
 *     client-side inside the skill's own CLI, instantly - this proves the
 *     harness really spawns the CLI as a child process and captures its
 *     stderr into a tool result, not just that argument-building works.
 *  2. `resolve_title` against the sandbox's blocked network proves a genuine
 *     network failure is surfaced as an "Error: ..." tool result instead of
 *     crashing the harness - which is exactly what lets a cheap model react
 *     to a real failure instead of the process dying.
 *
 * A full run against a live model (test/../run-agent.ts directly) still
 * needs a real OPENROUTER_API_KEY and network access - see README.md.
 */
import assert from "node:assert/strict";
import { buildAnalyzeCliArgs, executeTool, SKILL_DIR } from "../run-agent.js";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok: ${name}`);
}

check("buildAnalyzeCliArgs handles multiple series and optional fields", () => {
  const args = buildAnalyzeCliArgs({
    series: [
      { project: "pl.wikipedia", article: "Post_przerywany", label: "Polish" },
      { project: "cs.wikipedia", article: "Přerušovaný_půst" },
    ],
    start: "2023-09-01",
    end: "2025-09-01",
    granularity: "monthly",
    topic: "Intermittent fasting",
    out: "report.pdf",
  });
  assert.deepEqual(args, [
    "analyze",
    "--start", "2023-09-01",
    "--end", "2025-09-01",
    "--series", "pl.wikipedia=Post_przerywany|Polish",
    "--series", "cs.wikipedia=Přerušovaný_půst",
    "--granularity", "monthly",
    "--topic", "Intermittent fasting",
    "--out", "report.pdf",
  ]);
});

const analyzeResult = await executeTool(
  "analyze",
  { series: [{ project: "en.wikipedia", article: "Wikipedia" }], start: "2010-01-01", end: "2011-01-01" },
  SKILL_DIR,
);
check("executeTool really spawns the skill CLI and captures its stderr (client-side date-guard error)", () => {
  assert.match(analyzeResult, /Error:/);
  assert.match(analyzeResult, /2015-07-01/, "should surface the skill's own earliest-available-date guard");
});

const resolveResult = await executeTool(
	"resolve_title",
	{ project: "this-wiki-does-not-exist-zzz", query: "test" },
	SKILL_DIR,
);
check("executeTool surfaces a real network failure as a tool result, not a crash", () => {
  assert.match(resolveResult, /Error:/);
});

console.log(`\n${passed} harness checks passed.`);
