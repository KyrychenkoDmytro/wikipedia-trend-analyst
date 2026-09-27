import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FetchOptions, PageviewPoint, SeriesSpec } from "./types.js";
import { buildUserAgent } from "./user-agent.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dirname, "..", "cache");
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days: pageview history for past periods doesn't change

const BASE_URL = "https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article";

/** Data only exists from this date onward; anything earlier is a caller mistake worth catching early. */
export const EARLIEST_AVAILABLE_DATE = "2015-07-01";

function toApiDate(isoDate: string): string {
	// Accepts "YYYY-MM-DD" or "YYYY-MM"; the API wants a flat 8-digit YYYYMMDD.
	const clean = isoDate.replaceAll("-", "");
	return clean.length === 6 ? `${clean}01` : clean;
}

/** Last calendar day of the month containing `isoDate` ("YYYY-MM-DD" in, "YYYY-MM-DD" out). */
export function lastDayOfMonth(isoDate: string): string {
	const [y, m] = isoDate.split("-").map(Number) as [number, number];
	// Date.UTC's month is 0-indexed, so passing the 1-indexed target month `m` here
	// lands on day 0 of the *next* month, which JS resolves to the last day of `m`.
	return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/**
 * For monthly granularity, the API appears to treat `end` as a cutoff *within*
 * that month rather than "include this whole month" - requesting end=2025-09-01
 * comes back with only a sliver of September, not the full month (confirmed by
 * three independent live checks, each showing the exact same near-zero final
 * bucket). Rolling `end` forward to the last day of its month fixes this without
 * changing anything for daily granularity, where `end` already names one exact day.
 */
export function resolveEndDate(end: string, granularity: FetchOptions["granularity"]): string {
	return granularity === "monthly" ? lastDayOfMonth(end) : end;
}

function encodeArticleTitle(article: string): string {
  const withUnderscores = article.trim().replaceAll(" ", "_");
  return withUnderscores
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function cacheKeyFor(spec: SeriesSpec, options: FetchOptions): string {
  const raw = JSON.stringify({
    project: spec.project,
    article: spec.article,
    access: options.access,
    agent: options.agent,
    granularity: options.granularity,
    start: options.start,
    end: options.end,
  });
  return createHash("sha1").update(raw).digest("hex").slice(0, 16);
}

interface AqsResponseItem {
  project: string;
  article: string;
  granularity: string;
  timestamp: string; // YYYYMMDDHH
  access: string;
  agent: string;
  views: number;
}

interface AqsResponse {
  items: AqsResponseItem[];
}

function timestampToIsoDate(timestamp: string): string {
  // Format is YYYYMMDDHH; we only need the date part.
  const y = timestamp.slice(0, 4);
  const m = timestamp.slice(4, 6);
  const d = timestamp.slice(6, 8);
  return `${y}-${m}-${d}`;
}

async function readCache(key: string): Promise<PageviewPoint[] | null> {
  const path = join(CACHE_DIR, `${key}.json`);
  try {
    const info = await stat(path);
    if (Date.now() - info.mtimeMs > CACHE_TTL_MS) return null;
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as PageviewPoint[];
  } catch {
    return null;
  }
}

async function writeCache(key: string, points: PageviewPoint[]): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(join(CACHE_DIR, `${key}.json`), JSON.stringify(points), "utf8");
}

/**
 * Fetches the daily/monthly pageview series for one article in one project,
 * transparently caching results on disk keyed by every parameter that affects
 * the response. Repeated or related agent queries (e.g. "now add German too",
 * "what about last month specifically") hit the network only for the parts
 * that actually changed.
 */
export async function fetchPageviews(spec: SeriesSpec, options: FetchOptions): Promise<PageviewPoint[]> {
  if (options.start < EARLIEST_AVAILABLE_DATE) {
    throw new Error(
      `Wikimedia pageview data starts at ${EARLIEST_AVAILABLE_DATE}; requested start ${options.start} predates it.`,
    );
  }

  const key = cacheKeyFor(spec, options);
  if (!options.refresh) {
    const cached = await readCache(key);
    if (cached) return cached;
  }

  const url = [
    BASE_URL,
    spec.project,
    options.access,
    options.agent,
    encodeArticleTitle(spec.article),
    options.granularity,
    toApiDate(options.start),
	  toApiDate(resolveEndDate(options.end, options.granularity)),
  ].join("/");

  const res = await fetch(url, {
    headers: { "User-Agent": buildUserAgent(options.contact) },
  });

  if (res.status === 404) {
    // Wikimedia returns 404 for "no data in range" as well as "article doesn't exist" -
    // both are legitimate "zero series" outcomes for a trend analysis, not hard failures.
    await writeCache(key, []);
    return [];
  }
  if (!res.ok) {
    throw new Error(`Wikimedia API request failed (${res.status} ${res.statusText}) for ${url}`);
  }

  const body = (await res.json()) as AqsResponse;
  const points: PageviewPoint[] = body.items
    .map((item) => ({ date: timestampToIsoDate(item.timestamp), views: item.views }))
    .sort((a, b) => a.date.localeCompare(b.date));

  await writeCache(key, points);
  return points;
}
