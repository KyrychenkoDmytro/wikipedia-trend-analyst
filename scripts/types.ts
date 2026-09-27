/** One dated pageview count, as returned (after normalization) from the Wikimedia AQS API. */
export interface PageviewPoint {
  date: string; // ISO date, YYYY-MM-DD (bucket start)
  views: number;
}

/** A single language/topic combination the caller wants data for. */
export interface SeriesSpec {
  /** Wikimedia project domain, e.g. "pl.wikipedia", "cs.wikipedia", "uk.wikipedia". */
  project: string;
  /** Exact article title as it appears in that project (spaces or underscores both fine). */
  article: string;
  /** Optional human label for reports/charts, e.g. "Polish". Defaults to `project`. */
  label?: string;
}

export type AccessMethod = "all-access" | "desktop" | "mobile-web" | "mobile-app";
export type AgentType = "all-agents" | "user" | "spider" | "automated";
export type Granularity = "daily" | "monthly";

export interface FetchOptions {
  access: AccessMethod;
  agent: AgentType;
  granularity: Granularity;
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
  /** Bypass the on-disk cache and hit the API again. */
  refresh?: boolean;
  /** Contact string embedded in the User-Agent header, per Wikimedia's etiquette policy. */
  contact?: string;
}

export type ConfidenceLevel = "low" | "moderate" | "high";

export interface Anomaly {
  date: string;
  views: number;
  /** How many MADs away from the robust median this point sits. */
  deviation: number;
}

export interface TrendStats {
  points: number;
  totalViews: number;
  meanViews: number;
  /** % change per period (per the requested granularity), from a log-linear fit. Null if it can't be computed (<2 points or all-zero series). */
  growthPerPeriodPct: number | null;
  /** % change from the fitted trend line's first value to its last value, over the whole window. */
  growthOverWindowPct: number | null;
  /** R^2 of the log-linear fit against the actual (log) values — a rough signal-vs-noise indicator, not a p-value. */
  r2: number | null;
  confidence: ConfidenceLevel;
  confidenceReasons: string[];
  anomalies: Anomaly[];
}

export interface SeriesResult {
  spec: SeriesSpec;
  options: FetchOptions;
  series: PageviewPoint[];
  trend: TrendStats;
}

export interface AnalysisResult {
  topic: string;
  generatedAt: string;
  results: SeriesResult[];
  /** Results sorted by growthPerPeriodPct descending (nulls last). */
  ranking: { project: string; article: string; growthPerPeriodPct: number | null }[];
  notes: string[];
}
