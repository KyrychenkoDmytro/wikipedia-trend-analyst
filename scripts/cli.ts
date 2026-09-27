import { Command } from "commander";
import { analyze } from "./analyze.js";
import { generateReport } from "./report.js";
import { searchArticleTitles } from "./resolve.js";
import { EARLIEST_AVAILABLE_DATE, fetchPageviews } from "./wikimedia-client.js";
import type { AccessMethod, AgentType, FetchOptions, Granularity, SeriesSpec } from "./types.js";

function parseSeries(value: string, previous: SeriesSpec[]): SeriesSpec[] {
  const eqIdx = value.indexOf("=");
  if (eqIdx === -1) {
    throw new Error(
      `--series "${value}" must look like project=article or project=article|Label, e.g. pl.wikipedia=Post_przerywany|Polish`,
    );
  }
  const project = value.slice(0, eqIdx).trim();
  const remainder = value.slice(eqIdx + 1);
  const pipeIdx = remainder.lastIndexOf("|");
  const article = (pipeIdx === -1 ? remainder : remainder.slice(0, pipeIdx)).trim();
  const label = pipeIdx === -1 ? undefined : remainder.slice(pipeIdx + 1).trim();
  previous.push({ project, article, label });
  return previous;
}

const program = new Command();

program
  .name("wikipedia-trend-analyst")
  .description(
    "Analyze Wikipedia pageview trends for one topic across one or more language editions: fetch data, score growth + confidence, optionally render a one-page PDF report.",
  )
  .addHelpText(
    "afterAll",
    `\nNotes:\n  - Pageview data starts at ${EARLIEST_AVAILABLE_DATE}; earlier start dates are rejected.\n  - Responses are cached on disk for 7 days, keyed by every parameter that affects them.\n  - Set WIKI_UA_CONTACT (or pass --contact) to a real contact string; Wikimedia asks every client to identify itself.\n`,
  );

program
  .command("analyze")
  .description(
    "Fetch pageviews for one or more project/article series over the same date range, compute a growth trend and a plain-language confidence rating for each, and optionally write a one-page PDF report comparing them.",
  )
  .requiredOption(
    "--series <project=article[|Label]>",
    "one series to include; repeat this flag once per language/edition to compare",
    parseSeries,
    [] as SeriesSpec[],
  )
  .requiredOption("--start <YYYY-MM-DD>", "start of the date range")
  .requiredOption("--end <YYYY-MM-DD>", "end of the date range")
  .option("--granularity <daily|monthly>", "bucket size", "monthly")
  .option("--access <all-access|desktop|mobile-web|mobile-app>", "access-method filter", "all-access")
  .option("--agent <all-agents|user|spider|automated>", "traffic-type filter", "user")
  .option("--topic <name>", "human label for the report title", "Untitled topic")
  .option("--out <path>", "write a one-page PDF report to this path")
  .option("--refresh", "bypass the on-disk cache and re-fetch", false)
  .option("--contact <text>", "contact info for the Wikimedia User-Agent header")
  .action(async (opts) => {
    const options: FetchOptions = {
      access: opts.access as AccessMethod,
      agent: opts.agent as AgentType,
      granularity: opts.granularity as Granularity,
      start: opts.start,
      end: opts.end,
      refresh: Boolean(opts.refresh),
      contact: opts.contact,
    };
    const result = await analyze({ topic: opts.topic, series: opts.series, options });
    if (opts.out) {
      await generateReport(result, opts.out);
    }
    console.log(JSON.stringify(result, null, 2));
  });

program
  .command("fetch")
  .description("Fetch the raw pageview series for a single project/article, with no trend analysis. Useful for sanity-checking that an article title exists on a given wiki before running `analyze`.")
  .requiredOption("--project <domain>", "e.g. pl.wikipedia")
  .requiredOption("--article <title>", "exact article title on that wiki")
  .requiredOption("--start <YYYY-MM-DD>", "start of the date range")
  .requiredOption("--end <YYYY-MM-DD>", "end of the date range")
  .option("--granularity <daily|monthly>", "bucket size", "monthly")
  .option("--access <all-access|desktop|mobile-web|mobile-app>", "access-method filter", "all-access")
  .option("--agent <all-agents|user|spider|automated>", "traffic-type filter", "user")
  .option("--refresh", "bypass the on-disk cache and re-fetch", false)
  .option("--contact <text>", "contact info for the Wikimedia User-Agent header")
  .action(async (opts) => {
    const points = await fetchPageviews(
      { project: opts.project, article: opts.article },
      {
        access: opts.access as AccessMethod,
        agent: opts.agent as AgentType,
        granularity: opts.granularity as Granularity,
        start: opts.start,
        end: opts.end,
        refresh: Boolean(opts.refresh),
        contact: opts.contact,
      },
    );
    console.log(JSON.stringify(points, null, 2));
  });

program
  .command("resolve-title")
  .description(
    "Find the exact article title on a given wiki for a rough topic name (e.g. an English phrase). Run this BEFORE `analyze` whenever you don't already know the precise title on each target wiki - titles are almost never literal translations of each other.",
  )
  .requiredOption("--project <domain>", "e.g. pl.wikipedia")
  .requiredOption("--query <text>", "rough topic name, in any language")
  .option("--limit <n>", "max candidates to return", "5")
  .option("--contact <text>", "contact info for the Wikimedia User-Agent header")
  .action(async (opts) => {
    const hits = await searchArticleTitles(opts.project, opts.query, Number(opts.limit), opts.contact);
    console.log(JSON.stringify(hits, null, 2));
  });

try {
  await program.parseAsync(process.argv);
} catch (err) {
  // A short, single-line message is far easier for a cheap agent model to parse
  // and react to sensibly than a raw JS stack trace would be.
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Error: ${message}`);
  process.exitCode = 1;
}
