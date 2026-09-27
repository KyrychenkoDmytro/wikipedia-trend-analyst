import { buildUserAgent } from "./user-agent.js";

export interface SearchHit {
  /** DB-key form (spaces already replaced with underscores) - use this directly as the `article` value for fetchPageviews. */
  key: string;
  title: string;
  description: string | null;
}

interface MediaWikiSearchResponse {
  pages: { key: string; title: string; description: string | null }[];
}

/**
 * A "topic" the agent is given (e.g. "intermittent fasting") is an English
 * phrase; the pageviews API needs the *exact* title as it exists on each
 * target wiki, and that title is almost never a literal translation. This
 * hits each wiki's own MediaWiki search endpoint (separate from the AQS
 * pageviews service) to find the right title before spending a pageviews
 * call on a guess.
 */
export async function searchArticleTitles(
  project: string,
  query: string,
  limit = 5,
  contact?: string,
): Promise<SearchHit[]> {
  const domain = project.endsWith(".org") ? project : `${project}.org`;
  const url = `https://${domain}/w/rest.php/v1/search/page?q=${encodeURIComponent(query)}&limit=${limit}`;

  const res = await fetch(url, { headers: { "User-Agent": buildUserAgent(contact) } });
  if (!res.ok) {
    throw new Error(`MediaWiki search failed (${res.status} ${res.statusText}) for ${url}`);
  }
  const body = (await res.json()) as MediaWikiSearchResponse;
  return body.pages.map((p) => ({ key: p.key, title: p.title, description: p.description }));
}
